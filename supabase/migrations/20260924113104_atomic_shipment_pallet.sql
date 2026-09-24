-- Additive migration: the current web client keeps working while this RPC is rolled out.
-- A movement's UUID is also its record ID. Repeating a request returns the original result.
create or replace function public.load_pallet_into_shipment(
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
  v_result jsonb;
  v_capacity integer;
  v_role text;
begin
  if p_operation_id is null or nullif(p_shipment_id, '') is null or nullif(p_pallet_id, '') is null then
    raise exception 'Faltan datos de la operación';
  end if;
  select role into v_role from public.profiles where id = (select auth.uid());
  if coalesce(v_role, '') not in ('admin', 'supervisor', 'despacho') then
    raise exception 'No tenés permiso para cargar pallets en despachos' using errcode = '42501';
  end if;

  -- Check before and after the pallet lock: a retry may arrive while the first
  -- request is still committing. Locking the pallet serializes conflicting moves.
  select * into v_event from public.records
    where entity = 'MovementEvent' and id = p_operation_id::text;
  if found then
    if v_event.data->>'action' = 'carga_despacho'
      and v_event.data->>'unit_id' = p_pallet_id
      and v_event.data->>'destination_location_id' = p_shipment_id then
      return jsonb_build_object('operation_id', p_operation_id, 'already_applied', true);
    end if;
    raise exception 'El identificador de operación ya se utilizó para otro movimiento';
  end if;

  select * into v_pallet from public.records
    where entity = 'Pallet' and id = p_pallet_id for update;
  if not found then raise exception 'Pallet no encontrado'; end if;

  select * into v_event from public.records
    where entity = 'MovementEvent' and id = p_operation_id::text;
  if found then
    if v_event.data->>'action' = 'carga_despacho'
      and v_event.data->>'unit_id' = p_pallet_id
      and v_event.data->>'destination_location_id' = p_shipment_id then
      return jsonb_build_object('operation_id', p_operation_id, 'already_applied', true);
    end if;
    raise exception 'El identificador de operación ya se utilizó para otro movimiento';
  end if;

  select * into v_shipment from public.records
    where entity = 'Shipment' and id = p_shipment_id for update;
  if not found then raise exception 'Despacho no encontrado'; end if;
  if coalesce(v_shipment.data->>'status', '') not in ('borrador', 'reservado', 'cargado') then
    raise exception 'Este despacho ya está cerrado o anulado';
  end if;
  if coalesce(v_pallet.data->>'status', '') not in ('prefrio_finalizado', 'liberado')
    or coalesce((v_pallet.data->>'held')::boolean, false)
    or v_pallet.data->>'shipment_id' is not null then
    raise exception 'El pallet ya no está disponible para despacho';
  end if;
  if v_pallet.data->>'product_type' is distinct from v_shipment.data->>'product_type' then
    raise exception 'El pallet y el despacho tienen productos distintos';
  end if;
  v_loaded := coalesce(v_shipment.data->'loaded_pallet_ids', '[]'::jsonb);
  if jsonb_typeof(v_loaded) <> 'array' then raise exception 'La lista de pallets del despacho es inválida'; end if;
  if v_loaded @> jsonb_build_array(p_pallet_id) then
    raise exception 'El pallet ya figura en este despacho';
  end if;
  v_capacity := coalesce(nullif(v_shipment.data->>'target_capacity', '')::integer, 21);
  if v_capacity < 1 or jsonb_array_length(v_loaded) >= v_capacity then
    raise exception 'Capacidad de carga alcanzada';
  end if;

  update public.records set
    data = (data - 'location_id' - 'location_name') || jsonb_build_object(
      'status', 'despachado', 'shipment_id', p_shipment_id
    ), updated_date = now()
    where entity = 'Pallet' and id = p_pallet_id;

  update public.records set
    data = data || jsonb_build_object(
      'loaded_pallet_ids', v_loaded || jsonb_build_array(p_pallet_id),
      'total_weight', coalesce((v_shipment.data->>'total_weight')::numeric, 0) + coalesce((v_pallet.data->>'net_weight')::numeric, 0),
      'total_packages', coalesce((v_shipment.data->>'total_packages')::numeric, 0) + coalesce((v_pallet.data->>'package_count')::numeric, 0),
      'status', 'cargado'
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
      'origin_location_id', v_pallet.data->>'location_id',
      'origin_location_name', v_pallet.data->>'location_name',
      'destination_location_id', p_shipment_id,
      'destination_location_name', v_shipment.data->>'load_number',
      'action', 'carga_despacho'
    )
  );
  v_result := jsonb_build_object('operation_id', p_operation_id, 'already_applied', false);
  return v_result;
end;
$$;

revoke all on function public.load_pallet_into_shipment(uuid,text,text) from public, anon;
grant execute on function public.load_pallet_into_shipment(uuid,text,text) to authenticated;
