-- Remove an incorrectly loaded pallet while keeping shipment totals, pallet
-- availability and movement history consistent in one transaction.
create or replace function public.unload_pallet_from_shipment(
  p_operation_id uuid,
  p_shipment_id text,
  p_pallet_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pallet public.records;
  v_shipment public.records;
  v_event public.records;
  v_loaded jsonb;
  v_remaining jsonb;
  v_weight numeric;
  v_packages numeric;
  v_count integer;
  v_role text;
begin
  if p_operation_id is null or nullif(p_shipment_id, '') is null or nullif(p_pallet_id, '') is null then
    raise exception 'Faltan datos de la operación';
  end if;
  select role into v_role from public.profiles where id = (select auth.uid());
  if coalesce(v_role, '') not in ('admin', 'supervisor', 'despacho') then
    raise exception 'No tenés permiso para corregir despachos' using errcode = '42501';
  end if;

  select * into v_event from public.records
    where entity = 'MovementEvent' and id = p_operation_id::text;
  if found then
    if v_event.data->>'action' = 'retiro_despacho'
      and v_event.data->>'unit_id' = p_pallet_id
      and v_event.data->>'origin_location_id' = p_shipment_id then
      return jsonb_build_object('operation_id', p_operation_id, 'already_applied', true);
    end if;
    raise exception 'El identificador de operación ya se utilizó para otro movimiento';
  end if;

  -- Lock in the same order as load_pallet_into_shipment to avoid deadlocks.
  select * into v_pallet from public.records
    where entity = 'Pallet' and id = p_pallet_id for update;
  if not found then raise exception 'Pallet no encontrado'; end if;

  select * into v_event from public.records
    where entity = 'MovementEvent' and id = p_operation_id::text;
  if found then
    if v_event.data->>'action' = 'retiro_despacho'
      and v_event.data->>'unit_id' = p_pallet_id
      and v_event.data->>'origin_location_id' = p_shipment_id then
      return jsonb_build_object('operation_id', p_operation_id, 'already_applied', true);
    end if;
    raise exception 'El identificador de operación ya se utilizó para otro movimiento';
  end if;

  select * into v_shipment from public.records
    where entity = 'Shipment' and id = p_shipment_id for update;
  if not found then raise exception 'Despacho no encontrado'; end if;
  if coalesce(v_shipment.data->>'status', '') not in ('borrador', 'reservado', 'cargado') then
    raise exception 'No se pueden retirar pallets de un despacho cerrado o anulado';
  end if;
  v_loaded := coalesce(v_shipment.data->'loaded_pallet_ids', '[]'::jsonb);
  if jsonb_typeof(v_loaded) <> 'array' then raise exception 'La lista de pallets del despacho es inválida'; end if;
  if not v_loaded @> jsonb_build_array(p_pallet_id)
    or v_pallet.data->>'shipment_id' is distinct from p_shipment_id
    or v_pallet.data->>'status' is distinct from 'despachado' then
    raise exception 'El pallet ya no figura cargado en este despacho';
  end if;

  select coalesce(jsonb_agg(value order by ord), '[]'::jsonb) into v_remaining
    from jsonb_array_elements_text(v_loaded) with ordinality as items(value, ord)
    where value <> p_pallet_id;
  select count(*), coalesce(sum(coalesce(nullif(r.data->>'net_weight', '')::numeric, 0)), 0),
    coalesce(sum(coalesce(nullif(r.data->>'package_count', '')::numeric, 0)), 0)
    into v_count, v_weight, v_packages
    from jsonb_array_elements_text(v_remaining) as ids(id)
    join public.records r on r.entity = 'Pallet' and r.id = ids.id;
  if v_count <> jsonb_array_length(v_remaining) then
    raise exception 'Faltan pallets en la carga; revisá sus datos antes de corregirla';
  end if;

  update public.records set
    data = (data - 'shipment_id') || jsonb_build_object('status', 'liberado'),
    updated_date = now()
    where entity = 'Pallet' and id = p_pallet_id;

  update public.records set
    data = data || jsonb_build_object(
      'loaded_pallet_ids', v_remaining,
      'total_weight', v_weight,
      'total_packages', v_packages,
      'status', case when jsonb_array_length(v_remaining) = 0 then 'borrador' else 'cargado' end
    ), updated_date = now()
    where entity = 'Shipment' and id = p_shipment_id;

  insert into public.records (entity, id, data) values (
    'MovementEvent', p_operation_id::text,
    jsonb_build_object(
      'id', p_operation_id::text,
      'event_code', 'MOV-' || p_operation_id::text,
      'operation_id', p_operation_id::text,
      'unit_type', 'pallet', 'unit_id', p_pallet_id,
      'unit_code', v_pallet.data->>'pallet_code',
      'origin_location_id', p_shipment_id,
      'origin_location_name', v_shipment.data->>'load_number',
      'destination_location_name', 'Disponible para despacho',
      'action', 'retiro_despacho'
    )
  );
  return jsonb_build_object('operation_id', p_operation_id, 'already_applied', false);
end;
$$;

revoke all on function public.unload_pallet_from_shipment(uuid,text,text) from public, anon;
grant execute on function public.unload_pallet_from_shipment(uuid,text,text) to authenticated;
