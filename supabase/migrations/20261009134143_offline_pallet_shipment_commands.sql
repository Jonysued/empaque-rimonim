-- Private idempotency ledger: RLS and invoker permissions remain in force.
create table empaque_private.offline_record_receipts (
 operation_id uuid primary key, company_id uuid not null references public.companies(id),
 actor_id uuid not null references public.profiles(id), request jsonb not null,
 result jsonb not null, created_at timestamptz not null default now()
);
alter table empaque_private.offline_record_receipts enable row level security;
revoke all on empaque_private.offline_record_receipts from public,anon,authenticated;
grant select,insert on empaque_private.offline_record_receipts to authenticated;
create policy own_record_receipts on empaque_private.offline_record_receipts to authenticated
 using(actor_id=(select auth.uid()) and company_id=(select empaque_private.current_company()))
 with check(actor_id=(select auth.uid()) and company_id=(select empaque_private.current_company()));
create function public.offline_record_operation(p_operation_id uuid,p_entity text,p_id text,p_action text,p_payload jsonb,p_expected jsonb default null,p_recorded_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request jsonb; v_previous empaque_private.offline_record_receipts;
 v_record public.records; v_result jsonb; v_pair record; v_keys text[];
begin
 if auth.uid() is null or empaque_private.current_company() is null
  or p_entity not in ('Pallet','Shipment') or not public.allowed_write(p_entity) then
  raise exception 'No tenés permiso para esta operación' using errcode='42501';
 end if;
 if p_operation_id is null or nullif(trim(p_id),'') is null or p_action is null or p_action not in ('create','patch','dispatch')
  or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Comando inválido'; end if;
 if p_action='dispatch' and p_entity<>'Shipment' then raise exception 'Comando inválido'; end if;
 if p_recorded_at is not null and (not isfinite(p_recorded_at) or p_recorded_at<'2000-01-01'::timestamptz or p_recorded_at>now()+interval '5 minutes') then raise exception 'Revisá la fecha y hora del dispositivo'; end if;
 v_request:=jsonb_build_object('entity',p_entity,'id',p_id,'action',p_action,'payload',p_payload,'expected',p_expected,'recorded_at',p_recorded_at);
 perform pg_advisory_xact_lock(hashtextextended('offline-record:'||p_operation_id::text,0));
 select * into v_previous from empaque_private.offline_record_receipts where operation_id=p_operation_id;
 if found then
  if v_previous.request<>v_request then raise exception 'El identificador ya pertenece a otra operación'; end if;
  return v_previous.result;
 end if;
 v_keys:=case when p_entity='Pallet' then array['product_type','variety','producer','category','calibre','brand','package_type','package_count','gross_weight','tare_weight','net_weight','avg_box_weight','pallet_type']
  else array['load_number','client','destination','product_type','target_capacity','carrier','container_number','remito','thermograph','seal'] end;
 if p_action='create' then
  v_keys:=v_keys||case when p_entity='Pallet' then array['pallet_code','status','composition_estimated','origin_lots']
   else array['shipment_code','date','status','reserved_pallet_ids','loaded_pallet_ids','total_weight','total_packages'] end;
 end if;
 if exists(select 1 from jsonb_object_keys(p_payload) k where not k=any(v_keys)) then raise exception 'El comando contiene campos no permitidos'; end if;
 if p_action='create' then
  if (p_entity='Pallet' and (p_payload->>'status' is distinct from 'armado' or coalesce((p_payload->>'net_weight')::numeric,0)<=0))
   or (p_entity='Shipment' and (p_payload->>'status' is distinct from 'borrador' or coalesce(p_payload->'loaded_pallet_ids','[]')<>'[]'::jsonb
    or coalesce(p_payload->'reserved_pallet_ids','[]')<>'[]'::jsonb)) then raise exception 'Estado inicial inválido'; end if;
  insert into public.records(entity,id,data,created_date) values(p_entity,p_id,p_payload||jsonb_build_object('id',p_id),coalesce(p_recorded_at,now())) returning * into v_record;
 else
  select * into v_record from public.records where entity=p_entity and id=p_id for update;
  if not found then raise exception 'Registro no encontrado'; end if;
  if jsonb_typeof(p_expected) is distinct from 'object' then raise exception 'Falta la versión original'; end if;
  for v_pair in select * from jsonb_each(p_expected) loop
   if coalesce(v_record.data->v_pair.key,'null'::jsonb) is distinct from v_pair.value then
    raise exception 'El registro cambió en otro dispositivo. Revisá la operación pendiente';
   end if;
  end loop;
  if p_action='dispatch' then
   if v_record.data->>'status' not in ('borrador','reservado','cargado') or jsonb_array_length(coalesce(v_record.data->'loaded_pallet_ids','[]'))=0 then
    raise exception 'La carga no está disponible para confirmar la salida'; end if;
   p_payload:=p_payload||jsonb_build_object('status','enviado');
  end if;
  update public.records set data=data||p_payload,updated_date=now() where entity=p_entity and id=p_id returning * into v_record;
 end if;
 v_result:=jsonb_build_object('record',to_jsonb(v_record),'operation_id',p_operation_id);
 insert into empaque_private.offline_record_receipts values(p_operation_id,empaque_private.current_company(),auth.uid(),v_request,v_result,now());
 return v_result;
end $$;
revoke all on function public.offline_record_operation(uuid,text,text,text,jsonb,jsonb,timestamptz) from public,anon;
grant execute on function public.offline_record_operation(uuid,text,text,text,jsonb,jsonb,timestamptz) to authenticated;
