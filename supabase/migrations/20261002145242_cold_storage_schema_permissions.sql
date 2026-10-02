-- Use the same cold-storage role policy on clean installations and production.
-- The original compatibility policy did not include StorageBatch for Frío.
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
 with check(empaque_private.allowed_write(entity));
drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
 using(empaque_private.allowed_write(entity)) with check(empaque_private.allowed_write(entity));
drop policy if exists records_delete on public.records;
create policy records_delete on public.records for delete to authenticated
 using(empaque_private.allowed_write(entity));
