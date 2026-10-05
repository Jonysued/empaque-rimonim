-- Company context is per request, not a global mutable user preference.
create table public.companies (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 2 and 120),
 slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
 active boolean not null default true, created_at timestamptz not null default now(), created_by uuid default auth.uid() references public.profiles(id)
);
create table public.company_memberships (
 company_id uuid not null references public.companies(id), user_id uuid not null references public.profiles(id),
 role text not null check(role in ('admin','supervisor','recepcion','produccion','frio','despacho','calidad','user')),
 active boolean not null default true, primary key(company_id,user_id)
);
create index company_memberships_user on public.company_memberships(user_id,company_id) where active;
create table empaque_private.platform_admins(user_id uuid primary key references public.profiles(id));
alter table empaque_private.platform_admins enable row level security;
revoke all on empaque_private.platform_admins from public,anon,authenticated;
create policy platform_admins_no_client on empaque_private.platform_admins to authenticated using(false);
-- Bootstrap only the identified product owner, never all customer admins.
insert into empaque_private.platform_admins select id from public.profiles where lower(email)='jonatan@rimonim.com.ar';
insert into public.companies(name,slug) values('Rimonim','rimonim');
insert into public.company_memberships select c.id,p.id,p.role,true from public.companies c cross join public.profiles p where c.slug='rimonim';

create function empaque_private.current_company() returns uuid language sql stable security definer set search_path='' as $$
 select m.company_id from public.company_memberships m join public.companies c on c.id=m.company_id
 where m.user_id=(select auth.uid()) and m.active and c.active
 and (case when nullif(current_setting('request.headers',true),'')::jsonb->>'x-empaco-company' is null
      then c.slug='rimonim' -- legacy installed clients can access only their original company
      else m.company_id::text=nullif(current_setting('request.headers',true),'')::jsonb->>'x-empaco-company' end)
$$;
create or replace function empaque_private.my_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.company_memberships where user_id=(select auth.uid()) and company_id=(select empaque_private.current_company()) and active
$$;
create function empaque_private.platform_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from empaque_private.platform_admins where user_id=(select auth.uid()))
$$;
create function empaque_private.member_of(p_company uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.company_memberships m join public.companies c on c.id=m.company_id where m.company_id=p_company and m.user_id=(select auth.uid()) and m.active and c.active)
$$;
revoke all on function empaque_private.current_company(),empaque_private.platform_admin(),empaque_private.member_of(uuid) from public,anon;
grant execute on function empaque_private.current_company(),empaque_private.platform_admin(),empaque_private.member_of(uuid) to authenticated;
create or replace function public.my_role() returns text language sql stable security invoker set search_path='' as $$select empaque_private.my_role()$$;
create or replace function empaque_private.allowed_write(p_entity text) returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce(r in ('admin','supervisor')
 or (r in ('recepcion','calidad') and p_entity in ('ReceiptLot','Bin','QualityHold'))
 or (r='produccion' and p_entity in ('DumpingEvent','ProductionRun','Pallet','MovementEvent','ReceiptLot'))
 or (r='frio' and p_entity in ('Location','Pallet','CoolingCycle','MovementEvent','StorageBatch'))
 or (r='despacho' and p_entity in ('Shipment','Pallet','MovementEvent')),false) from (select empaque_private.my_role() r) roles
$$;
create or replace function public.allowed_write(p_entity text) returns boolean language sql stable security invoker set search_path='' as $$select empaque_private.allowed_write(p_entity)$$;

alter table public.records add column company_id uuid references public.companies(id);
update public.records set company_id=(select id from public.companies where slug='rimonim');
alter table public.records alter column company_id set not null;
alter table public.records alter column company_id set default empaque_private.current_company();
create index records_company_entity_created on public.records(company_id,entity,created_date,id);
-- Existing JSONB GIN index can be combined with the company B-tree index.

alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
revoke all on public.companies,public.company_memberships from anon,authenticated;
grant select,insert on public.companies to authenticated;
grant select,insert on public.company_memberships to authenticated;
grant update(role,active) on public.company_memberships to authenticated;
grant all on public.companies,public.company_memberships to service_role;
create policy companies_read on public.companies for select to authenticated using(empaque_private.member_of(id) or (select empaque_private.platform_admin()));
create policy companies_create on public.companies for insert to authenticated with check((select empaque_private.platform_admin()));
create policy memberships_read on public.company_memberships for select to authenticated using(user_id=(select auth.uid()) or (company_id=(select empaque_private.current_company()) and (select empaque_private.my_role())='admin'));
create policy memberships_create on public.company_memberships for insert to authenticated with check((select empaque_private.platform_admin()) and user_id=(select auth.uid()) and role='admin');
create policy memberships_update on public.company_memberships for update to authenticated using(company_id=(select empaque_private.current_company()) and (select empaque_private.my_role())='admin') with check(company_id=(select empaque_private.current_company()) and (select empaque_private.my_role())='admin');
-- RESTRICTIVE policies also fence off any pre-existing permissive policy.
create policy records_company_isolation on public.records as restrictive for all to authenticated
 using(company_id=(select empaque_private.current_company())) with check(company_id=(select empaque_private.current_company()));
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using(id=(select auth.uid()) or ((select empaque_private.my_role())='admin' and exists(select 1 from public.company_memberships m where m.user_id=profiles.id and m.company_id=(select empaque_private.current_company()))));
drop policy profiles_admin_update on public.profiles;
-- Legacy role edits are confined to Rimonim; new clients edit memberships.
create policy profiles_admin_update on public.profiles for update to authenticated using((select empaque_private.my_role())='admin' and (select c.slug from public.companies c where c.id=empaque_private.current_company())='rimonim' and exists(select 1 from public.company_memberships m where m.user_id=profiles.id and m.company_id=empaque_private.current_company())) with check((select empaque_private.my_role())='admin');
revoke update on public.profiles from authenticated;
grant update(role) on public.profiles to authenticated;

