-- Explicit deny policy documents that only next_romaneo's owner can allocate.
create policy romaneo_counter_no_client_access on empaque_private.romaneo_counters
 for all to authenticated using(false) with check(false);
