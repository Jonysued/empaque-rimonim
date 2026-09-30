-- New lots follow field -> weighing -> packing-yard reception.
-- Existing lots deliberately retain their original balances and workflow.
create or replace function public.guard_field_lot_workflow()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_lot_id text; v_managed boolean;
begin
  if tg_op = 'DELETE' then
    v_managed := (old.entity = 'ReceiptLot' and old.data->>'workflow_version' = '2')
      or (old.entity = 'Bin' and old.data->>'field_workflow' = 'true');
    v_lot_id := case when old.entity = 'ReceiptLot' then old.id else old.data->>'receipt_lot_id' end;
  else
    v_managed := (new.entity = 'ReceiptLot' and new.data->>'workflow_version' = '2')
      or (new.entity = 'Bin' and new.data->>'field_workflow' = 'true');
    v_lot_id := case when new.entity = 'ReceiptLot' then new.id else new.data->>'receipt_lot_id' end;
    if tg_op = 'UPDATE' then
      v_managed := v_managed or (old.entity = 'ReceiptLot' and old.data->>'workflow_version' = '2')
        or (old.entity = 'Bin' and old.data->>'field_workflow' = 'true');
      -- Quality holds and notes continue to use the ordinary patch endpoint.
      if old.entity = 'ReceiptLot' and new.entity = old.entity and new.id = old.id
        and (new.data - array['held','quality_notes']) = (old.data - array['held','quality_notes']) then
        return new;
      end if;
    end if;
  end if;
  -- A direct API call cannot add unmarked BINs to a closed/new-flow lot.
  if (case when tg_op = 'DELETE' then old.entity else new.entity end) = 'Bin' then
    v_managed := coalesce(v_managed,false) or exists(
      select 1 from public.records where entity='ReceiptLot' and id=v_lot_id and data->>'workflow_version'='2');
  end if;
  if v_managed and coalesce(current_setting('rimonim.field_lot_id', true),'') <> v_lot_id then
    raise exception 'Usá la estación correspondiente para modificar este lote o sus BINs';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_field_lot_workflow() from public, anon, authenticated;
create trigger guard_field_lot_workflow before insert or update or delete on public.records
for each row execute function public.guard_field_lot_workflow();

