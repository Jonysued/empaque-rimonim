-- Execute once in the Supabase SQL editor. Keep this file in source control.
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 email text not null,
 full_name text,
 role text not null default 'user' check (role in ('admin','supervisor','recepcion','produccion','frio','despacho','calidad','user'))
);
create table if not exists public.records (
 entity text not null check (entity in ('ReceiptLot','Bin','DumpingEvent','ProductionRun','Pallet','Location','CoolingCycle','Shipment','MovementEvent','Catalog','QualityHold','AuditEvent')),
 id text not null,
 data jsonb not null default '{}',
 created_date timestamptz not null default now(),
 updated_date timestamptz not null default now(),
 primary key(entity,id)
);
create index if not exists records_entity_created on public.records(entity,created_date desc);
create index if not exists records_entity_data on public.records using gin(data jsonb_path_ops);
create or replace function public.my_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.profiles where id=(select auth.uid())
$$;
revoke all on function public.my_role() from public;
grant execute on function public.my_role() to authenticated;
create or replace function public.allowed_write(p_entity text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select role='admin' or role='supervisor'
 or (role in ('recepcion','calidad') and p_entity in ('ReceiptLot','Bin','QualityHold'))
 or (role='produccion' and p_entity in ('DumpingEvent','ProductionRun','Pallet','MovementEvent','ReceiptLot'))
 or (role='frio' and p_entity in ('Location','Pallet','CoolingCycle','MovementEvent'))
 or (role='despacho' and p_entity in ('Shipment','Pallet','MovementEvent'))
 from public.profiles where id=(select auth.uid())), false)
$$;
revoke all on function public.allowed_write(text) from public;
grant execute on function public.allowed_write(text) to authenticated;
alter table public.profiles enable row level security;
alter table public.records enable row level security;
create policy "profiles_read" on public.profiles for select to authenticated using (id=(select auth.uid()) or (select public.my_role())='admin');
create policy "profiles_admin_update" on public.profiles for update to authenticated using ((select public.my_role())='admin') with check ((select public.my_role())='admin');
create policy "records_read" on public.records for select to authenticated using ((select public.my_role()) not in ('user'));
create policy "records_insert" on public.records for insert to authenticated with check (public.allowed_write(entity));
create policy "records_update" on public.records for update to authenticated using (public.allowed_write(entity)) with check (public.allowed_write(entity));
create policy "records_delete" on public.records for delete to authenticated using (public.allowed_write(entity));
create or replace function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,email,full_name,role) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',new.email),'user')
 on conflict (id) do nothing;
 return new;
end; $$;
drop trigger if exists on_auth_user_created_rimonim on auth.users;
create trigger on_auth_user_created_rimonim after insert on auth.users for each row execute procedure public.create_profile();
-- Never grant role assignment via user metadata or the client.
create or replace function public.patch_record(p_entity text,p_id text,p_patch jsonb,p_unset text[] default '{}')
returns public.records language plpgsql security invoker set search_path='' as $$
declare result public.records;
begin
 update public.records set data=(data || p_patch) - p_unset,updated_date=now()
 where entity=p_entity and id=p_id returning * into result;
 if not found then raise exception 'Record not found'; end if;
 return result;
end; $$;
create or replace function public.patch_records(p_entity text,p_query jsonb,p_patch jsonb,p_unset text[] default '{}')
returns setof public.records language sql security invoker set search_path='' as $$
 update public.records set data=(data || p_patch) - p_unset,updated_date=now()
 where entity=p_entity and data @> (p_query - 'id') and (not p_query ? 'id' or id=p_query->>'id') returning *;
$$;
grant execute on function public.patch_record(text,text,jsonb,text[]) to authenticated;
grant execute on function public.patch_records(text,jsonb,jsonb,text[]) to authenticated;
