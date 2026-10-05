import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);`);
 for(const name of (await readdir('supabase/migrations')).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+name,'utf8'));
 await db.exec(`insert into auth.users values('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb','qa@example.test','{}');
 update public.profiles set role='frio';
 grant usage on schema auth,public to authenticated;
 grant select,insert,update,delete on public.records to authenticated;grant select on public.profiles to authenticated;
 select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',false);set role authenticated;
 insert into public.records(entity,id,data)values('Location','fresh-room','{"type":"camara","capacity":100,"active":true}');
 select public.cold_storage_command(gen_random_uuid(),'distribucion','{"location_id":"fresh-room","layout":"cinco_cargas"}');
 insert into public.records(entity,id,data)values('Pallet','fresh-pallet','{"net_weight":500,"status":"liberado","product_type":"fresco"}');
 select public.cold_storage_command(gen_random_uuid(),'ingresar','{"location_id":"fresh-room","pallet_id":"fresh-pallet","section":5}');`);
 const batch=(await db.query(`select data from public.records where entity='StorageBatch'`)).rows;
 assert.equal(batch.length,1);assert.equal(batch[0].data.section,5);
 console.log('PASS: instalación limpia con todas las migraciones y rol Frío crea una carga con posiciones');
} catch(e) {console.error('Fresh schema:',e.message);process.exitCode=1;}finally {await db.close();}
