# Empaque Rimonim — Supabase + Vercel

React/Vite frontend on Vercel; Supabase Auth and Postgres for users and operational records. Base44 is no longer used at runtime.

## Setup

1. Create a Supabase project. Run `supabase/migrations/001_empaque.sql` in its SQL editor.
2. In Supabase Auth, configure the Site URL to the production Vercel URL and add localhost and the Vercel URL to redirect URLs. Disable public signups and enable Google provider only if it is configured to admit invited users. Set the email template / SMTP for invitations and password recovery.
3. Temporarily create the first user through Supabase Authentication > Users, then disable public signups. After registration, run `update public.profiles set role='admin' where email='YOUR_EMAIL';` in the SQL editor. Only do this for the intended administrator.
4. In Vercel, import this GitHub repo as a Vite project. Configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY`. Set `APP_URL` to the production origin for invitation links. Redeploy after adding variables.
5. For local development, copy `example.env` to `.env.local`, fill the first two variables, run `npm install` and `npm run dev`. The invitation endpoint runs only on Vercel or `vercel dev`.

**Never put the service role key in a `VITE_` variable, commit it, or expose it to the browser.**

## Migrating data

Export all Base44 entities as JSON arrays keyed by entity name, for example:

```json
{"ReceiptLot":[{"id":"old-id","created_date":"2026-03-24T10:00:00Z"}],"Pallet":[]}
```

Use `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` locally, then run `npm run import-data -- /path/to/export.json`. The script preserves old IDs, dates, and relationships; it upserts in batches so it can resume. Never commit exports containing operational or personal data. User passwords cannot be exported or migrated: invite users anew and assign their roles. Check record counts and traceability before stopping Base44.

The standalone app uses one `records` JSONB table and a `profiles` table. Row-level security enforces write access by job role. An import via service role bypasses RLS and must run only from a trusted machine. The frontend compatibility module retains the `base44` variable name for existing screens; it talks only to Supabase.

## Operational checks before switching traffic

- Test login, invitation, password reset, Google OAuth if enabled, and permissions for every role.
- Test receipt → bins → dumping → production → pallet → tunnel → cold room → shipment and traceability with realistic data.
- Compare counts and IDs from the Base44 export to Supabase. Back up Supabase and keep Base44 available until the new system is verified.
