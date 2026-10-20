-- Reading remains fenced by current_company(); existing write allowlists do
-- not include consulta. Do not change any existing membership or profile.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check
 (role in ('admin','supervisor','recepcion','produccion','frio','despacho','calidad','consulta','user'));
alter table public.company_memberships drop constraint company_memberships_role_check;
alter table public.company_memberships add constraint company_memberships_role_check check
 (role in ('admin','supervisor','recepcion','produccion','frio','despacho','calidad','consulta','user'));

create policy records_readonly_insert on public.records as restrictive for insert to authenticated
 with check ((select empaque_private.my_role()) <> 'consulta');
create policy records_readonly_update on public.records as restrictive for update to authenticated
 using ((select empaque_private.my_role()) <> 'consulta')
 with check ((select empaque_private.my_role()) <> 'consulta');
create policy records_readonly_delete on public.records as restrictive for delete to authenticated
 using ((select empaque_private.my_role()) <> 'consulta');
