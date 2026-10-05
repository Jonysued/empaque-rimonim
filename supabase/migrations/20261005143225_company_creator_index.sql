-- Cover the creator FK used by platform administration and account maintenance.
create index companies_created_by on public.companies(created_by);
