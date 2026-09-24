-- Cooling start/finish and all pallet releases commit together under a tunnel lock.
create unique index if not exists records_cooling_finish_operation_unique
  on public.records ((data->>'finish_operation_id'))
  where entity='CoolingCycle' and data ? 'finish_operation_id';
create or replace function public.change_cooling_cycle(
  p_operation_id uuid,
  p_action text,
  p_tunnel_id text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_tunnel public.records;
  v_cycle public.records;
  v_pallet public.records;
  v_ids jsonb;
  v_count integer := 0;
begin
  if p_operation_id is null or nullif(p_tunnel_id,'') is null
    or coalesce(p_action,'') not in ('iniciar','finalizar') then
    raise exception 'Operación de enfriado incompleta';
  end if;
  if coalesce((select role from public.profiles where id=(select auth.uid())), '')
    not in ('admin','supervisor','frio') then
    raise exception 'No tenés permiso para gestionar el enfriado' using errcode='42501';
  end if;
  select * into v_tunnel from public.records
    where entity='Location' and id=p_tunnel_id for update;
  if not found or v_tunnel.data->>'type' is distinct from 'tunel' then
    raise exception 'Túnel no encontrado';
  end if;

  if p_action='iniciar' then
    select * into v_cycle from public.records where entity='CoolingCycle' and id=p_operation_id::text;
    if found then
      if v_cycle.data->>'tunnel_id'=p_tunnel_id and v_cycle.data->>'start_operation_id'=p_operation_id::text then
        return jsonb_build_object('operation_id',p_operation_id,'already_applied',true);
      end if;
      raise exception 'El identificador de operación ya fue usado';
    end if;
    if exists (select 1 from public.records where entity='CoolingCycle'
      and data->>'tunnel_id'=p_tunnel_id and data->>'status'='abierto') then
      raise exception 'El túnel ya tiene un enfriado abierto';
    end if;
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_ids
      from public.records where entity='Pallet'
      and data->>'location_id'=p_tunnel_id and data->>'status'='en_tunel';
    insert into public.records(entity,id,data) values('CoolingCycle',p_operation_id::text,
      jsonb_build_object('id',p_operation_id::text,'start_operation_id',p_operation_id::text,
        'cycle_code','CIC-'||p_operation_id::text,'tunnel_id',p_tunnel_id,
        'tunnel_name',v_tunnel.data->>'name','start_time',now(),
        'reference_hours',15,'status','abierto','pallet_ids',v_ids,
        'target_temp',coalesce((v_tunnel.data->>'target_temp')::numeric,0),'initial_temp',0));
  else
    select * into v_cycle from public.records where entity='CoolingCycle'
      and data->>'finish_operation_id'=p_operation_id::text limit 1;
    if found then
      if v_cycle.data->>'tunnel_id'=p_tunnel_id then
        return jsonb_build_object('operation_id',p_operation_id,'already_applied',true);
      end if;
      raise exception 'El identificador de operación ya fue usado';
    end if;
    select * into v_cycle from public.records where entity='CoolingCycle'
      and data->>'tunnel_id'=p_tunnel_id and data->>'status'='abierto'
      order by created_date desc limit 1 for update;
    if not found then raise exception 'El túnel no tiene un enfriado abierto'; end if;
    for v_pallet in select * from public.records where entity='Pallet'
      and data->>'location_id'=p_tunnel_id and data->>'status'='en_tunel'
      order by id for update loop
      update public.records set data=(data - 'location_id' - 'location_name')
        || jsonb_build_object('status','prefrio_finalizado'),updated_date=now()
        where entity='Pallet' and id=v_pallet.id;
      insert into public.records(entity,id,data) values('MovementEvent',p_operation_id::text||':'||v_pallet.id,
        jsonb_build_object('id',p_operation_id::text||':'||v_pallet.id,
          'event_code','MOV-'||p_operation_id::text||'-'||v_pallet.id,
          'operation_id',p_operation_id::text,'unit_type','pallet',
          'unit_id',v_pallet.id,'unit_code',v_pallet.data->>'pallet_code',
          'origin_location_id',p_tunnel_id,'origin_location_name',v_tunnel.data->>'name',
          'action','liberacion_tunel'));
      v_count:=v_count+1;
    end loop;
    update public.records set data=data || jsonb_build_object(
      'status','cerrado','end_time',now(),'finish_operation_id',p_operation_id::text),
      updated_date=now() where entity='CoolingCycle' and id=v_cycle.id;
    select count(*) into v_count from public.records where entity='Pallet'
      and data->>'location_id'=p_tunnel_id
      and data->>'status' in ('en_tunel','prefrio_finalizado');
    update public.records set data=data || jsonb_build_object('occupied',v_count),
      updated_date=now() where entity='Location' and id=p_tunnel_id;
  end if;
  return jsonb_build_object('operation_id',p_operation_id,'already_applied',false);
end;
$$;
revoke all on function public.change_cooling_cycle(uuid,text,text) from public,anon;
grant execute on function public.change_cooling_cycle(uuid,text,text) to authenticated;
