-- A single atomic event consumes one identified BIN and preserves its lot history.
create unique index if not exists records_dump_bin_unique on public.records ((data->>'bin_id'))
  where entity='DumpingEvent' and data->>'bin_id' is not null;

create or replace function public.dump_bin_by_qr(
  p_operation_id uuid, p_bin_id text, p_lot_id text, p_bin_code text, p_dump_code text,
  p_scanned_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_role text; v_lot public.records; v_bin public.records; v_event public.records;
  v_code text:=upper(trim(p_bin_code)); v_count integer; v_dumped integer; v_identified integer;
  v_total numeric; v_used numeric; v_remaining numeric; v_kg numeric; v_context text;
  v_time timestamptz:=coalesce(p_scanned_at,now());
begin
  select role into v_role from public.profiles where id=(select auth.uid());
  if coalesce(v_role,'') not in ('admin','supervisor','produccion') then
    raise exception 'No tenés permiso para registrar vuelcos' using errcode='42501'; end if;
  if p_operation_id is null or nullif(trim(p_bin_id),'') is null or nullif(trim(p_lot_id),'') is null
    or nullif(v_code,'') is null or nullif(trim(p_dump_code),'') is null then raise exception 'Escaneá un QR de BIN válido'; end if;
  if not isfinite(v_time) then raise exception 'La fecha del escaneo no es válida'; end if;
  -- All movements of this lot serialize; the second device sees the first device's result.
  select * into v_lot from public.records where entity='ReceiptLot' and id=p_lot_id for update;
  if not found then raise exception 'Lote no encontrado'; end if;
  select * into v_event from public.records where entity='DumpingEvent' and id=p_operation_id::text;
  if found then
    if v_event.data->>'bin_id'=p_bin_id and v_event.data->>'receipt_lot_id'=p_lot_id
      and v_event.data->>'bin_code'=v_code and v_event.data->>'dump_code'=p_dump_code then
      return jsonb_build_object('already_applied',true,'kg',(v_event.data->>'net_weight')::numeric); end if;
    raise exception 'El identificador de operación ya se utilizó con otros datos';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bin-code:'||v_code,0));
  select * into v_bin from public.records where entity='Bin' and id=p_bin_id for update;
  if not found or upper(trim(v_bin.data->>'bin_code')) is distinct from v_code or v_bin.data->>'receipt_lot_id' is distinct from p_lot_id then
    raise exception 'El BIN escaneado no pertenece a este lote'; end if;
  if v_bin.data->>'dump_operation_id' is not null or v_bin.data->>'status'='volcado'
    or exists(select 1 from public.records where entity='DumpingEvent' and data->>'bin_id'=p_bin_id) then
    raise exception 'Este BIN ya fue volcado; no se descontará nuevamente'; end if;
  if v_lot.data->>'workflow_version' in ('2','3') and (nullif(v_lot.data->>'yard_received_at','') is null
    or v_lot.data->>'status' not in ('recibido','parcialmente_volcado')) then
    raise exception 'Registrá la recepción del lote en Playa Empaque antes de volcar sus BINs'; end if;
  if coalesce((v_lot.data->>'held')::boolean,false) then raise exception 'Este lote está retenido por calidad'; end if;
  v_total:=nullif(v_lot.data->>'net_weight','')::numeric;
  v_used:=coalesce(nullif(v_lot.data->>'dumped_weight','')::numeric,0);
  v_remaining:=nullif(v_lot.data->>'remaining_weight','')::numeric;
  v_count:=nullif(v_lot.data->>'bins_count','')::integer;
  v_dumped:=coalesce(nullif(v_lot.data->>'bins_dumped','')::integer,0);
  if v_total::text in ('NaN','Infinity','-Infinity') or v_used::text in ('NaN','Infinity','-Infinity')
    or v_remaining::text in ('NaN','Infinity','-Infinity') or v_used<0 or v_total is null or v_total<=0 or v_count is null or v_count<=0 or v_remaining is null or v_remaining<=0
    or v_dumped<0 or v_dumped>=v_count or v_total-v_used<>v_remaining then
    raise exception 'El lote no tiene un saldo válido para volcar'; end if;
  select count(*) into v_identified from public.records where entity='Bin' and data->>'receipt_lot_id'=p_lot_id;
  if v_identified<>v_count then raise exception 'Este lote no tiene todos sus BINs individualizados; requiere conciliación'; end if;
  select count(*) into v_identified from public.records where entity='Bin' and data->>'receipt_lot_id'=p_lot_id
    and data->>'dump_operation_id' is not null;
  if v_identified<>v_dumped then raise exception 'Este lote tiene vuelcos anteriores sin identificar BINs; requiere conciliación'; end if;
  v_kg:=nullif(v_bin.data->>'net_weight','')::numeric;
  if v_kg is null or v_kg<=0 or v_kg::text in ('NaN','Infinity','-Infinity') then raise exception 'El BIN todavía no tiene un peso válido'; end if;
  -- Close out the exact lot balance on the last BIN; no cumulative rounding loss.
  if v_dumped+1=v_count then v_kg:=v_remaining; end if;
  if v_kg>v_remaining then raise exception 'El peso del BIN supera el saldo del lote'; end if;
  insert into public.records(entity,id,data) values('DumpingEvent',p_operation_id::text,jsonb_build_object(
    'id',p_operation_id,'operation_id',p_operation_id,'dump_code',trim(p_dump_code),'receipt_lot_id',p_lot_id,
    'receipt_lot_code',v_lot.data->>'lot_code','bin_id',p_bin_id,'bin_code',v_code,'bins_dumped',1,'net_weight',v_kg,
    'dump_date',v_time,'registered_at',now(),'dumped_by',(select auth.uid()),
    'producer',coalesce(v_bin.data->>'producer',v_lot.data->>'producer'),
    'variety',coalesce(v_bin.data->>'variety',v_lot.data->>'variety')));
  v_context:=coalesce(current_setting('rimonim.field_lot_id',true),'');
  perform set_config('rimonim.field_lot_id',p_lot_id,true);
  update public.records set data=data || jsonb_build_object('status','volcado','dumped_at',v_time,
    'dump_registered_at',now(),'dump_operation_id',p_operation_id,'dumped_weight',v_kg),updated_date=now()
    where entity='Bin' and id=p_bin_id;
  update public.records set data=data || jsonb_build_object('bins_dumped',v_dumped+1,'dumped_weight',v_used+v_kg,
    'remaining_weight',v_remaining-v_kg,'last_dump_at',v_time,
    'status',case when v_dumped+1=v_count then 'volcado' else 'parcialmente_volcado' end),updated_date=now()
    where entity='ReceiptLot' and id=p_lot_id;
  perform set_config('rimonim.field_lot_id',v_context,true);
  return jsonb_build_object('already_applied',false,'kg',v_kg,'bin_id',p_bin_id,'bins_remaining',v_count-v_dumped-1);
end;
$$;
revoke all on function public.dump_bin_by_qr(uuid,text,text,text,text,timestamptz) from public,anon;
grant execute on function public.dump_bin_by_qr(uuid,text,text,text,text,timestamptz) to authenticated;

-- Historic count-based lots retain their original operation; harvest lots require BIN QR.
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

  if v_lot.data->>'workflow_version'='3' then
    raise exception 'Escaneá el QR de cada BIN en Vuelco para descontar su peso';
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
