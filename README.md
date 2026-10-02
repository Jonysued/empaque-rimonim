# Empaque Rimonim — Supabase + Vercel

React/Vite frontend on Vercel; Supabase Auth and Postgres for users and operational records. Base44 is no longer used at runtime.

## Setup

1. Create a Supabase project. Apply every file in `supabase/migrations/` in filename order. Later migrations add the atomic operational functions and current permissions.
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

### Planos y posiciones de frío

En Prefrío y Cámaras se elige primero la distribución. Los túneles tienen 18 posiciones (dos filas de nueve); las cámaras admiten cinco cargas (20 + 20 + 20 + 20 + **21**, total 101) o cuatro cargas de 21 (total 84). La numeración respeta los planos físicos. Las cargas son sectores de almacenamiento y no representan despachos.

El servidor asigna la primera posición libre por número en la carga seleccionada. «Editar posición» permite confirmar otra posición libre. No se puede cambiar la distribución con posiciones asignadas. Los pallets históricos quedan pendientes de ubicar: el operador confirma su ubicación real y no se inventa una fecha de ingreso.

Se puede iniciar un túnel con al menos un pallet, sin completarlo. Desde el inicio hasta el fin del ciclo no se puede agregar, retirar ni cambiar posiciones, incluso desde otro dispositivo o mediante las APIs anteriores. Todos los miembros conservan el mismo inicio y fin. Finalizar cambia el estado a `prefrio_finalizado` pero **conserva la ubicación y su ocupación** hasta confirmar la salida o escanear el pallet en una cámara. Ese traslado directo confirma ambas ubicaciones en una sola transacción.

Se muestran por separado la espera antes del prefrío y el prefrío efectivo. En cámara, cada pallet tiene su propio tiempo desde el ingreso; cada carga conserva el ingreso del primer pallet, su primera fecha de completado y su inicio (automático al completarse o manual si está incompleta). La carga termina cuando sale su último pallet. El historial conserva los miembros y tiempos aunque cambie la ocupación.

Sin conexión, los movimientos se guardan con un UUID y se muestran pendientes; no reservan una posición confirmada. Al reconectar, el servidor valida la asignación original y la versión del plano, asigna una posición libre y evita duplicados. Los cambios de distribución y de ciclo requieren conexión. Los conflictos permanecen en revisión en el indicador de sincronización. El inicio de un ciclo se deshabilita si este dispositivo tiene movimientos pendientes en ese túnel.

Verificaciones de regresión: `npm run check:cold-storage`, `node scripts/check-offline-queue.mjs` y `node scripts/check-dashboard-metrics.mjs`. La primera ejecuta la migración en PostgreSQL aislado (PGlite) con políticas de acceso y comprueba además el almacenamiento IndexedDB real, sin utilizar registros productivos.

### Revisión funcional del 2 de octubre de 2026

Se verificaron cosecha → consolidado → pesado → playa → vuelco, pallets → prefrío → cámaras → despachos, trazabilidad, roles, sincronización y pantallas de celular. `npm run check:app` ejecuta los casos de regresión y una instalación completa desde cero; `npm run check:cold-storage` comprueba las posiciones y bloqueos con todas las protecciones actuales.

Correcciones: avisos operativos visibles; invitaciones compatibles con el origen de iOS y Android; QR de consulta generados sin conexión; búsquedas normalizadas y con datos actualizados; trazabilidad que no une registros sin una corrida explícita; listas de pallets y cargas completas; errores de consulta y catálogos visibles; perfiles en caché conservados ante una pérdida de señal sin ocultar sesiones realmente rechazadas. El precargado sin conexión incluye las cargas físicas (`StorageBatch`).

Postgres asigna los romaneos mediante un contador anual privado y bloquea números/QR repetidos. Conserva los números históricos. Al editar el peso o los bultos de un pallet cargado, actualiza los totales de la carga en la misma transacción, también con el rol Producción. Para corregir un pallet enviado se reabre primero el despacho. Los pallets con movimientos o asociados a despachos no se pueden borrar; tampoco se permite reducir capacidad ni cambiar producto de una carga con pallets.

La trazabilidad de origen de los pallets creados manualmente sigue sin estar confirmada cuando no tienen una corrida vinculada: la pantalla lo indica y no inventa lotes. La revisión de permisos no habilita cuentas pendientes; el rol `user` se identifica como «Sin acceso» para reflejar la autorización que realmente aplica el servidor.

### Cargas flexibles en cámaras

Aplicar `20261002162159_flexible_chamber_loads.sql`. Las cargas 1–4 conservan su numeración y admiten 20 o 21 pallets. La quinta se habilita sin reemplazar el plano ocupado; el total es 101. Sus posiciones disponibles son 21 menos la cantidad de posiciones 21 ocupadas en las primeras cuatro: 20+20+21+21 deja 19; 4×21 deja 17. El servidor rechaza ocupar una posición 21 si invade posiciones ocupadas de la quinta.

Las primeras cuatro pueden marcarse completas con 20 o 21; la quinta con su cantidad real. Una carga completa requiere reapertura explícita para agregar pallets. Reabrir conserva el inicio del tiempo y registra la información anterior en el evento. Los traslados y salidas siguen habilitados; los túneles mantienen sus reglas de bloqueo durante el prefrío.
