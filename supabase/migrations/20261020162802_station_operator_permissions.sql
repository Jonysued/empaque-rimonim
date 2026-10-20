-- A bounded, non-login executor inherits authenticated policies and has NO
-- BYPASSRLS. Only validated command wrappers run as this role; REST clients
-- cannot become it. Company RLS remains mandatory inside every command.
create role empaco_station_executor nologin inherit nobypassrls;
grant authenticated to empaco_station_executor;
-- Supabase's postgres role has CREATEROLE but is not a superuser. Explicit
-- membership permits transferring wrapper ownership without granting clients
-- membership of the executor.
grant empaco_station_executor to postgres with set true;
grant usage,create on schema public,empaque_private to empaco_station_executor;

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in
 ('admin','supervisor','consulta','user','cosecha','consolidado','pesado','playa','vuelco','produccion','prefrio','camaras','despacho','insumos','recepcion','frio','calidad'));
alter table public.company_memberships drop constraint company_memberships_role_check;
alter table public.company_memberships add constraint company_memberships_role_check check(role in
 ('admin','supervisor','consulta','user','cosecha','consolidado','pesado','playa','vuelco','produccion','prefrio','camaras','despacho','insumos','recepcion','frio','calidad'));

create function empaque_private.station_read(p_role text,p_entity text,p_data jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(r in ('admin','supervisor','consulta')
  or (r='cosecha' and (p_entity='Bin' or p_entity='Catalog' and p_data->>'type' in ('productor','variedad','cuadro','especie','tipo_cosecha','cuadrilla')))
  or (r in ('consolidado','pesado','playa','vuelco') and p_entity in ('ReceiptLot','Bin'))
  or (r='consolidado' and p_entity='Catalog' and p_data->>'type'='transportista')
  or (r='vuelco' and p_entity='DumpingEvent')
  or (r='produccion' and (p_entity='Pallet' or p_entity='Catalog' and p_data->>'type' in ('productor','variedad','categoria','calibre','envase','marca')))
  or (r in ('prefrio','camaras') and (p_entity='Pallet' or p_entity='Location' and p_data->>'type'=case when r='prefrio' then 'tunel' else 'camara' end
    or r='prefrio' and p_entity='CoolingCycle' or r='camaras' and p_entity='StorageBatch'))
  or (r='despacho' and (p_entity in ('Pallet','Shipment') or p_entity='Catalog' and p_data->>'type' in ('cliente','destino'))),false)
 from (select p_role r) roles
$$;
revoke all on function empaque_private.station_read(text,text,jsonb) from public,anon;
grant execute on function empaque_private.station_read(text,text,jsonb) to authenticated;
create policy records_station_read on public.records as restrictive for select to authenticated
 using((select empaque_private.my_role()) in ('admin','supervisor','consulta') or current_user='empaco_station_executor');

-- Shared fruit identifiers are necessary at hand-off, but downstream weights,
-- movements and process histories must not leak through a shared JSON record.
create function empaque_private.station_data(r text,e text,d jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare keys text[]; result jsonb; actions text[];
begin
 if r in ('admin','supervisor','consulta') then return d; end if;
 keys:=array['id','created_date','status','held','producer','variety','origin','species','harvest_type','crew','crew_breakdown','harvest_date','quality_notes'];
 if e='Catalog' then return d; end if;
 if e='Bin' then
  keys:=keys||array['bin_code','harvest_workflow','field_workflow','scanned_at','scanned_by','harvest_operation_id','harvest_payload','receipt_lot_id','receipt_lot_code'];
  if r in ('pesado','playa','vuelco') then keys:=keys||array['net_weight','measured']; end if;
  if r='vuelco' then keys:=keys||array['dumped_at','dump_operation_id','dump_code','dumped_by']; end if;
 elsif e='ReceiptLot' then
  keys:=keys||array['lot_code','transport','workflow_version','field_created_at','field_closed_at','expected_bins_count','bins_count'];
  if r in ('pesado','playa','vuelco') then keys:=keys||array['gross_weight','tare_weight','net_weight','bin_weight','weighed_at','weighed_by']; end if;
  if r in ('playa','vuelco') then keys:=keys||array['receipt_date','yard_received_at','yard_received_by']; end if;
  if r='vuelco' then keys:=keys||array['bins_dumped','dumped_weight','remaining_weight','dump_operations','dumped_at']; end if;
 elsif e='Pallet' then
  keys:=keys||array['romaneo_number','pallet_code','product_type','category','calibre','brand','package_type','package_count','gross_weight','tare_weight','net_weight','avg_box_weight','pallet_type','production_date','date','composition_estimated','origin_lots'];
  if r in ('prefrio','camaras') then keys:=keys||array['location_id','storage_section','storage_position','storage_assignment_id','storage_entered_at','storage_batch_id']; end if;
  if r='prefrio' then keys:=keys||array['cooling_cycle_id','cooling_entered_at','cooling_started_at','cooling_finished_at']; end if;
  if r='despacho' then keys:=keys||array['shipment_id','loaded_at','dispatched_at']; end if;
 else return d;
 end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into result from jsonb_each(d) where key=any(keys);
 if e='ReceiptLot' then
  actions:=case r when 'consolidado' then array['create','add_bin','close'] when 'pesado' then array['weigh'] when 'playa' then array['receive'] else '{}'::text[] end;
  result:=result||jsonb_build_object('field_operations',coalesce((select jsonb_agg(op) from jsonb_array_elements(coalesce(d->'field_operations','[]')) op where op->>'action'=any(actions)),'[]'));
 end if;
 return result;
end $$;
revoke all on function empaque_private.station_data(text,text,jsonb) from public,anon,authenticated;
grant execute on function empaque_private.station_data(text,text,jsonb) to empaco_station_executor;

create function public.station_records(p_entity text,p_offset integer default 0,p_limit integer default 1000,p_id text default null)
returns table(id text,data jsonb,created_date timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare r text:=empaque_private.my_role();
begin
 if auth.uid() is null or empaque_private.current_company() is null then raise exception 'Empresa no autorizada' using errcode='42501'; end if;
 if p_offset<0 or p_limit not between 1 and 1000 then raise exception 'Paginación inválida'; end if;
 return query select a.id,empaque_private.station_data(r,a.entity,a.data),a.created_date from public.records a
 where a.entity=p_entity and (p_id is null or a.id=p_id) and empaque_private.station_read(r,a.entity,a.data)
 order by a.created_date,a.id offset p_offset limit p_limit;
end $$;
alter function public.station_records(text,integer,integer,text) owner to empaco_station_executor;
revoke all on function public.station_records(text,integer,integer,text) from public,anon;
grant execute on function public.station_records(text,integer,integer,text) to authenticated;

create function empaque_private.station_result(r text,p text,v jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if r in ('admin','supervisor') then return v; end if;
 if v ? 'lot' then v:=jsonb_set(v,'{lot}',empaque_private.station_data(r,'ReceiptLot',v->'lot')); end if;
 if v ? 'bin' then v:=jsonb_set(v,'{bin}',empaque_private.station_data(r,'Bin',v->'bin')); end if;
 if p='offline_record_operation' and v ? 'record' then v:=jsonb_set(v,'{record,data}',empaque_private.station_data(r,v->'record'->>'entity',v->'record'->'data')); end if;
 return v;
end $$;
revoke all on function empaque_private.station_result(text,text,jsonb) from public,anon,authenticated;
grant execute on function empaque_private.station_result(text,text,jsonb) to empaco_station_executor;

create or replace function empaque_private.allowed_write(p_entity text) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(r in ('admin','supervisor')
  or r='cosecha' and p_entity='Bin'
  or r in ('consolidado','pesado','playa') and p_entity in ('ReceiptLot','Bin')
  or r='vuelco' and p_entity in ('ReceiptLot','Bin','DumpingEvent')
  or r='produccion' and p_entity='Pallet'
  or r in ('prefrio','camaras') and p_entity in ('Location','Pallet','CoolingCycle','MovementEvent','StorageBatch')
  or r='despacho' and p_entity in ('Shipment','Pallet','MovementEvent'),false)
 from (select empaque_private.my_role() r) roles
$$;
create policy records_station_insert on public.records as restrictive for insert to authenticated
 with check((select empaque_private.my_role()) in ('admin','supervisor') or current_user='empaco_station_executor');
create policy records_station_update on public.records as restrictive for update to authenticated
 using((select empaque_private.my_role()) in ('admin','supervisor') or current_user='empaco_station_executor')
 with check((select empaque_private.my_role()) in ('admin','supervisor') or current_user='empaco_station_executor');
create policy records_station_delete on public.records as restrictive for delete to authenticated
 using((select empaque_private.my_role()) in ('admin','supervisor'));

create function empaque_private.assert_station_command(p_rpc text,p jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare r text:=empaque_private.my_role(); ok boolean:=false; t text; saved jsonb; entry record;
begin
 if auth.uid() is null or empaque_private.current_company() is null then raise exception 'No tenés permiso: empresa no autorizada' using errcode='42501'; end if;
 if r in ('admin','supervisor') then return; end if;
 if p_rpc='harvest_bin_operation' then ok:=r='cosecha';
 elsif p_rpc='field_lot_operation' then
  ok:=r='consolidado' and p->>'p_action' in ('create','add_bin','close')
   or r='pesado' and p->>'p_action'='weigh' or r='playa' and p->>'p_action'='receive';
 elsif p_rpc in ('dump_bin_by_qr','dump_lot_by_bins') then ok:=r='vuelco';
 elsif p_rpc='offline_record_operation' then
  ok:=r='produccion' and p->>'p_entity'='Pallet' and p->>'p_action'='create'
   or r='despacho' and p->>'p_entity'='Shipment' and p->>'p_action' in ('create','dispatch');
  if ok and p->>'p_action'='dispatch' then
   select data into saved from public.records where entity='Shipment' and id=p->>'p_id';
   for entry in select * from jsonb_each(p->'p_payload') loop
    if nullif(saved->>entry.key,'') is not null and saved->entry.key is distinct from entry.value then
     raise exception 'No podés corregir datos confirmados de la carga' using errcode='42501';
    end if;
   end loop;
  end if;
 elsif p_rpc='load_pallet_into_shipment' then ok:=r='despacho';
 elsif p_rpc in ('cooling_cycle_command','change_cooling_cycle') then ok:=r='prefrio' and p->>'p_action' in ('iniciar','finalizar');
 elsif p_rpc='cold_storage_command' then
  select data->>'type' into t from public.records where entity='Location' and id=p->'p_payload'->>'location_id';
  ok:=(r='prefrio' and t='tunel' or r='camaras' and t='camara')
   and p->>'p_action' in ('ingresar','retirar','iniciar_carga','completar_carga','habilitar_quinta');
 elsif p_rpc='supply_command' then
  ok:=r='insumos' and p->>'p_action'='movement' and p->'p_payload'->>'kind' in ('ingreso','devolucion','rotura','traslado');
 end if;
 if not coalesce(ok,false) then raise exception 'No tenés permiso: tu perfil solo permite registrar operaciones de su estación; no corregir ni eliminar' using errcode='42501'; end if;
end $$;
revoke all on function empaque_private.assert_station_command(text,jsonb) from public,anon,authenticated;
grant execute on function empaque_private.assert_station_command(text,jsonb) to empaco_station_executor;

-- Keep proven transactional implementations, but make them inaccessible to
-- clients. Public wrappers validate the current membership for EVERY replay.
do $$
declare f record; definition text; impl text; args text; pairs text;
begin
 for f in select p.oid,p.proname,pg_get_function_arguments(p.oid) declarations,
  pg_get_function_identity_arguments(p.oid) identity_args,p.proargnames,
  pg_get_function_result(p.oid) result
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('harvest_bin_operation','field_lot_operation','dump_bin_by_qr','dump_lot_by_bins',
    'cold_storage_command','cooling_cycle_command','change_cooling_cycle','move_pallet_location',
    'offline_record_operation','load_pallet_into_shipment','unload_pallet_from_shipment','reopen_shipment_for_correction','supply_command')
 loop
  definition:=pg_get_functiondef(f.oid);
  impl:='station_impl_'||f.proname;
  definition:=replace(definition,'''admin'',''supervisor'',''recepcion'',''calidad''',
    case when f.proname='harvest_bin_operation' then '''admin'',''supervisor'',''cosecha''' else '''admin'',''supervisor'',''consolidado'',''pesado'',''playa''' end);
  if f.proname in ('dump_bin_by_qr','dump_lot_by_bins') then
   definition:=replace(definition,'''admin'', ''supervisor'', ''produccion''','''admin'', ''supervisor'', ''vuelco''');
   definition:=replace(definition,'''admin'',''supervisor'',''produccion''','''admin'',''supervisor'',''vuelco''');
  end if;
  definition:=replace(definition,'''admin'',''supervisor'',''frio''','''admin'',''supervisor'',''prefrio'',''camaras''');
  if f.proname='supply_command' then definition:=replace(definition,'''admin'',''supervisor''','''admin'',''supervisor'',''insumos'''); end if;
  -- Retain the original OID in private schema so dependencies cannot bypass
  -- the new public wrapper. Explicitly revoke the inherited EXECUTE grants.
  execute definition;
  execute format('alter function public.%I(%s) set schema empaque_private',f.proname,f.identity_args);
  execute format('alter function empaque_private.%I(%s) rename to %I',f.proname,f.identity_args,impl);
  execute format('revoke all on function empaque_private.%I(%s) from public,anon,authenticated',impl,f.identity_args);
  execute format('grant execute on function empaque_private.%I(%s) to empaco_station_executor',impl,f.identity_args);
  select string_agg(format('%I',v),','),string_agg(format('%L,%I',v,v),',') into args,pairs from unnest(f.proargnames) v;
  execute format('create function public.%I(%s) returns %s language plpgsql security definer set search_path='''' as $body$ begin perform empaque_private.assert_station_command(%L,jsonb_build_object(%s)); return empaque_private.station_result(empaque_private.my_role(),%L,empaque_private.%I(%s)); end $body$',
    f.proname,f.declarations,f.result,f.proname,pairs,f.proname,impl,args);
  execute format('alter function public.%I(%s) owner to empaco_station_executor',f.proname,f.identity_args);
  execute format('revoke all on function public.%I(%s) from public,anon',f.proname,f.identity_args);
  execute format('grant execute on function public.%I(%s) to authenticated',f.proname,f.identity_args);
 end loop;
end $$;
revoke create on schema public,empaque_private from empaco_station_executor;

-- Supply operators can append supported documents, never edit catalog/rules
-- or reverse a confirmed document. Consumption triggered by pallets is kept.
do $$ declare t text; begin
 foreach t in array array['supply_items','supply_depots','supply_rules','supply_documents','supply_movements','supply_balances','supply_allocations'] loop
  execute format('create policy station_supply_read on public.%I as restrictive for select to authenticated using ((select empaque_private.my_role()) in (''admin'',''supervisor'',''consulta'',''insumos'') or current_user=''empaco_station_executor'')',t);
  execute format('create policy station_supply_write on public.%I for all to empaco_station_executor using (company_id=(select empaque_private.current_company()) and (select empaque_private.my_role())=''insumos'') with check(company_id=(select empaque_private.current_company()) and (select empaque_private.my_role())=''insumos'')',t);
 end loop;
end $$;
do $$ declare f record; d text; begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('supply_snapshot','supply_document_detail') loop
  d:=pg_get_functiondef(f.oid);
  d:=replace(d,'coalesce(empaque_private.my_role(),'''') in ('''',''user'')','coalesce(empaque_private.my_role(),'''') not in (''admin'',''supervisor'',''consulta'',''insumos'')');
  execute d;
 end loop;
 if to_regclass('storage.objects') is not null then
  execute $p$create policy station_remitos_read on storage.objects as restrictive for select to authenticated using(bucket_id<>'supply-remitos' or (select empaque_private.my_role()) in ('admin','supervisor','consulta','insumos'))$p$;
  execute $p$create policy station_remitos_insert on storage.objects for insert to authenticated with check(bucket_id='supply-remitos' and split_part(name,'/',1)=(select empaque_private.current_company())::text and (select empaque_private.my_role())='insumos')$p$;
 end if;
end $$;
