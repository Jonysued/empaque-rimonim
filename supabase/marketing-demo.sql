create table public.marketing_demo_requests (
 id uuid primary key,
 name text not null check (char_length(name) between 2 and 100),
 company text not null check (char_length(company) between 2 and 150),
 email text not null check (char_length(email) <= 254),
 message text not null default '' check (char_length(message) <= 2000),
 rate_key text not null,
 created_at timestamptz not null default now(),
 consent_at timestamptz not null default now()
);
create index marketing_demo_email_created on public.marketing_demo_requests(email,created_at);
create index marketing_demo_rate_created on public.marketing_demo_requests(rate_key,created_at);
alter table public.marketing_demo_requests enable row level security;
revoke all on public.marketing_demo_requests from anon, authenticated;
grant select,insert on public.marketing_demo_requests to service_role;
create function public.register_marketing_demo(p_id uuid,p_name text,p_company text,p_email text,p_message text,p_rate_key text)
returns text language plpgsql security invoker set search_path = '' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('marketing-ip:' || p_rate_key,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('marketing-email:' || p_email,0));
 if exists(select 1 from public.marketing_demo_requests where id=p_id) then return 'ok'; end if;
 if (select count(*) from public.marketing_demo_requests where email=p_email and created_at>now()-interval '10 minutes')>=3
 or (select count(*) from public.marketing_demo_requests where rate_key=p_rate_key and created_at>now()-interval '10 minutes')>=5 then return 'rate_limited'; end if;
 insert into public.marketing_demo_requests(id,name,company,email,message,rate_key)
 values(p_id,p_name,p_company,p_email,p_message,p_rate_key) on conflict(id) do nothing;
 return 'ok';
end;
$$;
revoke all on function public.register_marketing_demo(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.register_marketing_demo(uuid,text,text,text,text,text) to service_role;

