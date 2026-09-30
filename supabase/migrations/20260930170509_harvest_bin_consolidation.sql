-- New lots follow field -> weighing -> packing-yard reception.
-- Existing lots deliberately retain their original balances and workflow.
create or replace function public.guard_field_lot_workflow()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_managed boolean := false; v_context text; v_allowed text[] := '{}';
begin
  v_context := coalesce(current_setting('rimonim.field_lot_id',true),'');
  if tg_op <> 'INSERT' then
    v_managed := (old.entity='ReceiptLot' and old.data->>'workflow_version' in ('2','3'))
      or (old.entity='Bin' and (old.data->>'field_workflow'='true' or old.data->>'harvest_workflow'='3'));
    if old.entity='ReceiptLot' then v_allowed:=v_allowed || old.id;
    else v_allowed:=v_allowed || coalesce(old.data->>'receipt_lot_id','harvest:'||old.id); end if;
  end if;
  if tg_op <> 'DELETE' then
    v_managed := coalesce(v_managed,false) or (new.entity='ReceiptLot' and new.data->>'workflow_version' in ('2','3'))
      or (new.entity='Bin' and (new.data->>'field_workflow'='true' or new.data->>'harvest_workflow'='3'));
    if new.entity='ReceiptLot' then v_allowed:=v_allowed || new.id;
    else
      v_allowed:=v_allowed || coalesce(new.data->>'receipt_lot_id','harvest:'||new.id);
      v_managed:=coalesce(v_managed,false) or exists(select 1 from public.records where entity='ReceiptLot'
        and id=new.data->>'receipt_lot_id' and data->>'workflow_version' in ('2','3'));
    end if;
    if tg_op='UPDATE' and old.entity='ReceiptLot' and new.entity=old.entity and new.id=old.id
      and (new.data-array['held','quality_notes'])=(old.data-array['held','quality_notes']) then return new; end if;
  end if;
  if v_managed and not (v_context=any(v_allowed)) then
    raise exception 'Usá Cosecha o la estación correspondiente para modificar este registro';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_field_lot_workflow() from public,anon,authenticated;

create or replace function public.harvest_bin_operation(p_operation_id uuid,p_bin_id text,p_record jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_role text; v_code text; v_bin public.records; v_old_context text; v_crews jsonb;
begin
  select role into v_role from public.profiles where id=(select auth.uid());
  if coalesce(v_role,'') not in ('admin','supervisor','recepcion','calidad') then
    raise exception 'No tenés permiso para registrar cosecha' using errcode='42501'; end if;
  if p_operation_id is null or nullif(trim(p_bin_id),'') is null then raise exception 'Falta el identificador del BIN'; end if;
  v_code:=upper(trim(p_record->>'bin_code'));
  if nullif(v_code,'') is null or length(v_code)>200 or v_code ~ '[[:cntrl:]]' or v_code ~ '^(LOT|ROM|PAL)-' then
    raise exception 'Escaneá un código QR válido de BIN'; end if;
  if nullif(trim(p_record->>'producer'),'') is null or nullif(trim(p_record->>'variety'),'') is null or nullif(p_record->>'harvest_date','') is null then
    raise exception 'Completá productor, variedad y fecha de cosecha'; end if;
  perform (p_record->>'harvest_date')::date;
  v_crews:=coalesce(p_record->'crew_breakdown','[]');
  if p_record->>'crew'='MIXTO' and (jsonb_array_length(v_crews)<>2 or nullif(v_crews->0->>'crew','') is null
    or nullif(v_crews->1->>'crew','') is null or v_crews->0->>'crew'=v_crews->1->>'crew') then
    raise exception 'Indicá las dos cuadrillas distintas que cosecharon este BIN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bin-code:'||v_code,0));
  select * into v_bin from public.records where entity='Bin' and id=p_bin_id;
  if found then
    if v_bin.data->>'harvest_operation_id'=p_operation_id::text and v_bin.data->'harvest_payload'=p_record then
      return jsonb_build_object('already_applied',true,'bin',v_bin.data || jsonb_build_object('id',v_bin.id)); end if;
    raise exception 'Este registro de BIN ya existe';
  end if;
  if exists(select 1 from public.records b left join public.records l on l.entity='ReceiptLot' and l.id=b.data->>'receipt_lot_id'
    where b.entity='Bin' and upper(trim(b.data->>'bin_code'))=v_code
      and (nullif(b.data->>'receipt_lot_id','') is null or coalesce(l.data->>'status','') not in ('volcado','anulado'))) then
    raise exception 'Este QR ya tiene un BIN de cosecha pendiente o pertenece a un lote activo'; end if;
  v_old_context:=coalesce(current_setting('rimonim.field_lot_id',true),'');
  perform set_config('rimonim.field_lot_id','harvest:'||p_bin_id,true);
  insert into public.records(entity,id,data) values('Bin',p_bin_id,jsonb_build_object(
    'id',p_bin_id,'bin_code',v_code,'harvest_workflow',3,'status','cosechado','harvest_operation_id',p_operation_id,
    'harvest_payload',p_record,'producer',p_record->>'producer','variety',p_record->>'variety','origin',p_record->>'origin',
    'species',p_record->>'species','harvest_type',p_record->>'harvest_type','crew',p_record->>'crew',
    'crew_breakdown',v_crews,'harvest_date',p_record->>'harvest_date','quality_notes',p_record->>'quality_notes',
    'scanned_at',now(),'scanned_by',(select auth.uid()),'measured',false)) returning * into v_bin;
  perform set_config('rimonim.field_lot_id',v_old_context,true);
  return jsonb_build_object('already_applied',false,'bin',v_bin.data || jsonb_build_object('id',v_bin.id));
