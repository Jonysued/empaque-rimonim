-- Capture physical departure separately from pallet loading. No historical dates
-- are inferred; previously sent shipments keep an unknown departure time.
create or replace function public.record_shipment_departure()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  v_operation text;
  v_pallet public.records;
  v_id text;
  v_loaded jsonb;
begin
  if new.entity <> 'Shipment' then return new; end if;
  if new.data->>'status' is not distinct from old.data->>'status' then
    new.data := new.data - 'dispatched_at' - 'dispatch_event_id';
    -- Preserve server timestamps even if a client edits shipment metadata.
    if old.data ? 'dispatched_at' then new.data := new.data || jsonb_build_object('dispatched_at',old.data->'dispatched_at'); end if;
    if old.data ? 'dispatch_event_id' then new.data := new.data || jsonb_build_object('dispatch_event_id',old.data->'dispatch_event_id'); end if;
    return new;
  end if;
  if old.data->>'status'='enviado' then
    new.data := new.data - 'dispatched_at' - 'dispatch_event_id';
  end if;
  if new.data->>'status' <> 'enviado' or new.data->>'status' is null then return new; end if;
  if coalesce((select role from public.profiles where id=(select auth.uid())),'') not in ('admin','supervisor','despacho') then
    raise exception 'No tenés permiso para confirmar el despacho' using errcode='42501';
  end if;
  v_loaded := coalesce(new.data->'loaded_pallet_ids','[]');
  if jsonb_typeof(v_loaded)<>'array' or jsonb_array_length(v_loaded)=0 then
    raise exception 'La carga debe tener pallets para confirmar su salida';
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(v_loaded)) <> jsonb_array_length(v_loaded) then
    raise exception 'Hay pallets repetidos en la carga';
  end if;
  v_operation := gen_random_uuid()::text;
  for v_id in select value from jsonb_array_elements_text(v_loaded) loop
    select * into v_pallet from public.records where entity='Pallet' and id=v_id;
    if not found or v_pallet.data->>'shipment_id' is distinct from new.id or v_pallet.data->>'status' is distinct from 'despachado' then
      raise exception 'Los pallets de la carga no coinciden con el despacho';
    end if;
    insert into public.records(entity,id,data) values('MovementEvent',v_operation||':'||v_id,
      jsonb_build_object('id',v_operation||':'||v_id,'event_code','MOV-'||v_operation||':'||v_id,
        'operation_id',v_operation,'unit_type','pallet','unit_id',v_id,
        'unit_code',v_pallet.data->>'pallet_code','action','salida_despacho',
        'shipment_id',new.id,'origin_location_id',new.id,
        'origin_location_name',new.data->>'load_number','destination_location_name',new.data->>'destination',
        'occurred_at',now(),'operator_id',(select auth.uid())));
  end loop;
  new.data := new.data || jsonb_build_object('dispatched_at',now(),'dispatch_event_id',v_operation);
  return new;
end;
$$;
revoke all on function public.record_shipment_departure() from public,anon,authenticated;
create trigger record_shipment_departure before update on public.records
for each row when (new.entity='Shipment') execute function public.record_shipment_departure();
