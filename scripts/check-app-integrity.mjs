import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import handler from '../api/invite.js';
import { findTrace, lotTrace, palletTrace } from '../src/lib/traceability.mjs';

const trace = {lots:[{id:'l',lot_code:'LOT-A'}],bins:[],dumps:[{id:'d',receipt_lot_id:'l'}],runs:[],pallets:[{id:'p',pallet_code:'PAL-A',romaneo_number:123}],shipments:[{id:'s',load_number:456}]};
assert.equal(palletTrace(trace,trace.pallets[0]).dumps.length,0);
assert.equal(palletTrace(trace,trace.pallets[0]).lots.length,0);
assert.equal(lotTrace(trace,trace.lots[0]).pallets.length,0);
assert.equal(findTrace(trace,' pal-a ').entity.id,'p');
assert.equal(findTrace(trace,'123').entity.id,'p');
assert.equal(findTrace(trace,'456').entity.id,'s');
trace.dumps[0].production_run_id='r';trace.pallets[0].production_run_id='r';trace.runs.push({id:'r'});
assert.equal(palletTrace(trace,trace.pallets[0]).lots[0].id,'l');
assert.equal(lotTrace(trace,trace.lots[0]).pallets[0].id,'p');
for (const origin of ['capacitor://localhost','https://localhost','https://untrusted.example']) {
 const headers={};const res={setHeader:(k,v)=>{headers[k]=v;},status:n=>{res.code=n;return res;},end:()=>{},json:()=>{}};
 await handler({headers:{origin},method:'OPTIONS'},res);
 assert.equal(res.code,204);
 assert.equal(headers['Access-Control-Allow-Origin'],origin.endsWith('://localhost')?origin:undefined);
}
const db = new PGlite();
try {
 await db.exec(`create role anon; create role authenticated; create schema auth; create schema empaque_private;
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table public.profiles(id uuid primary key,role text);
 insert into public.profiles values('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','admin');
 create table public.records(entity text,id text,data jsonb not null default '{}',created_date timestamptz default now(),updated_date timestamptz default now(),primary key(entity,id),constraint records_entity_check check(entity in ('ReceiptLot','Bin','DumpingEvent','ProductionRun','Pallet','Location','CoolingCycle','Shipment','MovementEvent','Catalog','QualityHold','AuditEvent')));
 grant usage on schema public,auth,empaque_private to authenticated;
 grant select on public.profiles to authenticated;grant select,insert,update,delete on public.records to authenticated;`);
 for (const file of ['20260924113104_atomic_shipment_pallet.sql','20260924115201_atomic_pallet_locations.sql','20260924115215_atomic_cooling_cycles.sql','20260924135332_unload_pallet_from_shipment.sql','20260924140933_reopen_shipment_for_correction.sql','20260928195900_dump_lot_by_bins.sql','20260930153205_field_lot_workflow.sql','20260930170509_harvest_bin_consolidation.sql','20260930172000_scope_harvest_guard_to_bins.sql','20260930184000_dump_bin_by_qr.sql','20260930191411_dashboard_pallet_dispatch_timing.sql','20261002131318_cold_storage_positions.sql']) {
  await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 }
 await db.exec(`alter table public.records enable row level security;
 create function public.patch_record(p_entity text,p_id text,p_patch jsonb,p_unset text[] default '{}') returns public.records language plpgsql security invoker set search_path='' as $$
 declare result public.records;begin update public.records set data=(data||p_patch)-p_unset where entity=p_entity and id=p_id returning * into result;if not found then raise exception 'Record not found';end if;return result;end $$;
 create policy read_records on public.records for select to authenticated using(true);
 create policy write_records on public.records for all to authenticated using(empaque_private.allowed_write(entity)) with check(empaque_private.allowed_write(entity));
 select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',false);set role authenticated;`);
 const insert=async(entity,id,data)=>db.query('insert into public.records(entity,id,data) values($1,$2,$3)',[entity,id,JSON.stringify(data)]);
 const get=async(entity,id)=>(await db.query('select data from public.records where entity=$1 and id=$2',[entity,id])).rows[0]?.data;
 const patch=async(entity,id,data)=>db.query('update public.records set data=data||$3::jsonb where entity=$1 and id=$2',[entity,id,JSON.stringify(data)]);
 await insert('Pallet','baseline-p',{pallet_code:'BASE-P',romaneo_number:'ROM-2026-00051',status:'liberado',product_type:'fresco',net_weight:500,package_count:100});
 await insert('Shipment','baseline-s',{status:'borrador',product_type:'fresco',target_capacity:21});
 await db.query('select public.load_pallet_into_shipment($1,$2,$3)',[randomUUID(),'baseline-s','baseline-p']);
 await patch('Pallet','baseline-p',{net_weight:600,package_count:120});
 assert.equal((await get('Shipment','baseline-s')).total_weight,500); // Reproduces the original stale total.
 await db.exec(`delete from public.records where entity='Pallet' and id='baseline-p'`);
 assert.deepEqual((await get('Shipment','baseline-s')).loaded_pallet_ids,['baseline-p']); // Original dangling load.
 await db.exec(`reset role; delete from public.records where id in ('baseline-s','baseline-p') or data->>'unit_id'='baseline-p';`);
 await insert('Pallet','historic',{pallet_code:'HISTORIC',romaneo_number:'ROM-2026-00051',status:'armado',net_weight:100,package_count:20});
 await db.exec(await readFile('supabase/migrations/20261002143214_app_integrity_review.sql','utf8'));
 await db.exec('set role authenticated');
 await Promise.all([insert('Pallet','p1',{pallet_code:'PAL-1',romaneo_number:'ROM-2026-00001',status:'liberado',product_type:'fresco',net_weight:500,package_count:100}),insert('Pallet','p2',{pallet_code:'PAL-2',romaneo_number:'ROM-2026-00001',status:'liberado',product_type:'fresco',net_weight:400,package_count:80})]);
 assert.equal((await get('Pallet','historic')).romaneo_number,'ROM-2026-00051');
 assert.equal((await get('Pallet','p1')).romaneo_number,'ROM-2026-00052');
 assert.equal((await get('Pallet','p2')).romaneo_number,'ROM-2026-00053');
 await db.exec(`delete from public.records where entity='Pallet' and id='historic'`);
 await insert('Pallet','p3',{net_weight:300,status:'liberado',product_type:'fresco'});
 assert.equal((await get('Pallet','p3')).romaneo_number,'ROM-2026-00054');
 await assert.rejects(patch('Pallet','p1',{romaneo_number:'ROM-2026-99999'}),/no se pueden cambiar/);
 for(const invalid of [{net_weight:-5},{net_weight:'NaN'},{package_count:-1},{package_count:1.5},{tare_weight:-1}])await assert.rejects(patch('Pallet','p1',invalid),/pesos válidos/);
 await insert('Shipment','s',{status:'borrador',product_type:'fresco',target_capacity:21});
 const operation=randomUUID();
 await db.query('select public.load_pallet_into_shipment($1,$2,$3)',[operation,'s','p1']);
 await db.query('select public.load_pallet_into_shipment($1,$2,$3)',[operation,'s','p1']);
 await db.query('select public.load_pallet_into_shipment($1,$2,$3)',[randomUUID(),'s','p2']);
 await db.exec(`reset role; update public.profiles set role='produccion';set role authenticated;`);
 await patch('Pallet','p1',{net_weight:600,package_count:120});
 assert.equal((await get('Shipment','s')).total_weight,1000);
 assert.equal((await get('Shipment','s')).total_packages,200);
 await patch('Shipment','s',{client:'Blocked'});
 assert.equal((await get('Shipment','s')).client,undefined); // RLS hides the row from UPDATE.
 await db.exec(`reset role; update public.profiles set role='admin';set role authenticated;`);
 await assert.rejects(patch('Shipment','s',{target_capacity:1}),/capacidad/);
 await assert.rejects(patch('Shipment','s',{product_type:'arilos'}),/producto/);
 await assert.rejects(patch('Pallet','p1',{product_type:'arilos'}),/Retirá/);
 await assert.rejects(db.exec(`delete from public.records where entity='Pallet' and id='p1'`),/eliminar/);
 await assert.rejects(db.exec(`delete from public.records where entity='Shipment' and id='s'`),/Retirá/);
 await patch('Shipment','s',{status:'enviado'});
 await assert.rejects(patch('Pallet','p1',{net_weight:700}),/Reabrí/);
 assert.equal((await get('Pallet','p1')).net_weight,600);
 await db.query('select public.reopen_shipment_for_correction($1,$2)',[randomUUID(),'s']);
 await patch('Pallet','p1',{net_weight:700});
 assert.equal((await get('Shipment','s')).total_weight,1100);
 await db.query('select public.unload_pallet_from_shipment($1,$2,$3)',[randomUUID(),'s','p1']);
 assert.equal((await get('Shipment','s')).total_weight,400);
 await assert.rejects(db.exec(`delete from public.records where entity='Pallet' and id='p1'`),/movimientos/);
 // Existing operational SQL suites each use BEGIN/ROLLBACK.
 for(const file of ['check-field-lot-workflow.sql','check-harvest-consolidation.sql','check-bin-qr-dump.sql','check-dashboard-departure.sql'])await db.exec(await readFile('scripts/'+file,'utf8'));
 await db.exec(`reset role;update public.profiles set role='user';set role authenticated;`);
 await assert.rejects(db.query('select empaque_private.next_romaneo()'),/permiso/);
 console.log('PASS: trazabilidad sin vínculos falsos, invitaciones iOS/Android, romaneos únicos, edición de pallets cargados, totales, borrados protegidos, permisos y flujo campo→despacho');
} finally {await db.close();}
