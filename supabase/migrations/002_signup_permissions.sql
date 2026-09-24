-- Apply to an existing project before enabling public email signups.
-- A new account starts with role 'user' and must not see operational data.
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles for select to authenticated
 using (id=(select auth.uid()) or (select public.my_role())='admin');

drop policy if exists "records_read" on public.records;
create policy "records_read" on public.records for select to authenticated
 using ((select public.my_role()) not in ('user'));
