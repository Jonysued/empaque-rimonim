-- Keep existing layout keys and assigned numbers. Only extend available slots.
create or replace function public.cold_section_capacity(p_layout text,p_section integer) returns integer
language sql immutable set search_path='' as $$
 select case when p_layout='tunel_18' and p_section=0 then 18
 when p_layout in ('cinco_cargas','cuatro_cargas','camara_flexible') and p_section between 1 and 5 then 21 else 0 end
$$;
create or replace function public.guard_cold_storage() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_entity text; v_data jsonb; v_old jsonb; v_internal boolean;
begin
 if tg_op='UPDATE' and new.entity<>old.entity then raise exception 'El tipo de registro no se puede cambiar'; end if;
 v_entity:=case when tg_op='DELETE' then old.entity else new.entity end;
 v_data:=case when tg_op='DELETE' then old.data else new.data end;
 v_old:=case when tg_op='INSERT' then '{}'::jsonb else old.data end;
 v_internal:=coalesce(current_setting('rimonim.cold_command',true),'')='on';
 if not v_internal then
  if v_entity in ('CoolingCycle','StorageBatch') then
   raise exception 'Usá las operaciones de frío para gestionar ciclos y cargas';
  elsif v_entity='Pallet' then
   if (tg_op='DELETE' and v_data->>'location_id' is not null)
    or (tg_op<>'DELETE' and (v_data->>'location_id' is distinct from v_old->>'location_id'
     or v_data->>'storage_section' is distinct from v_old->>'storage_section'
     or v_data->>'storage_position' is distinct from v_old->>'storage_position'
     or v_data->>'storage_assignment_id' is distinct from v_old->>'storage_assignment_id'
     or v_data->>'storage_entered_at' is distinct from v_old->>'storage_entered_at'
     or v_data->>'storage_batch_id' is distinct from v_old->>'storage_batch_id'
     or v_data->>'cooling_cycle_id' is distinct from v_old->>'cooling_cycle_id'
     or v_data->>'cooling_entered_at' is distinct from v_old->>'cooling_entered_at'
     or v_data->>'cooling_started_at' is distinct from v_old->>'cooling_started_at'
     or v_data->>'cooling_finished_at' is distinct from v_old->>'cooling_finished_at'
     or (v_old->>'location_id' is not null and v_data->>'status' is distinct from v_old->>'status'))) then
    raise exception 'Confirmá el movimiento o la posición desde Frío';
   end if;
  elsif v_entity='MovementEvent' and (v_data ? 'cold_action' or v_old ? 'cold_action' or v_old->>'operation_action' in ('carga_tunel','carga_camara','liberacion_tunel','retiro_camara','inicio_prefrio','fin_prefrio','posicion','iniciar_carga','distribucion') or v_data->>'operation_action' in ('carga_tunel','carga_camara','liberacion_tunel','retiro_camara','inicio_prefrio','fin_prefrio','posicion','iniciar_carga','distribucion')) then
   raise exception 'Los eventos de frío se registran con su operación y no se pueden editar';
  elsif v_entity='Location' then
   if tg_op='INSERT' and (v_data ? 'storage_layout' or v_data ? 'storage_revision' or v_data ? 'fifth_load_enabled') then
    raise exception 'Elegí la distribución desde el plano de Frío';
   elsif tg_op='DELETE' and exists(select 1 from public.records where entity='Pallet' and data->>'location_id'=old.id) then
    raise exception 'La ubicación todavía contiene pallets';
   elsif tg_op='UPDATE' and (v_data->>'storage_layout' is distinct from v_old->>'storage_layout'
    or v_data->>'fifth_load_enabled' is distinct from v_old->>'fifth_load_enabled'
    or v_data->>'storage_revision' is distinct from v_old->>'storage_revision'
    or ((v_old ? 'storage_layout' or exists(select 1 from public.records where entity='Pallet' and data->>'location_id'=old.id))
      and (v_data->>'capacity' is distinct from v_old->>'capacity' or v_data->>'positions' is distinct from v_old->>'positions' or v_data->>'type' is distinct from v_old->>'type'))) then
    raise exception 'Elegí la distribución desde el plano de Frío';
   end if;
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create or replace function public.cold_storage_command(p_operation_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_location public.records; v_source public.records; v_pallet public.records; v_event public.records;
 v_batch public.records; v_layout text; v_section integer; v_position integer; v_cap integer; v_extra integer;
 v_location_id text:=p_payload->>'location_id'; v_source_id text; v_pallet_id text:=p_payload->>'pallet_id';
 v_data jsonb; v_count integer; v_now timestamptz:=now(); v_status text; v_batch_id text;
 v_result jsonb; v_previous_setting text:=coalesce(current_setting('rimonim.cold_command',true),'');
begin
 if p_operation_id is null or nullif(v_location_id,'') is null or coalesce(p_action,'') not in
 ('distribucion','ingresar','retirar','posicion','iniciar_carga','habilitar_quinta','completar_carga','reabrir_carga') then raise exception 'Operación de frío incompleta'; end if;
 if coalesce((select role from public.profiles where id=(select auth.uid())),'') not in ('admin','supervisor','frio') then
  raise exception 'No tenés permiso para gestionar frío' using errcode='42501'; end if;
 select * into v_event from public.records where entity='MovementEvent' and id=p_operation_id::text;
 if found then
  if v_event.data->>'cold_action'=p_action and v_event.data->'request'=p_payload then return v_event.data->'result'; end if;
  raise exception 'El identificador de operación ya fue usado';
 end if;
 if p_action in ('ingresar','retirar','posicion') then
  select data->>'location_id' into v_source_id from public.records where entity='Pallet' and id=v_pallet_id;
 end if;
 -- Lock all involved rooms in the same order before locking the pallet. This
 -- also serializes automatic slot assignment and cycle start against new scans.
 perform id from public.records where entity='Location' and id in (v_location_id,v_source_id) order by id for update;
 select * into v_location from public.records where entity='Location' and id=v_location_id;
 if not found or coalesce(v_location.data->>'type','') not in ('tunel','camara') then raise exception 'Ubicación de frío no encontrada'; end if;
 select * into v_event from public.records where entity='MovementEvent' and id=p_operation_id::text;
 if found then
  if v_event.data->>'cold_action'=p_action and v_event.data->'request'=p_payload then return v_event.data->'result'; end if;
  raise exception 'El identificador de operación ya fue usado';
 end if;
 v_now:=clock_timestamp();
 perform set_config('rimonim.cold_command','on',true);
 v_layout:=v_location.data->>'storage_layout';
 if p_action='distribucion' then
  if exists(select 1 from public.records where entity='Pallet' and data->>'location_id'=v_location_id and data->>'storage_position' is not null)
   or exists(select 1 from public.records where entity='CoolingCycle' and data->>'tunnel_id'=v_location_id and data->>'status'='abierto') then
   raise exception 'No se puede cambiar el plano con posiciones asignadas o prefrío en curso'; end if;
  v_layout:=p_payload->>'layout';
  if (v_location.data->>'type'='tunel' and v_layout is distinct from 'tunel_18')
   or (v_location.data->>'type'='camara' and coalesce(v_layout,'') not in ('cinco_cargas','cuatro_cargas','camara_flexible')) then raise exception 'Distribución inválida'; end if;
  v_cap:=case v_layout when 'cinco_cargas' then 101 when 'cuatro_cargas' then 84 when 'camara_flexible' then 101 else 18 end;
  if (select count(*) from public.records where entity='Pallet' and data->>'location_id'=v_location_id)>v_cap then raise exception 'Hay más pallets que posiciones en este plano'; end if;
  update public.records set data=data||jsonb_build_object('storage_layout',v_layout,'storage_revision',p_operation_id,'capacity',v_cap,'positions',v_cap,'fifth_load_enabled',v_layout='cinco_cargas'),updated_date=v_now where entity='Location' and id=v_location_id;
 elsif p_action='habilitar_quinta' then
  if v_location.data->>'type'<>'camara' or v_layout is null then raise exception 'Elegí primero el plano de la cámara'; end if;
  if coalesce((v_location.data->>'fifth_load_enabled')::boolean,v_layout='cinco_cargas') then raise exception 'La quinta carga ya está habilitada'; end if;
  update public.records set data=data||jsonb_build_object('fifth_load_enabled',true,'capacity',101,'positions',101,'storage_revision',p_operation_id),updated_date=v_now where entity='Location' and id=v_location_id;
 elsif p_action in ('iniciar_carga','completar_carga','reabrir_carga') then
  if v_location.data->>'type'<>'camara' then raise exception 'Esta operación corresponde a una carga de cámara'; end if;
  v_section:=(p_payload->>'section')::integer;
  select * into v_batch from public.records where entity='StorageBatch' and data->>'location_id'=v_location_id and (data->>'section')::integer=v_section and data->>'status'<>'cerrado' for update;
  if not found then raise exception 'La carga no contiene pallets'; end if;
  if p_payload->>'expected_batch' is not null and v_batch.id is distinct from p_payload->>'expected_batch' then raise exception 'La carga cambió; revisá y volvé a confirmar'; end if;
  v_batch_id:=v_batch.id;
  if p_action='completar_carga' then
   if v_batch.data->>'completed_at' is not null then raise exception 'La carga ya está completa'; end if;
   select count(*) into v_count from public.records where entity='Pallet' and data->>'storage_batch_id'=v_batch.id;
   if (v_section between 1 and 4 and v_count not in (20,21)) or (v_section=5 and v_count<1) then raise exception 'Las cargas 1 a 4 se completan con 20 o 21 pallets; la quinta con su cantidad real'; end if;
   update public.records set data=data||jsonb_build_object('status','completo','completed_at',v_now,'completed_count',v_count,'completion_target',v_count,'started_at',coalesce(data->>'started_at',v_now::text),'completed_by',auth.uid()),updated_date=v_now where entity='StorageBatch' and id=v_batch.id;
  elsif p_action='reabrir_carga' then
   if v_batch.data->>'completed_at' is null then raise exception 'La carga todavía está abierta'; end if;
   update public.records set data=(data-'completed_at'-'completed_count'-'completion_target'-'completed_by')||jsonb_build_object('status','llenando','reopened_at',v_now),updated_date=v_now where entity='StorageBatch' and id=v_batch.id;
  else
  if v_batch.data->>'started_at' is not null then raise exception 'La carga ya fue iniciada'; end if;
  update public.records set data=data||jsonb_build_object('started_at',v_now,'started_by',auth.uid()),updated_date=v_now where entity='StorageBatch' and id=v_batch.id;
  end if;
 else
  select * into v_pallet from public.records where entity='Pallet' and id=v_pallet_id for update;
  if not found then raise exception 'Pallet no encontrado'; end if;
  if v_pallet.data->>'location_id' is distinct from v_source_id then raise exception 'El pallet cambió de ubicación; revisá y volvé a confirmar'; end if;
  if p_payload ? 'expected_assignment' and v_pallet.data->>'storage_assignment_id' is distinct from p_payload->>'expected_assignment' then
   raise exception 'La posición del pallet cambió; revisá y volvé a confirmar'; end if;
  if exists(select 1 from public.records where entity='CoolingCycle' and data->>'tunnel_id' in (v_location_id,v_source_id) and data->>'status'='abierto') then
   raise exception 'Túnel bloqueado: no se pueden agregar, retirar ni mover pallets hasta finalizar el prefrío'; end if;
  if p_action in ('ingresar','posicion') then
   if v_layout is null then raise exception 'Elegí primero la distribución del plano'; end if;
   if p_payload ? 'expected_revision' and v_location.data->>'storage_revision' is distinct from p_payload->>'expected_revision' then raise exception 'El plano cambió; revisá y volvé a confirmar'; end if;
   if v_location.data->>'active'='false' then raise exception 'La ubicación está inactiva'; end if;
   v_section:=case when v_location.data->>'type'='tunel' then 0 else (p_payload->>'section')::integer end;
   v_cap:=public.cold_section_capacity(v_layout,v_section);
   if v_location.data->>'type'='camara' then
    if v_section=5 and not coalesce((v_location.data->>'fifth_load_enabled')::boolean,v_layout='cinco_cargas') then raise exception 'Habilitá primero la quinta carga'; end if;
    select count(*) into v_extra from public.records where entity='Pallet' and id<>v_pallet_id and data->>'location_id'=v_location_id and (data->>'storage_section')::integer between 1 and 4 and (data->>'storage_position')::integer=21;
    if v_section=5 then v_cap:=21-v_extra; end if;
    select * into v_batch from public.records where entity='StorageBatch' and data->>'location_id'=v_location_id and (data->>'section')::integer=v_section and data->>'status'<>'cerrado';
    if found and v_batch.data->>'completed_at' is not null and v_pallet.data->>'storage_batch_id' is distinct from v_batch.id then raise exception 'La carga está completa; reabrila antes de agregar pallets'; end if;
   end if;
   if v_cap=0 or v_cap is null then raise exception 'Elegí una carga del plano'; end if;
   v_position:=(p_payload->>'position')::integer;
   if v_position is null then
    select n into v_position from generate_series(1,v_cap) n where not exists(select 1 from public.records where entity='Pallet' and id<>v_pallet_id and data->>'location_id'=v_location_id and (data->>'storage_section')::integer=v_section and (data->>'storage_position')::integer=n) order by n limit 1;
   end if;
   if v_position is null then raise exception 'La carga no tiene posiciones disponibles'; end if;
   if v_location.data->>'type'='camara' and v_section between 1 and 4 and v_position=21 and exists(select 1 from public.records where entity='Pallet' and id<>v_pallet_id and data->>'location_id'=v_location_id and (data->>'storage_section')::integer=5 and (data->>'storage_position')::integer>20-v_extra) then raise exception 'La posición 21 ocupa espacio de la quinta carga; liberá primero sus últimas posiciones'; end if;
   if v_position<1 or v_position>v_cap then raise exception 'Posición fuera del plano'; end if;
   if exists(select 1 from public.records where entity='Pallet' and id<>v_pallet_id and data->>'location_id'=v_location_id and (data->>'storage_section')::integer=v_section and (data->>'storage_position')::integer=v_position) then raise exception 'Esta posición ya está ocupada'; end if;
  end if;
  if p_action='ingresar' then
   if exists(select 1 from public.records where entity='Pallet' and data->>'location_id'=v_location_id and data->>'storage_position' is null) then raise exception 'Confirmá las posiciones de los pallets existentes antes de agregar otros'; end if;
   if v_source_id=v_location_id then raise exception 'El pallet ya está en esta ubicación; usá Editar posición'; end if;
   if v_pallet.data->>'shipment_id' is not null or coalesce((v_pallet.data->>'held')::boolean,false) then raise exception 'El pallet está retenido o asignado a un despacho'; end if;
   if v_source_id is not null then
    select * into v_source from public.records where entity='Location' and id=v_source_id;
    if v_location.data->>'type'<>'camara' or v_source.data->>'type'<>'tunel' or v_pallet.data->>'status'<>'prefrio_finalizado' then raise exception 'Confirmá primero la salida de la ubicación actual'; end if;
   end if;
   if (v_location.data->>'type'='tunel' and coalesce(v_pallet.data->>'status','') not in ('armado','cerrado','prefrio_finalizado')) or
    (v_location.data->>'type'='camara' and coalesce(v_pallet.data->>'status','') not in ('prefrio_finalizado','liberado')) then raise exception 'El estado del pallet no permite este ingreso'; end if;
   if (select count(*) from public.records where entity='Pallet' and data->>'location_id'=v_location_id)>= (v_location.data->>'capacity')::integer then raise exception 'La ubicación está completa'; end if;
   v_data:=v_pallet.data||jsonb_build_object('status',case when v_location.data->>'type'='tunel' then 'en_tunel' else 'en_camara' end,'previous_status',v_pallet.data->>'status','location_id',v_location_id,'location_name',v_location.data->>'name','storage_entered_at',v_now);
   if v_location.data->>'type'='tunel' then v_data:=v_data-'cooling_entered_at'-'cooling_cycle_id'-'cooling_started_at'-'cooling_finished_at'; end if;
  elsif p_action='posicion' then
   if v_source_id is distinct from v_location_id then raise exception 'El pallet ya no se encuentra en esta ubicación'; end if;
   v_data:=v_pallet.data;
  else
   if v_source_id is distinct from v_location_id then raise exception 'El pallet ya no se encuentra en esta ubicación'; end if;
   v_status:=case when v_location.data->>'type'='camara' then 'liberado' when v_pallet.data->>'status'='prefrio_finalizado' then 'prefrio_finalizado' else coalesce(v_pallet.data->>'previous_status','cerrado') end;
   v_data:=(v_pallet.data-'location_id'-'location_name'-'storage_section'-'storage_position'-'storage_assignment_id'-'storage_entered_at'-'storage_batch_id')||jsonb_build_object('status',v_status);
  end if;
  if p_action in ('ingresar','posicion') then
   v_data:=v_data||jsonb_build_object('storage_section',v_section,'storage_position',v_position,'storage_assignment_id',p_operation_id);
   if v_location.data->>'type'='camara' then
    select * into v_batch from public.records where entity='StorageBatch' and data->>'location_id'=v_location_id and (data->>'section')::integer=v_section and data->>'status'<>'cerrado' for update;
    if not found then
     v_batch_id:=p_operation_id::text||':carga';
     insert into public.records(entity,id,data) values('StorageBatch',v_batch_id,jsonb_build_object('id',v_batch_id,'location_id',v_location_id,'section',v_section,'first_entry_at',v_data->'storage_entered_at','status','llenando','capacity',v_cap));
    else v_batch_id:=v_batch.id; end if;
    v_data:=v_data||jsonb_build_object('storage_batch_id',v_batch_id);
   else v_data:=v_data-'storage_batch_id'; end if;
  end if;
  update public.records set data=v_data,updated_date=v_now where entity='Pallet' and id=v_pallet_id;
  update public.records l set data=l.data||jsonb_build_object('occupied',(select count(*) from public.records p where p.entity='Pallet' and p.data->>'location_id'=l.id)),updated_date=v_now where l.entity='Location' and l.id in (v_location_id,v_source_id);
  -- Historical batches never lose their start time or member IDs on departure.
  update public.records b set data=b.data||jsonb_build_object('status','cerrado','closed_at',v_now),updated_date=v_now where b.entity='StorageBatch' and b.data->>'location_id' in (v_location_id,v_source_id) and b.data->>'status'<>'cerrado' and not exists(select 1 from public.records p where p.entity='Pallet' and p.data->>'storage_batch_id'=b.id);
  if v_batch_id is not null then
   select count(*) into v_count from public.records where entity='Pallet' and data->>'storage_batch_id'=v_batch_id;
   update public.records set data=data||jsonb_build_object('pallet_ids',coalesce(data->'pallet_ids','[]'::jsonb)||case when not(coalesce(data->'pallet_ids','[]'::jsonb) @> jsonb_build_array(v_pallet_id)) then jsonb_build_array(v_pallet_id) else '[]'::jsonb end)
    ||case when v_count=v_cap and data->>'completed_at' is null then jsonb_build_object('completed_count',v_count,'completion_target',v_count,'completed_at',v_now,'started_at',coalesce(data->>'started_at',v_now::text),'status','completo') else '{}'::jsonb end,updated_date=v_now where entity='StorageBatch' and id=v_batch_id;
  end if;
 end if;
 v_result:=jsonb_build_object('operation_id',p_operation_id,'position',v_position,'section',v_section,'already_applied',false);
 insert into public.records(entity,id,data) values('MovementEvent',p_operation_id::text,
  jsonb_build_object('id',p_operation_id,'event_code','MOV-'||p_operation_id,'cold_action',p_action,'request',p_payload,'result',v_result,'occurred_at',v_now,'actor_id',auth.uid(),'unit_type',case when v_pallet_id is null then 'location' else 'pallet' end,'unit_id',coalesce(v_pallet_id,v_location_id),'unit_code',v_pallet.data->>'pallet_code',
   'operation_action',case when p_action='ingresar' and v_location.data->>'type'='tunel' then 'carga_tunel' when p_action='ingresar' then 'carga_camara' when p_action='retirar' and v_location.data->>'type'='tunel' then 'liberacion_tunel' when p_action='retirar' then 'retiro_camara' else p_action end,
   'origin_location_id',v_source_id,'origin_location_name',v_pallet.data->>'location_name','origin_section',v_pallet.data->'storage_section','origin_position',v_pallet.data->'storage_position','origin_entered_at',v_pallet.data->>'storage_entered_at','origin_batch_id',v_pallet.data->>'storage_batch_id','destination_location_id',case when p_action<>'retirar' then v_location_id end,'destination_location_name',case when p_action<>'retirar' then v_location.data->>'name' end,'destination_section',v_section,'destination_position',v_position,'storage_batch_id',v_batch_id,'previous_batch',case when p_action in ('completar_carga','reabrir_carga') then v_batch.data else null end));
 perform set_config('rimonim.cold_command',v_previous_setting,true);
 return v_result;
end $$;
revoke all on function public.cold_storage_command(uuid,text,jsonb) from public,anon;
grant execute on function public.cold_storage_command(uuid,text,jsonb) to authenticated;

