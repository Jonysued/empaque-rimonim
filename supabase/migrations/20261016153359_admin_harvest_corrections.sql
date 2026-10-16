-- Administrative corrections are online, tenant-scoped, audited and atomic.
create table empaque_private.harvest_corrections (
 company_id uuid not null default empaque_private.current_company(),
 operation_id uuid not null, actor uuid not null default auth.uid(),
 created_at timestamptz not null default now(), request jsonb not null,
 before_data jsonb not null, result jsonb not null,
 primary key(company_id,operation_id)
);
alter table empaque_private.harvest_corrections enable row level security;
revoke all on empaque_private.harvest_corrections from public,anon,authenticated;
grant select,insert on empaque_private.harvest_corrections to authenticated;
create policy admin_corrections_read on empaque_private.harvest_corrections for select to authenticated
 using(company_id=empaque_private.current_company() and empaque_private.my_role()='admin');
create policy admin_corrections_insert on empaque_private.harvest_corrections for insert to authenticated
 with check(company_id=empaque_private.current_company() and actor=auth.uid() and empaque_private.my_role()='admin');

create function public.admin_harvest_correction(p_operation_id uuid,p_entity text,p_id text,p_action text,p_expected jsonb,p_patch jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.records; l public.records; b public.records; old_data jsonb; request_data jsonb; previous empaque_private.harvest_corrections;
 lot_id text; old_context text; result_data jsonb; summary jsonb; n integer; gross numeric; tare numeric; net numeric; k text;
begin
 if auth.uid() is null or coalesce(empaque_private.my_role(),'')<>'admin' then raise exception 'Solo administradores' using errcode='42501'; end if;
 if p_operation_id is null or p_entity not in ('Bin','ReceiptLot') or p_entity is null or p_action not in ('edit','delete','edit_weight','delete_weight') or p_action is null then raise exception 'Corrección inválida'; end if;
 request_data:=jsonb_build_object('entity',p_entity,'id',p_id,'action',p_action,'expected',p_expected,'patch',p_patch);
 perform pg_advisory_xact_lock(hashtextextended('admin-correction:'||p_operation_id::text,0));
 select * into previous from empaque_private.harvest_corrections where company_id=empaque_private.current_company() and operation_id=p_operation_id;
 if found then
  if previous.request<>request_data then raise exception 'La operación ya se usó con otros datos'; end if;
  return previous.result;
 end if;
 select * into r from public.records where entity=p_entity and id=p_id;
 if not found then raise exception 'Registro no encontrado'; end if;
 lot_id:=case when p_entity='ReceiptLot' then p_id else nullif(r.data->>'receipt_lot_id','') end;
 if lot_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('field-lot:'||lot_id,0));
  select * into l from public.records where entity='ReceiptLot' and id=lot_id for update;
  if not found then raise exception 'Lote asociado no encontrado'; end if;
 end if;
 select * into r from public.records where entity=p_entity and id=p_id for update;
 if not found or r.data is distinct from p_expected then raise exception 'El registro cambió. Cerrá y volvé a abrir Editar'; end if;
 if p_entity='Bin' and nullif(r.data->>'receipt_lot_id','') is distinct from lot_id then raise exception 'El BIN cambió de lote. Volvé a abrir Editar'; end if;
 if (p_entity='Bin' and r.data->>'harvest_workflow' is distinct from '3') or (p_entity='ReceiptLot' and coalesce(r.data->>'workflow_version','') not in ('2','3')) then raise exception 'Este registro pertenece al flujo anterior'; end if;
 if lot_id is not null and (coalesce((l.data->>'bins_dumped')::numeric,0)>0 or coalesce((l.data->>'dumped_weight')::numeric,0)>0 or l.data->>'status' in ('volcando','volcado') or exists(select 1 from public.records where entity='DumpingEvent' and data->>'receipt_lot_id'=lot_id)) then raise exception 'El lote ya tiene vuelcos. No se puede alterar su origen ni sus pesos'; end if;
 old_data:=jsonb_build_object('record',to_jsonb(r),'lot',to_jsonb(l),'bins',coalesce((select jsonb_agg(to_jsonb(x)) from public.records x where entity='Bin' and data->>'receipt_lot_id'=lot_id),'[]'));
 old_context:=current_setting('rimonim.field_lot_id',true);
 perform set_config('rimonim.field_lot_id',coalesce(lot_id,'harvest:'||p_id),true);
 if p_entity='Bin' then
  if p_action='edit' then
   for k in select jsonb_object_keys(p_patch) loop
    if k not in ('producer','variety','origin','species','harvest_type','crew','harvest_date','quality_notes') then raise exception 'Campo no editable: %',k; end if;
   end loop;
   summary:=r.data||p_patch;
   if nullif(trim(summary->>'producer'),'') is null or nullif(trim(summary->>'variety'),'') is null or nullif(summary->>'harvest_date','') is null then raise exception 'Productor, variedad y fecha son obligatorios'; end if;
   perform (summary->>'harvest_date')::date;
   if summary->>'crew' is distinct from r.data->>'crew' then
    if summary->>'crew'='MIXTO' then raise exception 'Conservá el desglose de cuadrillas mixtas'; end if;
    summary:=summary||jsonb_build_object('crew_breakdown','[]'::jsonb);
   end if;
   update public.records set data=summary,updated_date=now() where entity='Bin' and id=p_id;
  elsif p_action='delete' then
   if lot_id is not null and l.data->>'status'<>'en_campo' then raise exception 'El BIN pertenece a un lote cerrado. No puede eliminarse'; end if;
   delete from public.records where entity='Bin' and id=p_id;
  else raise exception 'Acción no válida para un BIN'; end if;
  if lot_id is not null then
   select count(*),jsonb_build_object('producer',string_agg(distinct data->>'producer',' / ' order by data->>'producer'),'variety',string_agg(distinct data->>'variety',' / ' order by data->>'variety'),'origin',string_agg(distinct data->>'origin',' / ' order by data->>'origin'),'species',string_agg(distinct data->>'species',' / ' order by data->>'species'),'harvest_type',string_agg(distinct data->>'harvest_type',' / ' order by data->>'harvest_type'),'crew',string_agg(distinct data->>'crew',' / ' order by data->>'crew'),'harvest_date',case when count(distinct data->>'harvest_date')=1 then min(data->>'harvest_date') else null end)
    into n,summary from public.records where entity='Bin' and data->>'receipt_lot_id'=lot_id;
   update public.records set data=data||summary||jsonb_build_object('bins_count',n),updated_date=now() where entity='ReceiptLot' and id=lot_id;
  end if;
 elsif p_action='edit' then
  for k in select jsonb_object_keys(p_patch) loop if k not in ('transport','quality_notes') then raise exception 'Campo no editable: %',k; end if; end loop;
  if p_patch ? 'transport' and not exists(select 1 from public.records where entity='Catalog' and data->>'type'='transportista' and data->>'label'=p_patch->>'transport' and coalesce((data->>'active')::boolean,true)) then raise exception 'Seleccioná un transportista activo de Catálogos'; end if;
  update public.records set data=data||p_patch,updated_date=now() where entity=p_entity and id=p_id;
 elsif p_action='delete' then
  if r.data->>'status' not in ('en_campo','cerrado_campo') or r.data->>'weighed_at' is not null or r.data->>'yard_received_at' is not null then raise exception 'Primero eliminá el pesaje; un lote recibido no puede eliminarse'; end if;
  if exists(select 1 from public.records where entity='Bin' and data->>'receipt_lot_id'=p_id and data->>'harvest_workflow' is distinct from '3') then raise exception 'Este lote contiene bines del flujo anterior'; end if;
  update public.records set data=(data-array['receipt_lot_id','receipt_lot_code','field_workflow'])||jsonb_build_object('status','cosechado'),updated_date=now() where entity='Bin' and data->>'receipt_lot_id'=p_id;
  delete from public.records where entity=p_entity and id=p_id;
 elsif p_action in ('edit_weight','delete_weight') then
  if r.data->>'weighed_at' is null then raise exception 'El lote no tiene un pesaje registrado'; end if;
  if p_action='delete_weight' then
   if r.data->>'yard_received_at' is not null or r.data->>'status'<>'pesado' then raise exception 'No se puede eliminar el pesaje de un lote ya recibido en playa'; end if;
   update public.records set data=(data-array['gross_weight','tare_weight','net_weight','bin_weight','weighed_at','weighed_by'])||jsonb_build_object('status','cerrado_campo','remaining_weight',0),updated_date=now() where entity='ReceiptLot' and id=p_id;
   update public.records set data=(data-'net_weight')||jsonb_build_object('status','cerrado_campo'),updated_date=now() where entity='Bin' and data->>'receipt_lot_id'=p_id;
  else
   gross:=(p_patch->>'gross_weight')::numeric; tare:=(p_patch->>'tare_weight')::numeric;
   if gross is null or tare is null or gross::text in ('NaN','Infinity','-Infinity') or tare::text in ('NaN','Infinity','-Infinity') or gross<=0 or tare<0 or tare>=gross then raise exception 'Bruto y tara inválidos'; end if;
   select count(*) into n from public.records where entity='Bin' and data->>'receipt_lot_id'=p_id;
   if n=0 then raise exception 'El lote no tiene bines'; end if;
   net:=round(gross-tare,1);
   if net<=0 then raise exception 'El neto debe ser mayor a cero'; end if;
   update public.records set data=data||jsonb_build_object('gross_weight',gross,'tare_weight',tare,'net_weight',net,'remaining_weight',net,'bin_weight',net/n),updated_date=now() where entity='ReceiptLot' and id=p_id;
   update public.records set data=data||jsonb_build_object('net_weight',net/n),updated_date=now() where entity='Bin' and data->>'receipt_lot_id'=p_id;
  end if;
 end if;
 perform set_config('rimonim.field_lot_id',coalesce(old_context,''),true);
 result_data:=jsonb_build_object('ok',true,'records',coalesce((select jsonb_agg(to_jsonb(x)) from public.records x where (entity=p_entity and id=p_id) or (entity='ReceiptLot' and id=lot_id) or (entity='Bin' and (data->>'receipt_lot_id'=lot_id or id in (select value->>'id' from jsonb_array_elements(old_data->'bins'))))),'[]'),'deleted',case when p_action='delete' then jsonb_build_array(jsonb_build_object('entity',p_entity,'id',p_id)) else '[]'::jsonb end);
 insert into empaque_private.harvest_corrections(operation_id,request,before_data,result) values(p_operation_id,request_data,old_data,result_data);
 return result_data;
end $$;
revoke all on function public.admin_harvest_correction(uuid,text,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.admin_harvest_correction(uuid,text,text,text,jsonb,jsonb) to authenticated;
