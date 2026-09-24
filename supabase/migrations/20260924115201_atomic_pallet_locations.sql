-- One server-side movement per scan. The location lock protects capacity when
-- several devices move different pallets to the same room simultaneously.
create or replace function public.move_pallet_location(
  p_operation_id uuid,
  p_action text,
  p_pallet_id text,
  p_location_id text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_location public.records;
  v_pallet public.records;
  v_event public.records;
  v_cycle public.records;
  v_count integer;
  v_status text;
  v_kind text;
  v_data jsonb;
begin
  if p_operation_id is null or nullif(p_pallet_id,'') is null or nullif(p_location_id,'') is null
    or coalesce(p_action,'') not in ('carga_tunel','liberacion_tunel','carga_camara','retiro_camara') then
    raise exception 'Movimiento incompleto o desconocido';
  end if;
  if coalesce((select role from public.profiles where id=(select auth.uid())), '')
    not in ('admin','supervisor','frio') then
    raise exception 'No tenés permiso para mover pallets' using errcode='42501';
  end if;

  select * into v_event from public.records where entity='MovementEvent' and id=p_operation_id::text;
  if found then
    if v_event.data->>'operation_action'=p_action and v_event.data->>'unit_id'=p_pallet_id
      and v_event.data->>'operation_location_id'=p_location_id then
      return jsonb_build_object('operation_id',p_operation_id,'already_applied',true);
    end if;
    raise exception 'El identificador de operación ya fue usado';
  end if;

  select * into v_location from public.records
    where entity='Location' and id=p_location_id for update;
  if not found then raise exception 'Ubicación no encontrada'; end if;
  v_kind := v_location.data->>'type';
  if (p_action in ('carga_tunel','liberacion_tunel') and v_kind <> 'tunel')
    or (p_action in ('carga_camara','retiro_camara') and v_kind <> 'camara') then
    raise exception 'Tipo de ubicación incorrecto';
  end if;
  if p_action in ('carga_tunel','carga_camara') and v_location.data->>'active'='false' then
    raise exception 'La ubicación está inactiva';
  end if;

  select * into v_pallet from public.records
    where entity='Pallet' and id=p_pallet_id for update;
  if not found then raise exception 'Pallet no encontrado'; end if;
  -- The location lock and the pallet lock also serialize a retry that arrived
  -- before the first request committed.
  select * into v_event from public.records where entity='MovementEvent' and id=p_operation_id::text;
  if found then
    if v_event.data->>'operation_action'=p_action and v_event.data->>'unit_id'=p_pallet_id
      and v_event.data->>'operation_location_id'=p_location_id then
      return jsonb_build_object('operation_id',p_operation_id,'already_applied',true);
    end if;
    raise exception 'El identificador de operación ya fue usado';
  end if;

  if p_action in ('carga_tunel','carga_camara') then
    if v_pallet.data->>'location_id' is not null or v_pallet.data->>'shipment_id' is not null
      or coalesce((v_pallet.data->>'held')::boolean,false) then
      raise exception 'El pallet ya tiene ubicación, está retenido o fue despachado';
    end if;
    if (p_action='carga_tunel' and coalesce(v_pallet.data->>'status','') not in ('armado','cerrado','prefrio_finalizado'))
      or (p_action='carga_camara' and coalesce(v_pallet.data->>'status','') not in ('prefrio_finalizado','liberado')) then
      raise exception 'El estado del pallet no permite este ingreso';
    end if;
    select count(*) into v_count from public.records
      where entity='Pallet' and data->>'location_id'=p_location_id
      and ((v_kind='tunel' and data->>'status' in ('en_tunel','prefrio_finalizado'))
        or (v_kind='camara' and data->>'status'='en_camara'));
    if coalesce((v_location.data->>'capacity')::integer,0) <= v_count then
      raise exception 'La ubicación no tiene capacidad disponible';
    end if;
    if p_action='carga_tunel' then
      v_data:=v_pallet.data || jsonb_build_object('status','en_tunel',
        'previous_status',v_pallet.data->>'status',
        'location_id',p_location_id,'location_name',v_location.data->>'name');
      select * into v_cycle from public.records where entity='CoolingCycle'
        and data->>'tunnel_id'=p_location_id and data->>'status'='abierto'
        order by created_date desc limit 1 for update;
      if found and not (coalesce(v_cycle.data->'pallet_ids','[]'::jsonb) @> jsonb_build_array(p_pallet_id)) then
        update public.records set data=data || jsonb_build_object(
          'pallet_ids',coalesce(data->'pallet_ids','[]'::jsonb) || jsonb_build_array(p_pallet_id)),
          updated_date=now() where entity='CoolingCycle' and id=v_cycle.id;
      end if;
    else
      v_data:=v_pallet.data || jsonb_build_object('status','en_camara',
        'location_id',p_location_id,'location_name',v_location.data->>'name');
    end if;
  else
    if v_pallet.data->>'location_id' is distinct from p_location_id
      or ((p_action='liberacion_tunel') and coalesce(v_pallet.data->>'status','') not in ('en_tunel','prefrio_finalizado'))
      or ((p_action='retiro_camara') and coalesce(v_pallet.data->>'status','') <> 'en_camara') then
      raise exception 'El pallet ya no se encuentra en esa ubicación';
    end if;
    if p_action='liberacion_tunel' and exists (
      select 1 from public.records where entity='CoolingCycle'
      and data->>'tunnel_id'=p_location_id and data->>'status'='abierto'
    ) then raise exception 'Finalizá el enfriado antes de liberar este pallet'; end if;
    v_status:=case when p_action='retiro_camara' then 'liberado'
      when v_pallet.data->>'status'='prefrio_finalizado' then 'prefrio_finalizado'
      else coalesce(v_pallet.data->>'previous_status','cerrado') end;
    v_data:=(v_pallet.data - 'location_id' - 'location_name') || jsonb_build_object('status',v_status);
  end if;

  update public.records set data=v_data,updated_date=now()
    where entity='Pallet' and id=p_pallet_id;
  select count(*) into v_count from public.records where entity='Pallet'
    and data->>'location_id'=p_location_id
    and ((v_kind='tunel' and data->>'status' in ('en_tunel','prefrio_finalizado'))
      or (v_kind='camara' and data->>'status'='en_camara'));
  update public.records set data=data || jsonb_build_object('occupied',v_count),updated_date=now()
    where entity='Location' and id=p_location_id;

  insert into public.records(entity,id,data) values ('MovementEvent',p_operation_id::text,
    jsonb_build_object('id',p_operation_id::text,'operation_action',p_action,
      'operation_location_id',p_location_id,'event_code','MOV-'||p_operation_id::text,
      'unit_type','pallet','unit_id',p_pallet_id,'unit_code',v_pallet.data->>'pallet_code',
      'action',case when p_action='retiro_camara' then 'traslado' else p_action end)
    || case when p_action in ('carga_tunel','carga_camara') then
      jsonb_build_object('destination_location_id',p_location_id,
        'destination_location_name',v_location.data->>'name')
    else jsonb_build_object('origin_location_id',p_location_id,
        'origin_location_name',v_location.data->>'name') end);
  return jsonb_build_object('operation_id',p_operation_id,'already_applied',false);
end;
$$;
revoke all on function public.move_pallet_location(uuid,text,text,text) from public,anon;
grant execute on function public.move_pallet_location(uuid,text,text,text) to authenticated;
