import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { canAccess, ROLES } from '../src/lib/permissions.js';

for (const path of ['/', '/recepcion', '/consolidado-lote', '/pesado-lote', '/recepcion-playa', '/vuelco', '/produccion', '/prefrio', '/camaras', '/despachos', '/trazabilidad', '/stock-insumos', '/catalogos']) assert.ok(canAccess('consulta', path), path);
for (const path of ['/usuarios', '/empresas', '/unknown']) assert.equal(canAccess('consulta', path), false);
assert.ok(ROLES.some(role => role.value === 'consulta' && role.label === 'Solo lectura'));

// Exercise the real client guard with a company-scoped profile. No secrets or
// network requests are needed to refuse a command before it reaches IndexedDB.
let cachedRole = 'consulta', company = 'a';
const guardSource = (await readFile('src/lib/writeAccess.js', 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const guard = new Function('localSessionIdentity', 'currentWorkspace', 'readSnapshot', `${guardSource};return assertOperationalWrite;`)(
  async () => ({id:'viewer'}), () => ({id:company}), async (id, key) => {
    assert.equal(id, 'viewer'); assert.equal(key, `profile:${company}`);
    return cachedRole ? {role:cachedRole} : null;
  });
await assert.rejects(guard(), /solo lectura/);
cachedRole = null; await assert.rejects(guard(), /solo lectura/);
cachedRole = 'admin'; await guard(); company = 'b'; cachedRole = 'consulta'; await assert.rejects(guard(), /solo lectura/);
const queueSource = (await readFile('src/lib/operationQueue.js','utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
let persisted = 0;
const enqueue = new Function('assertOperationalWrite','enqueueCommand',`${queueSource};return submitOperation;`)(guard, async () => {persisted++;});
await assert.rejects(enqueue('field_lot_operation',{},'lot','test-op'), /solo lectura/);
assert.equal(persisted, 0);

const db = new PGlite();
const admin = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', viewer = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);`);
  for (const name of (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  await db.exec(`insert into auth.users values('${admin}','admin@example.test','{}'),('${viewer}','viewer@example.test','{}');
    update public.profiles set role='admin' where id='${admin}';
    grant usage on schema auth to authenticated;
    grant select on public.profiles to authenticated;
    grant select,insert,update,delete on public.records to authenticated;
    insert into public.companies(name,slug) values('Other','other');`);
  const companyA = (await db.query("select id from public.companies where slug='rimonim'")).rows[0].id;
  const companyB = (await db.query("select id from public.companies where slug='other'")).rows[0].id;
  await db.query('insert into public.company_memberships(company_id,user_id,role) values($1,$2,$3)', [companyA,viewer,'user']);
  await db.query('insert into public.records(entity,id,company_id,data) values($1,$2,$3,$4),($1,$5,$6,$4)', ['Catalog','catalog-a',companyA,{type:'productor',label:'A'},'catalog-b',companyB]);
  await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false);set role authenticated;`);
  await db.query('select public.set_company_role($1,$2)', [viewer,'consulta']);
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','${viewer}',false);set role authenticated;`);
  assert.equal((await db.query('select public.my_role() role')).rows[0].role,'consulta');
  assert.deepEqual((await db.query('select id from public.records')).rows.map(row => row.id), ['catalog-a']);
  assert.equal((await db.query('select public.allowed_write($1) allowed',['Catalog'])).rows[0].allowed,false);
  await assert.rejects(db.query("insert into public.records(entity,id,data) values('Catalog','forbidden','{}')"), /row-level security/);
  assert.equal((await db.query("update public.records set data='{}' where id='catalog-a' returning id")).rows.length, 0);
  assert.equal((await db.query("delete from public.records where id='catalog-a' returning id")).rows.length, 0);
  await assert.rejects(db.query('select public.patch_record($1,$2,$3)', ['Catalog','catalog-a',{label:'changed'}]), /Record not found/);
  assert.equal((await db.query("select data->>'label' label from public.records where id='catalog-a'")).rows[0].label, 'A');
  const denied = [
    ['select public.harvest_bin_operation($1,$2,$3)', [crypto.randomUUID(),'bin-new',{bin_code:'BIN-NEW'}]],
    ['select public.field_lot_operation($1,$2,$3,$4)', [crypto.randomUUID(),'lot-new','create',{workflow_version:3,lot_code:'LOT-NEW'}]],
    ['select public.offline_record_operation($1,$2,$3,$4,$5)', [crypto.randomUUID(),'Pallet','pallet-new','create',{net_weight:100}]],
    ['select public.cold_storage_command($1,$2,$3)', [crypto.randomUUID(),'distribucion',{location_id:'cold'}]],
    ['select public.load_pallet_into_shipment($1,$2,$3)', [crypto.randomUUID(),'shipment','pallet']],
    ['select public.dump_bin_by_qr($1,$2,$3,$4,$5)', [crypto.randomUUID(),'bin','lot','BIN','VOL']],
    ['select public.supply_command($1,$2,$3)', [crypto.randomUUID(),'item',{}]],
    ['select public.admin_harvest_correction($1,$2,$3,$4,$5)', [crypto.randomUUID(),'Bin','bin','edit',{}]],
    ['select public.set_company_role($1,$2)', [viewer,'admin']],
  ];
  for (const [sql,params] of denied) await assert.rejects(db.query(sql,params), /permiso|autorizad|administrador|responsable|stock/i, sql);
  await db.query('select public.supply_snapshot()');
  await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({'x-empaco-company':companyB})]);
  assert.equal((await db.query('select id from public.records')).rows.length, 0);
  await assert.rejects(db.query('select public.supply_snapshot()'), /autorizado/);
  await db.exec(`reset role;select set_config('request.headers','{}',false);select set_config('request.jwt.claim.sub','${admin}',false);set role authenticated;`);
  await db.query('select public.set_company_role($1,$2)', [viewer,'produccion']);
  assert.equal((await db.query('select public.my_role() role')).rows[0].role,'admin');
  console.log('PASS: consulta reads own company, cannot mutate records/RPCs/roles or enqueue offline writes; admin can assign and revoke role');
} catch (error) { console.error(error.message, error.actual?.message || '', error.query || ''); process.exitCode = 1; }
finally { await db.close(); }
