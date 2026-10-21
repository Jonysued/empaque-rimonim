-- Automatic, estimated lot balances. No pallet creation constraint depends on
-- another device being online; original operational records are not rewritten.
create table public.production_discard_rates (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null default empaque_private.current_company() references public.companies(id),
 effective_date date not null,
 discard_percent numeric(5,2) not null check(discard_percent>=0 and discard_percent<=100),
 created_at timestamptz not null default now(),
 created_by uuid not null default auth.uid() references public.profiles(id)
);
create index production_discard_rates_company_date on public.production_discard_rates(company_id,effective_date,created_at,id);
alter table public.production_discard_rates enable row level security;
revoke all on public.production_discard_rates from public,anon,authenticated;
grant select,insert on public.production_discard_rates to authenticated;
create policy discard_rate_read on public.production_discard_rates for select to authenticated
 using(company_id=(select empaque_private.current_company()) and (select empaque_private.my_role()) in ('admin','supervisor','consulta','produccion'));
create policy discard_rate_append on public.production_discard_rates for insert to authenticated
 with check(company_id=(select empaque_private.current_company()) and created_by=(select auth.uid())
   and (select empaque_private.my_role()) in ('admin','supervisor') and created_at=now());

-- Read one consistent, company-scoped snapshot. The bounded executor retains
-- RLS; operators receive only source identifiers/weights required for their
-- station's calculated balance, never access to the other station screens.
create function public.production_balance_inputs() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare company uuid:=empaque_private.current_company(); role_name text:=empaque_private.my_role();
begin
 if auth.uid() is null or company is null or coalesce(role_name,'') not in ('admin','supervisor','consulta','produccion') then
  raise exception 'Balance de producción no autorizado' using errcode='42501';
 end if;
 return jsonb_build_object('as_of',now(),
  'lots',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'lot_code',r.data->>'lot_code','producer',r.data->>'producer',
    'variety',r.data->>'variety','status',r.data->>'status','held',coalesce((r.data->>'held')::boolean,false)))
    from public.records r where r.entity='ReceiptLot' and r.company_id=company),'[]'::jsonb),
  'dumps',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'receipt_lot_id',r.data->>'receipt_lot_id',
    'net_weight',r.data->'net_weight','dump_date',r.data->>'dump_date','created_date',r.created_date,'status',r.data->>'status'))
    from public.records r where r.entity='DumpingEvent' and r.company_id=company),'[]'::jsonb),
  'pallets',coalesce((select jsonb_agg(empaque_private.station_data(role_name,'Pallet',r.data)||jsonb_build_object('id',r.id,'created_date',r.created_date))
    from public.records r where r.entity='Pallet' and r.company_id=company),'[]'::jsonb),
  'rates',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'effective_date',d.effective_date,'discard_percent',d.discard_percent,'created_at',d.created_at))
    from public.production_discard_rates d where d.company_id=company),'[]'::jsonb));
end $$;
grant create on schema public to empaco_station_executor;
alter function public.production_balance_inputs() owner to empaco_station_executor;
revoke create on schema public from empaco_station_executor;
revoke all on function public.production_balance_inputs() from public,anon;
grant execute on function public.production_balance_inputs() to authenticated;