create function empaque_private.legacy_profile_role() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.role is distinct from old.role then
  insert into public.company_memberships(company_id,user_id,role) select id,new.id,new.role from public.companies where slug='rimonim'
   on conflict(company_id,user_id) do update set role=excluded.role;
 end if;
 return new;
end $$;
revoke all on function empaque_private.legacy_profile_role() from public,anon,authenticated;
create trigger legacy_profile_role after update of role on public.profiles for each row execute function empaque_private.legacy_profile_role();

create function empaque_private.guard_company_membership() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.role='admin' and old.active and (new.role<>'admin' or not new.active) then
  perform 1 from public.companies where id=old.company_id for update;
  if not exists(select 1 from public.company_memberships where company_id=old.company_id and user_id<>old.user_id and active and role='admin') then
   raise exception 'La empresa debe conservar al menos un administrador';
  end if;
 end if;
 return new;
end $$;
revoke all on function empaque_private.guard_company_membership() from public,anon,authenticated;
create trigger guard_company_membership before update on public.company_memberships for each row execute function empaque_private.guard_company_membership();

-- Audit/reference guard also covers the one privileged operational trigger.
create function empaque_private.guard_record_company() returns trigger language plpgsql security definer set search_path='' as $$
declare v_pair record; v_ref text;
begin
 if tg_op='UPDATE' and new.company_id is distinct from old.company_id then raise exception 'No se puede trasladar un registro a otra empresa'; end if;
 if auth.uid() is not null and new.company_id is distinct from empaque_private.current_company() then raise exception 'Empresa no autorizada' using errcode='42501'; end if;
 for v_pair in select * from (values ('receipt_lot_id','ReceiptLot'),('pallet_id','Pallet'),('bin_id','Bin'),('location_id','Location'),('origin_location_id','Location'),('destination_location_id','Location'),('tunnel_id','Location'),('shipment_id','Shipment'),('production_run_id','ProductionRun'),('cooling_cycle_id','CoolingCycle'),('storage_batch_id','StorageBatch'),('origin_batch_id','StorageBatch'),('unit_id',case when new.data->>'unit_type'='pallet' then 'Pallet' when new.data->>'unit_type'='bin' then 'Bin' else '' end)) x(key,entity) loop
  v_ref:=new.data->>v_pair.key;
  if v_ref is not null and exists(select 1 from public.records where entity=v_pair.entity and id=v_ref and company_id<>new.company_id) then raise exception 'La referencia no pertenece a esta empresa'; end if;
 end loop;
 for v_pair in select * from (values ('loaded_pallet_ids','Pallet'),('pallet_ids','Pallet'),('receipt_lot_ids','ReceiptLot'),('bin_ids','Bin')) x(key,entity) loop
  for v_ref in select jsonb_array_elements_text(case when jsonb_typeof(new.data->v_pair.key)='array' then new.data->v_pair.key else '[]'::jsonb end) loop
   if exists(select 1 from public.records where entity=v_pair.entity and id=v_ref and company_id<>new.company_id) then raise exception 'El registro no pertenece a esta empresa'; end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function empaque_private.guard_record_company() from public,anon,authenticated;
create trigger aaa_guard_record_company before insert or update on public.records for each row execute function empaque_private.guard_record_company();

-- Each customer's pallet numbers and physical positions are independent.
alter table empaque_private.romaneo_counters add column company_id uuid references public.companies(id);
update empaque_private.romaneo_counters set company_id=(select id from public.companies where slug='rimonim');
alter table empaque_private.romaneo_counters alter column company_id set not null;
alter table empaque_private.romaneo_counters drop constraint romaneo_counters_pkey;
alter table empaque_private.romaneo_counters add primary key(company_id,year);
create or replace function empaque_private.next_romaneo() returns text language plpgsql security definer set search_path='' as $$
declare v_year integer; v_number bigint; v_company uuid:=empaque_private.current_company();
begin
 if auth.uid() is null or v_company is null or not empaque_private.allowed_write('Pallet') then raise exception 'No tenés permiso para crear pallets' using errcode='42501'; end if;
 v_year:=extract(year from timezone('America/Argentina/Buenos_Aires',clock_timestamp()))::integer;
 insert into empaque_private.romaneo_counters(company_id,year,last_number) values(v_company,v_year,1)
 on conflict(company_id,year) do update set last_number=empaque_private.romaneo_counters.last_number+1 returning last_number into v_number;
 return 'ROM-'||v_year::text||'-'||case when v_number<100000 then lpad(v_number::text,5,'0') else v_number::text end;
