import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const a='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);`);
 for(const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()) await db.exec(await readFile('supabase/migrations/'+name,'utf8'));
 await db.exec(`insert into auth.users values('${a}','company-a@example.test','{}'),('${b}','company-b@example.test','{}');
 update public.profiles set role='admin' where id='${a}';
 insert into public.companies(name,slug) values('Empresa B','empresa-b');
 insert into public.company_memberships(company_id,user_id,role) select id,'${b}','frio' from public.companies where slug='empresa-b';
 grant usage on schema auth,public to authenticated;
 grant select,insert,update,delete on public.records to authenticated;
 grant select on public.profiles to authenticated;`);
 const companies=(await db.query('select id,slug from public.companies')).rows;
 const ca=companies.find(c=>c.slug==='rimonim').id,cb=companies.find(c=>c.slug==='empresa-b').id;
 const actor=async(id,company)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.headers',$2,false)",[id,company?JSON.stringify({'x-empaco-company':company}):'{}']);await db.exec('set role authenticated');};
 const insert=async(entity,id,data)=>db.query('insert into public.records(entity,id,data) values($1,$2,$3)',[entity,id,data]);
 await actor(a,ca);
 await insert('Location','room-a',{type:'camara',capacity:100,active:true});
 await insert('Pallet','pallet-a',{net_weight:100,status:'liberado',pallet_code:'PAL-shared'});
 await actor(b,cb);
 assert.equal((await db.query('select empaque_private.my_role() role')).rows[0].role,'frio');
 assert.equal((await db.query("select count(*)::int n from public.records where id in ('pallet-a','room-a')")).rows[0].n,0);
 await insert('Location','room-b',{type:'camara',capacity:100,active:true});
 await insert('Pallet','pallet-b',{net_weight:100,status:'liberado',pallet_code:'PAL-shared'});
 await db.query('select public.cold_storage_command(gen_random_uuid(),$1,$2)',['distribucion',{location_id:'room-b',layout:'cinco_cargas'}]);
 await db.query('select public.cold_storage_command(gen_random_uuid(),$1,$2)',['ingresar',{location_id:'room-b',pallet_id:'pallet-b',section:1}]);
 await assert.rejects(db.query('select public.cold_storage_command(gen_random_uuid(),$1,$2)',['ingresar',{location_id:'room-b',pallet_id:'pallet-a',section:1}]));
 await assert.rejects(insert('Pallet','foreign-reference',{net_weight:100,status:'liberado',location_id:'room-a'}),/referencia/);
 await assert.rejects(db.query("select public.patch_record('Pallet','pallet-a','{\"net_weight\":200}','{}')"),/not found/i);
 assert.equal((await db.query("delete from public.records where id='pallet-a' returning id")).rows.length,0);
 await assert.rejects(db.query("update public.records set company_id=$1 where id='pallet-b'",[ca]),/empresa/);
 await assert.rejects(db.query("select public.create_company('No permitido','no-permitido')"),/administración/);
 await actor(a,cb); // forged tenant header
 assert.equal((await db.query('select count(*)::int n from public.records')).rows[0].n,0);
 await assert.rejects(insert('Location','spoof',{type:'camara',capacity:100}));
 await actor(b,null); // old client cannot fall through to a different tenant
 assert.equal((await db.query('select count(*)::int n from public.records')).rows[0].n,0);
 await actor(a,null); // legacy Rimonim stays compatible
 assert.equal((await db.query("select count(*)::int n from public.records where id='pallet-a'")).rows[0].n,1);
 const users=(await db.query('select * from public.company_users()')).rows;
 assert.deepEqual(users.map(u=>u.id),[a]);
 await assert.rejects(db.query('select public.set_company_role($1,$2)',[b,'admin']),/no encontrado/);
 await assert.rejects(db.query('select public.set_company_role($1,$2)',[a,'user']),/al menos un administrador/);
 await db.exec('reset role');
 const pallets=(await db.query("select data->>'romaneo_number' number from public.records where entity='Pallet' order by id")).rows;
 assert.equal(pallets[0].number,pallets[1].number); // independent counters
 const unsafe=(await db.query("select proname from pg_proc where pronamespace='public'::regnamespace and proname<>'create_profile' and prosrc ~ 'select role.*public.profiles'")).rows;
 assert.equal(unsafe.length,0);
 await db.query('insert into empaque_private.platform_admins values($1)',[a]);
 await actor(a,ca);
 const created=(await db.query("select (public.create_company('Empresa vacía','empresa-vacia')).id id")).rows[0].id;
 await actor(a,created);
 assert.equal((await db.query('select count(*)::int n from public.records')).rows[0].n,0);
 assert.equal((await db.query('select * from public.company_users()')).rows[0].role,'admin');
 await actor(a,cb);
 assert.equal((await db.query('select count(*)::int n from public.records')).rows[0].n,0,'Platform administration does not grant implicit access to client operations');
 console.log('PASS: dos empresas aisladas; lectura/escritura/RPC/QR/referencias/roles protegidos; cliente antiguo Rimonim compatible; romaneos independientes');
} catch(e) { console.error('Company isolation:',e.message,e.detail || ''); process.exitCode=1; } finally { await db.close(); }
