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
await db.exec(await readFile('supabase/migrations/20261002162159_flexible_chamber_loads.sql', 'utf8'));
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
await assert.rejects(command('ingresar',{location_id:'c1',pallet_id:'overflow',section:5}),/disponibles|completa/);
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

// Flexible chamber capacity, manual completion, safe reopening and historic slots.
await db.exec(`reset role; update public.profiles set role='frio'; set role authenticated`);
for (const perLoad of [20,21]) {
 const room='flex-'+perLoad;
 await insert('Location',room,{type:'camara',capacity:100,active:true});
 await command('distribucion',{location_id:room,layout:perLoad===21?'cuatro_cargas':'camara_flexible'});
 await insert('Pallet',room+'-fifth-probe',{status:'liberado',pallet_code:room+'-probe'});
 await assert.rejects(command('ingresar',{location_id:room,pallet_id:room+'-fifth-probe',section:5}),/Habilitá/);
 const assigned=[];
 for(let section=1;section<=4;section++) {
  for(let i=1;i<=perLoad;i++) {
   const id=room+'-'+section+'-'+i;
   await insert('Pallet',id,{status:'liberado',pallet_code:id});
   assert.equal((await command('ingresar',{location_id:room,pallet_id:id,section})).position,i);
   assigned.push([id,(await get('Pallet',id)).storage_assignment_id]);
   if(i===19)await assert.rejects(command('completar_carga',{location_id:room,section}),/20 o 21/);
  }
  const pallet=await get('Pallet',room+'-'+section+'-1');
  if(perLoad===20) {
   const request={location_id:room,section,expected_batch:pallet.storage_batch_id},op=randomUUID();
   await command('completar_carga',request,op);await command('completar_carga',request,op);
  }
  const batch=await get('StorageBatch',pallet.storage_batch_id);
  assert.equal(batch.completed_count,perLoad);assert.ok(batch.started_at);
 }
 await command('habilitar_quinta',{location_id:room});
 assert.equal((await get('Location',room)).capacity,101);
 for(const [id,assignment] of assigned)assert.equal((await get('Pallet',id)).storage_assignment_id,assignment);
 const max=101-4*perLoad;
 const physical=assigned.map(([id])=>({storage_section:Number(id.split('-').at(-2)),storage_position:Number(id.split('-').at(-1))}));
 assert.equal(positionRows('camara_flexible',5,physical).flat().filter(x=>x!==null).length,max);
 for(let i=1;i<=max;i++) {
  const id=room+'-5-'+i;await insert('Pallet',id,{status:'liberado',pallet_code:id});
  assert.equal((await command('ingresar',{location_id:room,pallet_id:id,section:5})).position,i);
  if(i===7) {
   const batchId=(await get('Pallet',id)).storage_batch_id;
   await command('completar_carga',{location_id:room,section:5,expected_batch:batchId});
   assert.equal((await get('StorageBatch',batchId)).completed_count,7);
   await assert.rejects(command('ingresar',{location_id:room,pallet_id:room+'-fifth-probe',section:5}),/completa/);
   await assert.rejects(command('reabrir_carga',{location_id:room,section:5,expected_batch:'stale'}),/cambió/);
   await command('reabrir_carga',{location_id:room,section:5,expected_batch:batchId});
  }
 }
 assert.equal((await get('Location',room)).occupied,101);
 await assert.rejects(command('ingresar',{location_id:room,pallet_id:room+'-fifth-probe',section:5}),/completa|disponibles/);
 if(perLoad===20) {
  const batchId=(await get('Pallet',room+'-1-1')).storage_batch_id;
  await command('reabrir_carga',{location_id:room,section:1,expected_batch:batchId});
  await assert.rejects(command('posicion',{location_id:room,pallet_id:room+'-1-1',section:1,position:21}),/quinta/);
  await command('retirar',{location_id:room,pallet_id:room+'-5-21'});
  await command('posicion',{location_id:room,pallet_id:room+'-1-1',section:1,position:21});
  assert.equal((await get('Pallet',room+'-1-1')).storage_position,21);
 }
}
const mixedRoom='mixed-room';
await insert('Location',mixedRoom,{type:'camara',capacity:100,active:true});
await command('distribucion',{location_id:mixedRoom,layout:'camara_flexible'});
for(const [index,count] of [20,20,21,21].entries()) {
 for(let n=1;n<=count;n++) {
  const id=`mixed-${index+1}-${n}`;await insert('Pallet',id,{status:'liberado',pallet_code:id});
  await command('ingresar',{location_id:mixedRoom,pallet_id:id,section:index+1});
 }
 if(count===20)await command('completar_carga',{location_id:mixedRoom,section:index+1});
}
await command('habilitar_quinta',{location_id:mixedRoom});
for(let n=1;n<=19;n++) {
 const id='mixed-fifth-'+n;await insert('Pallet',id,{status:'liberado',pallet_code:id});
 assert.equal((await command('ingresar',{location_id:mixedRoom,pallet_id:id,section:5})).position,n);
}
assert.equal((await get('Location',mixedRoom)).occupied,101);
await insert('Pallet','mixed-overflow',{status:'liberado',pallet_code:'mixed-overflow'});
await assert.rejects(command('ingresar',{location_id:mixedRoom,pallet_id:'mixed-overflow',section:5}),/completa|disponibles/);
console.log('Combinación mixta: 20 + 20 + 21 + 21 deja exactamente 19 lugares para la quinta: OK');
console.log('Cámara flexible: 4×20 + 21, 4×21 + 17, quinta opcional con 7, reapertura y posiciones preservadas: OK');

await db.close();
console.log('Planos, posición 21, idempotencia, ciclo parcial, bloqueo, traslado, tiempos, permisos y registros históricos: OK');