end;
$$;
revoke all on function public.harvest_bin_operation(uuid,text,jsonb) from public,anon;
grant execute on function public.harvest_bin_operation(uuid,text,jsonb) to authenticated;

create or replace function public.field_lot_operation(
  p_operation_id uuid, p_lot_id text, p_action text,
  p_record jsonb default '{}', p_bin_code text default null,
  p_gross numeric default null, p_tare numeric default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_lot public.records; v_previous jsonb; v_payload jsonb; v_ops jsonb;
  v_role text; v_count integer; v_expected integer; v_code text; v_conflict text;
  v_net numeric; v_bin_weight numeric; v_old_context text; v_breakdown jsonb; v_v3 boolean; v_bin public.records; v_summary jsonb;
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
  v_v3:=case when p_action='create' then p_record->>'workflow_version'='3' else v_lot.data->>'workflow_version'='3' end;
  if p_action = 'create' then
    if v_lot.id is not null then raise exception 'El lote ya existe'; end if;
    if coalesce(v_v3,false) then
      if nullif(trim(p_record->>'transport'),'') is null then raise exception 'Ingresá el nombre del transporte'; end if;
      v_expected:=null; v_breakdown:='[]';
    else
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
    end if;
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
        'workflow_version',case when v_v3 then 3 else 2 end,'status','en_campo','field_created_at',now(),
        'expected_bins_count',v_expected,'bins_count',0,'bins_dumped',0,
        'dumped_weight',0,'remaining_weight',0,'held',false,'field_operations','[]'::jsonb))
      returning * into v_lot;
  else
    if v_lot.id is null then raise exception 'Lote no encontrado'; end if;
    if coalesce(v_lot.data->>'workflow_version','') not in ('2','3') then
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
        if v_v3 then
          select * into v_bin from public.records where entity='Bin' and data->>'harvest_workflow'='3'
            and data->>'bin_code'=v_code and nullif(data->>'receipt_lot_id','') is null for update;
          if not found then raise exception 'El BIN debe estar registrado en Cosecha y disponible para consolidar'; end if;
          update public.records set data=data || jsonb_build_object('receipt_lot_id',p_lot_id,
            'receipt_lot_code',v_lot.data->>'lot_code','field_workflow',true,'status','en_campo'),updated_date=now()
            where entity='Bin' and id=v_bin.id;
        else
        select coalesce(l.data->>'lot_code','pendiente de consolidar') into v_conflict from public.records b left join public.records l
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
        end if;
      elsif p_action = 'remove_bin' then
        if v_v3 then
          update public.records set data=(data-array['receipt_lot_id','receipt_lot_code','field_workflow']) || jsonb_build_object('status','cosechado'),updated_date=now()
            where entity='Bin' and data->>'receipt_lot_id'=p_lot_id and data->>'bin_code'=v_code;
          if not found then raise exception 'El BIN no pertenece a este lote'; end if;
        else
          delete from public.records where entity='Bin' and data->>'receipt_lot_id'=p_lot_id and data->>'bin_code'=v_code;
          if not found then raise exception 'El BIN no pertenece a este lote'; end if;
        end if;
      end if;
      select count(*) into v_count from public.records where entity='Bin' and data->>'receipt_lot_id'=p_lot_id;
      if v_v3 then
        select jsonb_build_object('producer',string_agg(distinct data->>'producer',' / ' order by data->>'producer'),
          'variety',string_agg(distinct data->>'variety',' / ' order by data->>'variety'),
          'origin',string_agg(distinct data->>'origin',' / ' order by data->>'origin'),
          'species',string_agg(distinct data->>'species',' / ' order by data->>'species'),
          'harvest_type',string_agg(distinct data->>'harvest_type',' / ' order by data->>'harvest_type'),
          'crew',string_agg(distinct data->>'crew',' / ' order by data->>'crew'),
          'harvest_date',case when count(distinct data->>'harvest_date')=1 then min(data->>'harvest_date') else null end)
          into v_summary from public.records where entity='Bin' and data->>'receipt_lot_id'=p_lot_id;
        v_lot.data:=v_lot.data || v_summary;
      end if;
      if p_action = 'close' then
        if v_count <= 0 or (not coalesce(v_v3,false) and v_count <> (v_lot.data->>'expected_bins_count')::integer) then
          raise exception 'Escaneá todos los BINs declarados antes de cerrar el lote';
        end if;
        v_lot.data := v_lot.data || jsonb_build_object('expected_bins_count',v_count,'status','cerrado_campo','field_closed_at',now(),'field_closed_by',(select auth.uid()));
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

  if v_lot.data->>'workflow_version' in ('2','3') and
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
