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
  update public.records set
    data = data || jsonb_build_object(
      'bins_dumped', v_dumped_bins + p_bins,
      'dumped_weight', v_new_dumped,
      'remaining_weight', v_total - v_new_dumped,
      'status', case when v_dumped_bins + p_bins = v_total_bins
        then 'volcado' else 'parcialmente_volcado' end
    ), updated_date = now()
    where entity = 'ReceiptLot' and id = p_lot_id;

  return jsonb_build_object('operation_id', p_operation_id,
    'already_applied', false, 'kg', v_kg,
    'bins_remaining', v_total_bins - v_dumped_bins - p_bins,
    'kg_remaining', v_total - v_new_dumped);
end;
$$;

revoke all on function public.dump_lot_by_bins(uuid,text,integer,text) from public, anon;
grant execute on function public.dump_lot_by_bins(uuid,text,integer,text) to authenticated;
