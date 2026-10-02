import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { STORAGE_LAYOUTS, positionRows, coolingTimes } from '../src/lib/coldStorage.mjs';
import { palletJourney } from '../src/lib/dashboardMetrics.mjs';
const db = new PGlite();
const actor = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
await db.exec(`create role anon; create role authenticated; create schema auth; create schema empaque_private;
create function auth.uid() returns uuid language sql as $$ select '${actor}'::uuid $$;
create table public.profiles(id uuid primary key,role text);
insert into public.profiles values('${actor}','frio');
create table public.records(entity text,id text,data jsonb not null default '{}'::jsonb,created_date timestamptz default now(),updated_date timestamptz default now(),primary key(entity,id),constraint records_entity_check check(entity in ('Location','Pallet','CoolingCycle','MovementEvent')));
grant usage on schema public,auth,empaque_private to authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update,delete on public.records to authenticated;
`);
await db.exec(await readFile('supabase/migrations/20261002131318_cold_storage_positions.sql', 'utf8'));
await db.exec(await readFile('supabase/migrations/20261002143214_app_integrity_review.sql', 'utf8'));
await db.exec(`alter table public.records enable row level security;
create policy read_records on public.records for select to authenticated using(true);
create policy write_records on public.records for all to authenticated using(empaque_private.allowed_write(entity)) with check(empaque_private.allowed_write(entity));
set role authenticated;`);
async function insert(entity, id, data) { await db.query('insert into public.records(entity,id,data) values($1,$2,$3)', [entity,id,JSON.stringify(data)]); }
async function get(entity, id) { return (await db.query('select data from public.records where entity=$1 and id=$2',[entity,id])).rows[0]?.data; }
async function command(action, payload, id = randomUUID()) { return (await db.query('select public.cold_storage_command($1,$2,$3) result',[id,action,JSON.stringify(payload)])).rows[0].result; }
async function cycle(action, location, expected = null, id = randomUUID()) { return (await db.query('select public.cooling_cycle_command($1,$2,$3,$4) result',[id,action,location,expected])).rows[0].result; }
await insert('Location','t1',{name:'T1',type:'tunel',capacity:18,active:true});
await insert('Location','c1',{name:'C1',type:'camara',capacity:100,active:true});
await insert('Location','c2',{name:'C2',type:'camara',capacity:100,active:true});
await command('distribucion',{location_id:'t1',layout:'tunel_18'});
await command('distribucion',{location_id:'c1',layout:'cinco_cargas'});
await command('distribucion',{location_id:'c2',layout:'cuatro_cargas'});
assert.equal((await get('Location','c1')).capacity,101);
assert.equal((await get('Location','c2')).capacity,84);
for (const [layout, def] of Object.entries(STORAGE_LAYOUTS)) for (const section of def.sections) {
 const numbers=positionRows(layout,section).flat().filter(n=>n!==null);
 assert.equal(new Set(numbers).size,numbers.length);
 assert.equal(Math.max(...numbers),numbers.length);
 assert.deepEqual([...numbers].sort((a,b)=>a-b),Array.from({length:numbers.length},(_,i)=>i+1));
}
assert.deepEqual(positionRows('cinco_cargas',5).at(-1),[19,20,21]);
await assert.rejects(cycle('iniciar','t1'),/al menos un pallet/);
for (let i=1;i<=3;i++) await insert('Pallet','p'+i,{status:'cerrado',pallet_code:'PAL-'+i});
const loadId=randomUUID(), load={location_id:'t1',pallet_id:'p1',expected_assignment:null};
assert.equal((await command('ingresar',load,loadId)).position,1);
assert.equal((await command('ingresar',load,loadId)).position,1);
assert.equal((await command('ingresar',{location_id:'t1',pallet_id:'p2'})).position,2);
assert.equal((await db.query("select count(*)::int n from public.records where entity='MovementEvent' and id=$1",[loadId])).rows[0].n,1);
await assert.rejects(command('ingresar',{location_id:'t1',pallet_id:'p1'}),/ya está/);
await assert.rejects(command('posicion',{location_id:'t1',pallet_id:'p1',position:2}),/ocupada/);
await assert.rejects(command('distribucion',{location_id:'t1',layout:'tunel_18'}),/posiciones asignadas/);
const assignment=(await get('Pallet','p1')).storage_assignment_id;
await command('posicion',{location_id:'t1',pallet_id:'p1',position:3,expected_assignment:assignment});
await assert.rejects(command('retirar',{location_id:'t1',pallet_id:'p1',expected_assignment:assignment}),/posición.*cambió/);
const start=await cycle('iniciar','t1'); // Partial tunnel is valid.
await cycle('iniciar','t1',null,start.operation_id); // Safe retry.
const a=await get('Pallet','p1'), b=await get('Pallet','p2');
assert.equal(a.cooling_started_at,b.cooling_started_at);
for (const [action,payload] of [
 ['ingresar',{location_id:'t1',pallet_id:'p3'}],['retirar',{location_id:'t1',pallet_id:'p1'}],
 ['posicion',{location_id:'t1',pallet_id:'p1',position:4}],['ingresar',{location_id:'c1',pallet_id:'p1',section:1}]
]) await assert.rejects(command(action,payload),/bloqueado/);
await assert.rejects(db.query("update public.records set data=data||'{\"location_id\":null}' where entity='Pallet' and id='p1'"),/desde Frío/);
await assert.rejects(db.query("delete from public.records where entity='Pallet' and id='p1'"),/desde Frío/);
await assert.rejects(db.query("update public.records set data=data||'{\"status\":\"cerrado\"}' where entity='CoolingCycle'"),/operaciones de frío/);
await assert.rejects(cycle('finalizar','t1',randomUUID()),/ciclo cambió/);
const end=await cycle('finalizar','t1',start.operation_id);
await cycle('finalizar','t1',start.operation_id,end.operation_id);
const done1=await get('Pallet','p1'),done2=await get('Pallet','p2');
assert.equal(done1.cooling_finished_at,done2.cooling_finished_at);
assert.equal(done1.location_id,'t1'); assert.equal(done1.storage_position,3);
assert.equal((await get('Location','t1')).occupied,2);
assert.equal(done1.status,'prefrio_finalizado');
await assert.rejects(cycle('iniciar','t1'),/ciclo anterior/);
await command('ingresar',{location_id:'c1',pallet_id:'p1',section:5,expected_assignment:done1.storage_assignment_id});
assert.equal((await get('Pallet','p1')).storage_position,1);
assert.equal((await get('Location','t1')).occupied,1);
assert.equal((await get('Location','c1')).occupied,1);
const chamberPallet=await get('Pallet','p1'), entered=chamberPallet.storage_entered_at;
await command('posicion',{location_id:'c1',pallet_id:'p1',section:5,position:21,expected_assignment:chamberPallet.storage_assignment_id});
assert.equal((await get('Pallet','p1')).storage_entered_at,entered);
await assert.rejects(command('distribucion',{location_id:'c1',layout:'cuatro_cargas'}),/posiciones asignadas/);
await assert.rejects(db.query("update public.records set data=data||'{\"capacity\":1}' where entity='Location' and id='c1'"),/distribución/);
const batchId=(await get('Pallet','p1')).storage_batch_id;
await command('iniciar_carga',{location_id:'c1',section:5});
assert.ok((await get('StorageBatch',batchId)).started_at);
for (let i=1;i<=20;i++) {
 await insert('Pallet','room-'+i,{status:'liberado'});
 const result=await command('ingresar',{location_id:'c1',pallet_id:'room-'+i,section:5});
 assert.equal(result.position,i);
}
await insert('Pallet','overflow',{status:'liberado'});
await assert.rejects(command('ingresar',{location_id:'c1',pallet_id:'overflow',section:5}),/disponibles/);
assert.ok((await get('StorageBatch',batchId)).completed_at);
await command('retirar',{location_id:'c1',pallet_id:'p1'});
assert.equal((await get('Pallet','p1')).location_id,undefined);
assert.equal((await get('Location','c1')).occupied,20);
// Existing records are not assigned fake slots or arrival dates by migration.
await db.exec("reset role; select set_config('rimonim.cold_command','on',false)");
await insert('Pallet','legacy',{status:'en_camara',location_id:'c2'});
await db.exec("select set_config('rimonim.cold_command','',false); set role authenticated");
await assert.rejects(command('ingresar',{location_id:'c2',pallet_id:'overflow',section:1}),/existentes/);
await command('posicion',{location_id:'c2',pallet_id:'legacy',section:1,position:21});
assert.equal((await get('Pallet','legacy')).storage_entered_at,undefined);
await db.exec(`reset role; update public.profiles set role='produccion'; set role authenticated`);
await assert.rejects(command('retirar',{location_id:'c2',pallet_id:'legacy'}),/permiso/);
assert.deepEqual(coolingTimes({storage_entered_at:'2026-01-01T01:00Z',cooling_started_at:'2026-01-01T02:00Z',cooling_finished_at:'2026-01-01T03:00Z'}),{waiting:3600000,cooling:3600000});
const journey=palletJourney({id:'p',status:'en_camara',location_id:'c',created_date:'2026-01-01T00:00Z'},[
 {id:'a',unit_type:'pallet',unit_id:'p',operation_action:'carga_tunel',destination_location_id:'t',created_date:'2026-01-01T01:00Z'},
 {id:'b',unit_type:'pallet',unit_id:'p',operation_action:'fin_prefrio',destination_location_id:'t',created_date:'2026-01-01T02:00Z'},
 {id:'c',unit_type:'pallet',unit_id:'p',operation_action:'carga_camara',origin_location_id:'t',destination_location_id:'c',created_date:'2026-01-01T03:00Z'}
],[]);
assert.equal(journey.intervals.find(s=>s.key==='tunnel').ms,7200000);
assert.equal(journey.intervals.find(s=>s.key==='toChamber').ms,0);
await db.close();
console.log('Planos, posición 21, idempotencia, ciclo parcial, bloqueo, traslado, tiempos, permisos y registros históricos: OK');
