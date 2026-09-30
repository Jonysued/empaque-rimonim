# Empaque Rimonim — Supabase + Vercel

React/Vite frontend on Vercel; Supabase Auth and Postgres for users and operational records. Base44 is no longer used at runtime.

## Setup

1. Create a Supabase project. Run `supabase/migrations/001_empaque.sql` in its SQL editor.
2. In Supabase Auth, configure the Site URL to the production Vercel URL and the redirect URLs used by invitations and password recovery. Keep public email signups disabled and configure an email sender for invitations and password recovery.
3. Create the first administrator through the Supabase Auth dashboard, then set `role='admin'` on their row in `public.profiles`. After that, administrators invite users from **Usuarios y roles** inside the app and assign their roles there. Public self-registration is unavailable.
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

## QR workflow and operational dashboard

New records use workflow version 3: Cosecha registers individual BINs; Consolidado de Lote associates them and captures transport; Pesado records gross/tare and prorates net weight; Recepción Playa Empaque confirms arrival; Vuelco scans each BIN and atomically deducts its weight. Legacy lots preserve their existing balances and compatible workflows.

The dashboard shows activity for the selected dates in Argentina time and all current backlog, regardless of receipt date. Producer and variety apply throughout; origin/cuadro applies to BINs because pallets do not carry that field. Stage averages use completed intervals ending within the period, weighted per BIN or pallet. Multiple completed stays in the same cold station are summed per pallet within the selected period. Pending waits are separate from completed averages. Missing or backward dates do not become estimated durations.

Shipment loading and departure are distinct. Apply `20260930191411_dashboard_pallet_dispatch_timing.sql` before publishing: it stamps the transition to enviado on the server and records one departure event per loaded pallet in the same transaction. Retrying or editing metadata preserves the timestamp. Reopening clears the current departure but retains the event history; reconfirming records the corrected shipment. Previously sent shipments have no invented departure dates.

Dashboard delay limits are optional hours saved in a Catalog record of type dashboard_limits, shared across users. Only administrators and supervisors can edit them. The dashboard refreshes automatically every minute while visible, on focus and after queue changes. Pending local commands are explicitly identified and do not contribute to confirmed totals or averages.

Validation: `npm run lint`, `npm run typecheck`, `npm run build`, `node scripts/check-dashboard-metrics.mjs`, and existing workflow/queue checks. Execute `scripts/check-dashboard-departure.sql` to validate departure timestamps, replay behavior, corrections and permissions; synthetic data is rolled back. Installed native apps require a separate new build.
