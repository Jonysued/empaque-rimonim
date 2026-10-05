-- Preview content and its allowlist are reachable only through the authenticated
-- server endpoint. No operational memberships are created for website viewers.
create table public.private_web_access (
  email text primary key check (email = lower(trim(email)) and length(email) <= 254),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id)
);
create index private_web_access_created_by on public.private_web_access(created_by);
create table public.private_web_design (
  id boolean primary key default true check (id),
  html_gzip_base64 text not null,
  updated_at timestamptz not null default now()
);
alter table public.private_web_access enable row level security;
alter table public.private_web_design enable row level security;
revoke all on public.private_web_access, public.private_web_design from public, anon, authenticated;
grant all on public.private_web_access, public.private_web_design to service_role;
