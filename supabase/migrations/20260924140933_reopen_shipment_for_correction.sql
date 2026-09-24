-- Reopen a sent shipment explicitly before pallet corrections. The event makes
-- the change visible in the shared movement history and retries harmless.
create or replace function public.reopen_shipment_for_correction(
  p_operation_id uuid,
  p_shipment_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_shipment public.records;
  v_event public.records;
  v_loaded jsonb;
  v_role text;
begin
  if p_operation_id is null or nullif(p_shipment_id, '') is null then
    raise exception 'Faltan datos de la operación';
  end if;
  select role into v_role from public.profiles where id = (select auth.uid());
  if coalesce(v_role, '') not in ('admin', 'supervisor', 'despacho') then
    raise exception 'No tenés permiso para corregir despachos' using errcode = '42501';
  end if;

  select * into v_event from public.records
    where entity = 'MovementEvent' and id = p_operation_id::text;
  if found then
    if v_event.data->>'action' = 'reapertura_despacho'
      and v_event.data->>'unit_id' = p_shipment_id then
      return jsonb_build_object('operation_id', p_operation_id, 'already_applied', true);
    end if;
    raise exception 'El identificador de operación ya se utilizó para otro movimiento';
  end if;

  select * into v_shipment from public.records
    where entity = 'Shipment' and id = p_shipment_id for update;
  if not found then raise exception 'Despacho no encontrado'; end if;

  select * into v_event from public.records
    where entity = 'MovementEvent' and id = p_operation_id::text;
  if found then
    if v_event.data->>'action' = 'reapertura_despacho'
      and v_event.data->>'unit_id' = p_shipment_id then
      return jsonb_build_object('operation_id', p_operation_id, 'already_applied', true);
    end if;
    raise exception 'El identificador de operación ya se utilizó para otro movimiento';
  end if;
  if v_shipment.data->>'status' is distinct from 'enviado' then
    raise exception 'El despacho ya fue reabierto o no está enviado';
  end if;
  v_loaded := coalesce(v_shipment.data->'loaded_pallet_ids', '[]'::jsonb);
  if jsonb_typeof(v_loaded) <> 'array' then raise exception 'La lista de pallets del despacho es inválida'; end if;

  update public.records set data = data || jsonb_build_object(
    'status', case when jsonb_array_length(v_loaded) = 0 then 'borrador' else 'cargado' end
  ), updated_date = now()
  where entity = 'Shipment' and id = p_shipment_id;

  insert into public.records(entity,id,data) values (
    'MovementEvent', p_operation_id::text,
    jsonb_build_object(
      'id', p_operation_id::text,
      'event_code', 'MOV-' || p_operation_id::text,
      'operation_id', p_operation_id::text,
      'unit_type', 'shipment', 'unit_id', p_shipment_id,
      'unit_code', v_shipment.data->>'shipment_code',
      'action', 'reapertura_despacho',
      'notes', 'Reabierto para corregir pallets de un despacho enviado',
      'operator_id', (select auth.uid())
    )
  );
  return jsonb_build_object('operation_id', p_operation_id, 'already_applied', false);
end;
$$;

revoke all on function public.reopen_shipment_for_correction(uuid,text) from public, anon;
grant execute on function public.reopen_shipment_for_correction(uuid,text) to authenticated;