end $$;
drop index public.records_romaneo_unique;
create unique index records_romaneo_unique on public.records(company_id,(data->>'romaneo_number')) where entity='Pallet' and nullif(data->>'romaneo_number','') is not null;
drop index public.records_pallet_code_unique;
create unique index records_pallet_code_unique on public.records(company_id,(data->>'pallet_code')) where entity='Pallet' and nullif(data->>'pallet_code','') is not null;
drop index public.records_physical_position_unique;
create unique index records_physical_position_unique on public.records(company_id,(data->>'location_id'),(data->>'storage_section'),(data->>'storage_position')) where entity='Pallet' and data->>'location_id' is not null and data->>'storage_position' is not null;
drop index public.records_open_tunnel_cycle_unique;
create unique index records_open_tunnel_cycle_unique on public.records(company_id,(data->>'tunnel_id')) where entity='CoolingCycle' and data->>'status'='abierto';
drop index public.records_open_storage_batch_unique;
create unique index records_open_storage_batch_unique on public.records(company_id,(data->>'location_id'),(data->>'section')) where entity='StorageBatch' and data->>'status'<>'cerrado';

-- Replace legacy profile-role lookups in existing INVOKER functions. All other
-- operational code, grants, atomicity and return types remain unchanged.
do $$declare f record; definition text; begin
 for f in select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
 ('load_pallet_into_shipment','unload_pallet_from_shipment','move_pallet_location','change_cooling_cycle','reopen_shipment_for_correction','dump_lot_by_bins','field_lot_operation','harvest_bin_operation','guard_field_lot_workflow','dump_bin_by_qr','record_shipment_departure','cooling_cycle_command','cold_storage_command') loop
  definition:=pg_get_functiondef(f.oid);
  definition:=regexp_replace(definition,'select role into v_role from public.profiles where id\s*=\s*\(select auth.uid\(\)\)','select empaque_private.my_role() into v_role','gi');
  definition:=regexp_replace(definition,'select role from public.profiles where id\s*=\s*\(select auth.uid\(\)\)','select empaque_private.my_role()','gi');
  execute definition;
 end loop;
end $$;
-- Privileged totals refresh must explicitly constrain its reads and writes.
do $$declare definition text; begin
 definition:=pg_get_functiondef('empaque_private.refresh_loaded_pallet_totals()'::regprocedure);
 definition:=replace(definition,$s$where entity='Shipment' and id=old.data->>'shipment_id'$s$, $s$where company_id=new.company_id and entity='Shipment' and id=old.data->>'shipment_id'$s$);
 definition:=replace(definition,$s$where entity='Shipment' and id=v_shipment.id$s$, $s$where company_id=new.company_id and entity='Shipment' and id=v_shipment.id$s$);
 execute definition;
end $$;

create function public.is_platform_admin() returns boolean language sql stable security invoker set search_path='' as $$select empaque_private.platform_admin()$$;
create function public.company_users() returns table(id uuid,email text,full_name text,role text,active boolean) language sql stable security invoker set search_path='' as $$
 select p.id,p.email,p.full_name,m.role,m.active from public.company_memberships m join public.profiles p on p.id=m.user_id where m.company_id=empaque_private.current_company() order by p.email
$$;
create function public.set_company_role(p_user_id uuid,p_role text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if empaque_private.my_role()<>'admin' or empaque_private.my_role() is null then raise exception 'Solo administradores' using errcode='42501'; end if;
 update public.company_memberships set role=p_role where company_id=empaque_private.current_company() and user_id=p_user_id;
 if not found then raise exception 'Usuario no encontrado en esta empresa'; end if;
 if (select slug from public.companies where id=empaque_private.current_company())='rimonim' then update public.profiles set role=p_role where id=p_user_id; end if;
end $$;
create function public.create_company(p_name text,p_slug text) returns public.companies language plpgsql security invoker set search_path='' as $$
declare result public.companies; begin
 if not empaque_private.platform_admin() then raise exception 'Solo la administración de Empaco puede crear empresas' using errcode='42501'; end if;
 insert into public.companies(name,slug) values(trim(p_name),lower(trim(p_slug))) returning * into result;
 insert into public.company_memberships(company_id,user_id,role) values(result.id,auth.uid(),'admin');
 return result;
end $$;
revoke all on function public.is_platform_admin(),public.company_users(),public.set_company_role(uuid,text),public.create_company(text,text) from public,anon;
grant execute on function public.is_platform_admin(),public.company_users(),public.set_company_role(uuid,text),public.create_company(text,text) to authenticated;
notify pgrst,'reload schema';