create or replace function public.field_lot_operation(
  p_operation_id uuid, p_lot_id text, p_action text,
  p_record jsonb default '{}', p_bin_code text default null,
  p_gross numeric default null, p_tare numeric default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_lot public.records; v_previous jsonb; v_payload jsonb; v_ops jsonb;
  v_role text; v_count integer; v_expected integer; v_code text; v_conflict text;
  v_net numeric; v_bin_weight numeric; v_old_context text; v_breakdown jsonb;
begin
  if p_operation_id is null or nullif(trim(p_lot_id),'') is null then
    raise exception 'Falta el identificador de la operación o del lote';
  end if;
  select role into v_role from public.profiles where id = (select auth.uid());
  if coalesce(v_role,'') not in ('admin','supervisor','recepcion','calidad') then
    raise exception 'No tenés permiso para operar en recepción' using errcode = '42501';
  end if;
  if p_action not in ('create','add_bin','remove_bin','close','weigh','receive') or p_action is null then
    raise exception 'Operación de recepción inválida';
  end if;
  v_code := upper(trim(p_bin_code));
  v_payload := jsonb_build_object('record',p_record,'bin_code',v_code,'gross',p_gross,'tare',p_tare);
  perform pg_advisory_xact_lock(hashtextextended('field-lot:' || p_lot_id,0));
  select * into v_lot from public.records where entity = 'ReceiptLot' and id = p_lot_id for update;
  if found then
    select op into v_previous from jsonb_array_elements(coalesce(v_lot.data->'field_operations','[]')) op
      where op->>'id' = p_operation_id::text;
    if v_previous is not null then
      if v_previous->>'action' <> p_action or v_previous->'payload' <> v_payload then
        raise exception 'El identificador de operación ya se utilizó con otros datos';
      end if;
      return jsonb_build_object('already_applied',true,'lot',v_lot.data || jsonb_build_object('id',v_lot.id,'created_date',v_lot.created_date));
    end if;
  end if;
  v_old_context := coalesce(current_setting('rimonim.field_lot_id',true),'');
  perform set_config('rimonim.field_lot_id',p_lot_id,true);
  if p_action = 'create' then
    if v_lot.id is not null then raise exception 'El lote ya existe'; end if;
    if nullif(trim(p_record->>'producer'),'') is null or nullif(trim(p_record->>'variety'),'') is null
      or nullif(p_record->>'harvest_date','') is null then
      raise exception 'Completá productor, variedad y fecha de cosecha';
    end if;
    perform (p_record->>'harvest_date')::date;
    v_expected := (p_record->>'expected_bins_count')::integer;
    if v_expected is null or v_expected <= 0 then raise exception 'Ingresá la cantidad de BINs del lote'; end if;
    v_breakdown := coalesce(p_record->'crew_breakdown','[]');
    if p_record->>'crew' = 'MIXTO' then
      if jsonb_array_length(v_breakdown) <> 2
        or exists(select 1 from jsonb_array_elements(v_breakdown) b where nullif(trim(b->>'crew'),'') is null or coalesce((b->>'bins_count')::integer,0) <= 0)
        or (v_breakdown->0->>'crew') = (v_breakdown->1->>'crew')
        or (select sum((b->>'bins_count')::integer) from jsonb_array_elements(v_breakdown) b) <> v_expected then
        raise exception 'Las dos cuadrillas deben ser distintas y sus BINs deben sumar el total del lote';
      end if;
    else v_breakdown := '[]'; end if;
    if nullif(trim(p_record->>'lot_code'),'') is null then raise exception 'Falta el QR del lote'; end if;
    perform pg_advisory_xact_lock(hashtextextended('lot-code:' || (p_record->>'lot_code'),0));
    if exists(select 1 from public.records where entity='ReceiptLot' and data->>'lot_code'=p_record->>'lot_code') then
      raise exception 'El código del lote ya existe';
    end if;
    insert into public.records(entity,id,data) values('ReceiptLot',p_lot_id,
      jsonb_build_object('id',p_lot_id,'lot_code',trim(p_record->>'lot_code'),
        'producer',p_record->>'producer','variety',p_record->>'variety','origin',p_record->>'origin',
        'species',p_record->>'species','harvest_type',p_record->>'harvest_type',
        'crew',p_record->>'crew','crew_breakdown',v_breakdown,'transport',p_record->>'transport',
        'harvest_date',p_record->>'harvest_date','quality_notes',p_record->>'quality_notes',
        'workflow_version',2,'status','en_campo','field_created_at',now(),
        'expected_bins_count',v_expected,'bins_count',0,'bins_dumped',0,
        'dumped_weight',0,'remaining_weight',0,'held',false,'field_operations','[]'::jsonb))
      returning * into v_lot;
  else
    if v_lot.id is null then raise exception 'Lote no encontrado'; end if;
    if v_lot.data->>'workflow_version' is distinct from '2' then
      raise exception 'Este lote pertenece al flujo anterior y conserva sus datos originales';
    end if;
    if p_action in ('add_bin','remove_bin','close') then
      if v_lot.data->>'status' <> 'en_campo' then raise exception 'El lote está cerrado; no se pueden cambiar sus BINs'; end if;
      if p_action in ('add_bin','remove_bin') then
        if nullif(v_code,'') is null or length(v_code)>200 or v_code ~ '[[:cntrl:]]' then raise exception 'El QR del BIN no es válido'; end if;
        if v_code ~ '^(LOT|ROM|PAL)-' then raise exception 'Escaneá el QR de un BIN, no el de un lote o pallet'; end if;
        perform pg_advisory_xact_lock(hashtextextended('bin-code:' || v_code,0));
      end if;
      if p_action = 'add_bin' then
        select l.data->>'lot_code' into v_conflict from public.records b join public.records l
          on l.entity='ReceiptLot' and l.id=b.data->>'receipt_lot_id'
          where b.entity='Bin' and upper(trim(b.data->>'bin_code'))=v_code
            and (l.id=p_lot_id or coalesce(l.data->>'status','') not in ('volcado','anulado')) limit 1;
        if v_conflict is not null then raise exception 'El BIN % ya pertenece al lote %',v_code,v_conflict; end if;
        select count(*) into v_count from public.records where entity='Bin' and data->>'receipt_lot_id'=p_lot_id;
        if v_count >= (v_lot.data->>'expected_bins_count')::integer then raise exception 'Ya se escanearon todos los BINs declarados'; end if;
        insert into public.records(entity,id,data) values('Bin',p_operation_id::text,
          jsonb_build_object('id',p_operation_id::text,'bin_code',v_code,'receipt_lot_id',p_lot_id,
            'receipt_lot_code',v_lot.data->>'lot_code','field_workflow',true,'status','en_campo',
            'producer',v_lot.data->>'producer','variety',v_lot.data->>'variety','scanned_at',now(),
            'scanned_by',(select auth.uid()),'measured',false));
      elsif p_action = 'remove_bin' then
        delete from public.records where entity='Bin' and data->>'receipt_lot_id'=p_lot_id and data->>'bin_code'=v_code;
        if not found then raise exception 'El BIN no pertenece a este lote'; end if;
      end if;
      select count(*) into v_count from public.records where entity='Bin' and data->>'receipt_lot_id'=p_lot_id;
      if p_action = 'close' then
        if v_count <= 0 or v_count <> (v_lot.data->>'expected_bins_count')::integer then
          raise exception 'Escaneá todos los BINs declarados antes de cerrar el lote';
        end if;
        v_lot.data := v_lot.data || jsonb_build_object('status','cerrado_campo','field_closed_at',now(),'field_closed_by',(select auth.uid()));
      end if;
      v_lot.data := v_lot.data || jsonb_build_object('bins_count',v_count);
    elsif p_action = 'weigh' then
      if v_lot.data->>'status' <> 'cerrado_campo' then raise exception 'El lote debe estar cerrado y sin pesar'; end if;
      if p_gross is null or p_tare is null or p_gross::text in ('NaN','Infinity','-Infinity')
        or p_tare::text in ('NaN','Infinity','-Infinity') or p_gross <= 0 or p_tare < 0 or p_tare >= p_gross then
        raise exception 'Ingresá un bruto mayor a cero y una tara menor al bruto, sin valores negativos';
      end if;
      select count(*) into v_count from public.records where entity='Bin' and data->>'receipt_lot_id'=p_lot_id;
      if v_count <= 0 or v_count <> (v_lot.data->>'bins_count')::integer then raise exception 'La cantidad de BINs del lote no coincide'; end if;
      v_net := round(p_gross-p_tare,1);
      if v_net <= 0 then raise exception 'El peso neto debe ser mayor a cero'; end if;
      v_bin_weight := v_net / v_count;
      update public.records set data=data || jsonb_build_object('net_weight',v_bin_weight,'status','pesado'),updated_date=now()
        where entity='Bin' and data->>'receipt_lot_id'=p_lot_id;
      v_lot.data := v_lot.data || jsonb_build_object('status','pesado','gross_weight',p_gross,'tare_weight',p_tare,
        'net_weight',v_net,'bin_weight',v_bin_weight,'remaining_weight',v_net,'weighed_at',now(),'weighed_by',(select auth.uid()));
    elsif p_action = 'receive' then
      if v_lot.data->>'status' <> 'pesado' then raise exception 'El lote debe estar pesado antes de recibirlo en playa'; end if;
      if coalesce((v_lot.data->>'held')::boolean,false) then raise exception 'Este lote está retenido por calidad'; end if;
      update public.records set data=data || jsonb_build_object('status','recibido','yard_received_at',now()),updated_date=now()
        where entity='Bin' and data->>'receipt_lot_id'=p_lot_id;
      v_lot.data := v_lot.data || jsonb_build_object('status','recibido','yard_received_at',now(),
        'receipt_date',now(),'yard_received_by',(select auth.uid()));
    end if;
  end if;
  v_ops := coalesce(v_lot.data->'field_operations','[]') || jsonb_build_array(jsonb_build_object(
    'id',p_operation_id,'action',p_action,'payload',v_payload,'at',now(),'by',(select auth.uid())));
  update public.records set data=v_lot.data || jsonb_build_object('field_operations',v_ops),updated_date=now()
    where entity='ReceiptLot' and id=p_lot_id returning * into v_lot;
  perform set_config('rimonim.field_lot_id',v_old_context,true);
  return jsonb_build_object('already_applied',false,'lot',v_lot.data || jsonb_build_object('id',v_lot.id,'created_date',v_lot.created_date));
end;
$$;
revoke all on function public.field_lot_operation(uuid,text,text,jsonb,text,numeric,numeric) from public, anon;
grant execute on function public.field_lot_operation(uuid,text,text,jsonb,text,numeric,numeric) to authenticated;

-- Index for bin association lookups; no rewrite of historic operational records.
create index if not exists records_bin_lot on public.records ((data->>'receipt_lot_id')) where entity='Bin';
create index if not exists records_bin_code on public.records (upper(trim(data->>'bin_code'))) where entity='Bin';

-- Register each partial dump against a receipt lot, using the average weight
-- per BIN while keeping the final event equal to the exact remaining weight.
create or replace function public.dump_lot_by_bins(
  p_operation_id uuid,
  p_lot_id text,
  p_bins integer,
  p_dump_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lot public.records;
  v_event public.records;
  v_total_bins integer;
  v_dumped_bins integer;
  v_total numeric;
  v_dumped numeric;
  v_kg numeric;
  v_new_dumped numeric;
  v_role text;
  v_old_context text;
begin
  if p_operation_id is null or nullif(p_lot_id, '') is null or
     p_bins is null or p_bins <= 0 or nullif(trim(p_dump_code), '') is null then
    raise exception 'Completá la cantidad de BINs a volcar';
  end if;
  select role into v_role from public.profiles where id = (select auth.uid());
  if coalesce(v_role, '') not in ('admin', 'supervisor', 'produccion') then
    raise exception 'No tenés permiso para registrar vuelcos' using errcode = '42501';
  end if;

  select * into v_lot from public.records
    where entity = 'ReceiptLot' and id = p_lot_id for update;
  if not found then raise exception 'Lote no encontrado'; end if;

  select * into v_event from public.records
    where entity = 'DumpingEvent' and id = p_operation_id::text;
  if found then
    if v_event.data->>'receipt_lot_id' = p_lot_id and
       (v_event.data->>'bins_dumped')::integer = p_bins and
       v_event.data->>'dump_code' = p_dump_code then
      return jsonb_build_object('operation_id', p_operation_id,
        'already_applied', true, 'kg', (v_event.data->>'net_weight')::numeric);
    end if;
    raise exception 'El identificador de operación ya se utilizó';
  end if;

  if v_lot.data->>'workflow_version' = '2' and
     (nullif(v_lot.data->>'yard_received_at','') is null or v_lot.data->>'status' not in ('recibido','parcialmente_volcado','volcado')) then
    raise exception 'Registrá la recepción del lote en Playa Empaque antes de volcarlo';
  end if;

  if coalesce((v_lot.data->>'held')::boolean, false) then
    raise exception 'Este lote está retenido por calidad';
  end if;
  v_total_bins := nullif(v_lot.data->>'bins_count', '')::integer;
  v_total := nullif(v_lot.data->>'net_weight', '')::numeric;
  v_dumped := coalesce(nullif(v_lot.data->>'dumped_weight', '')::numeric, 0);
  if v_total_bins is null or v_total_bins <= 0 or v_total is null or v_total <= 0 then
    raise exception 'El lote necesita una cantidad de BINs y un peso neto válidos';
  end if;
  if not (v_lot.data ? 'bins_dumped') and v_dumped > 0 and
     v_lot.data->>'status' <> 'volcado' then
    raise exception 'Este lote tiene vuelcos anteriores sin cantidad de BINs; requiere conciliación';
  end if;
  v_dumped_bins := coalesce(nullif(v_lot.data->>'bins_dumped', '')::integer,
    case when v_lot.data->>'status' = 'volcado' then v_total_bins else 0 end);
  if v_dumped_bins < 0 or v_dumped_bins >= v_total_bins or
     p_bins > v_total_bins - v_dumped_bins or v_dumped < 0 or v_dumped >= v_total then
    raise exception 'La cantidad supera los BINs pendientes del lote';
  end if;

  if p_bins = v_total_bins - v_dumped_bins then
    v_kg := v_total - v_dumped;
  else
    v_kg := round(v_total * p_bins / v_total_bins, 1);
  end if;
  if v_kg <= 0 or v_kg > v_total - v_dumped then
    raise exception 'El saldo de kilos del lote no coincide con los BINs pendientes';
  end if;
  v_new_dumped := v_dumped + v_kg;

  insert into public.records (entity, id, data) values (
    'DumpingEvent', p_operation_id::text,
    jsonb_build_object(
      'id', p_operation_id::text,
      'operation_id', p_operation_id::text,
      'dump_code', trim(p_dump_code),
      'receipt_lot_id', p_lot_id,
      'receipt_lot_code', v_lot.data->>'lot_code',
      'dump_date', now(),
      'bins_dumped', p_bins,
      'net_weight', v_kg,
      'producer', v_lot.data->>'producer',
      'variety', v_lot.data->>'variety'
    )
  );
  v_old_context := coalesce(current_setting('rimonim.field_lot_id',true),'');
  perform set_config('rimonim.field_lot_id',p_lot_id,true);
  update public.records set
    data = data || jsonb_build_object(
      'bins_dumped', v_dumped_bins + p_bins,
      'dumped_weight', v_new_dumped,
      'remaining_weight', v_total - v_new_dumped,
      'status', case when v_dumped_bins + p_bins = v_total_bins
        then 'volcado' else 'parcialmente_volcado' end
    ), updated_date = now()
    where entity = 'ReceiptLot' and id = p_lot_id;

  perform set_config('rimonim.field_lot_id',v_old_context,true);
  return jsonb_build_object('operation_id', p_operation_id,
    'already_applied', false, 'kg', v_kg,
    'bins_remaining', v_total_bins - v_dumped_bins - p_bins,
    'kg_remaining', v_total - v_new_dumped);
end;
$$;

revoke all on function public.dump_lot_by_bins(uuid,text,integer,text) from public, anon;
grant execute on function public.dump_lot_by_bins(uuid,text,integer,text) to authenticated;
