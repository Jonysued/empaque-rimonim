import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const admin='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',production='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', outsider='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const id=()=>crypto.randomUUID();let company;
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);`);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()){
  if(f.includes('supply_stock_and_pallet_consumption')){
   await db.exec(`insert into auth.users values('${admin}','stock-admin@example.test','{}');update public.profiles set role='admin' where id='${admin}';select set_config('request.jwt.claim.sub','${admin}',false);insert into public.records(entity,id,data)values('Pallet','old-pallet','{"pallet_code":"PAL-OLD","status":"armado","net_weight":100,"package_count":10,"product_type":"fresco","package_type":"3.8 kg"}');select set_config('request.jwt.claim.sub','',false);`);
  }
  await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 }
 await db.exec(`insert into auth.users values('${admin}','stock-admin@example.test','{}'),('${production}','stock-production@example.test','{}'),('${outsider}','stock-other@example.test','{}') on conflict(id) do nothing;update public.profiles set role='admin' where id='${admin}';update public.profiles set role='produccion' where id='${production}';grant usage on schema auth to authenticated;grant select,insert,update,delete on public.records to authenticated;grant select on public.profiles to authenticated;`);
 company=(await db.query("select id from public.companies where slug='rimonim'")).rows[0].id;
 const actor=async(user,c=company)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.headers',$2,false)",[user,JSON.stringify({'x-empaco-company':c})]);await db.exec('set role authenticated');};
 const command=async(action,payload,operation=id())=>(await db.query('select public.supply_command($1,$2,$3) result',[operation,action,payload])).rows[0].result;
 const snapshot=async(params=[]) => (await db.query('select public.supply_snapshot() result',params)).rows[0].result;
 const qty=async(item,depot)=>(await snapshot()).balances.find(b=>b.item_id===item&&b.depot_id===depot)?.quantity||0;
 const pallet=async(palletId,count=240,extra={},op=id())=>db.query('select public.offline_record_operation($1,$2,$3,$4,$5,$6)',[op,'Pallet',palletId,'create',{pallet_code:'PAL-'+palletId,status:'armado',product_type:'fresco',package_type:'3.8 kg',category:'Primera',brand:'Rimonim',calibre:'7',package_count:count,net_weight:900,...extra},null]);
 const patch=async(palletId,payload,expected,op=id())=>db.query('select public.offline_record_operation($1,$2,$3,$4,$5,$6)',[op,'Pallet',palletId,'patch',payload,expected]);

 await actor(admin);
 const box=id(),wood=id(),depot=id(),dest=id(),rule=id();
 await command('item',{id:box,code:'BOX',name:'Caja 3.8 kg',unit:'un',minimum:1000});
 await command('item',{id:wood,code:'WOOD',name:'Pallet de madera',unit:'un',minimum:5});
 await command('depot',{id:depot,name:'Principal'});await command('depot',{id:dest,name:'Secundario'});
 const receipt={kind:'ingreso',supplier:'Proveedor',number:'0001-1',occurred_on:'2026-10-16',depot_id:depot,lines:[{item_id:box,quantity:1000},{item_id:wood,quantity:10}]},receiptOp=id();
 await command('movement',receipt,receiptOp);await command('movement',receipt,receiptOp);
 assert.equal(await qty(box,depot),1000,'Receipt replay must not duplicate stock');
 await assert.rejects(command('movement',receipt),/unique|duplicad/i);
 await assert.rejects(command('movement',{...receipt,kind:'consumo_automatico'}),/automáticamente/);
 await assert.rejects(db.query("insert into public.supply_movements(company_id,item_id,depot_id,quantity,kind)values($1,$2,$3,1,'forged')",[company,box,depot]),/Stock Insumos/);
 const recipe={id:rule,name:'Fresco 3.8',depot_id:depot,match:{product_type:'fresco',package_type:'3.8 kg'},lines:[{item_id:box,quantity:1,basis:'package'},{item_id:wood,quantity:1,basis:'pallet'}]};
 const completeDoc=(await db.query('select public.supply_document_detail($1) result',[receiptOp])).rows[0].result;assert.equal(completeDoc.movements.length,2,'Remito detail must contain every line');
 await command('rule',recipe);
 await actor(production);
 await assert.rejects(patch('old-pallet',{package_count:20},{package_count:10}),/permiso/);await actor(admin);await patch('old-pallet',{package_count:20},{package_count:10});assert.equal(await qty(box,depot),1000,'Existing pallets must not consume retroactively');
 await actor(production);await assert.rejects(command('item',{code:'NO',name:'No',unit:'un'}),/permiso/);
 const createOp=id();await pallet('new',240,{},createOp);await pallet('new',240,{},createOp);await actor(admin);
 assert.equal(await qty(box,depot),760);assert.equal(await qty(wood,depot),9);
 const editOp=id();await patch('new',{package_count:214},{package_count:240},editOp);await patch('new',{package_count:214},{package_count:240},editOp);assert.equal(await qty(box,depot),786);assert.equal(await qty(wood,depot),9);
 const before=(await snapshot()).movements.length;
 await patch('new',{net_weight:950},{net_weight:900});assert.equal((await snapshot()).movements.length,before,'Unrelated pallet edit creates no material movement');
 await actor(admin);await command('rule',{...recipe,version:1,lines:[{item_id:box,quantity:2,basis:'package'},{item_id:wood,quantity:1,basis:'pallet'}]});
 await actor(admin);await patch('new',{package_count:200},{package_count:214});assert.equal(await qty(box,depot),800,'Existing pallet must keep its original rule version');
 await pallet('second',100);assert.equal(await qty(box,depot),600,'New pallet uses revised rule');
 await assert.rejects(pallet('shortage',10000),/Stock insuficiente/);assert.equal(await qty(box,depot),600,'Failed production rolls back all stock and pallet writes');
 assert.equal((await db.query("select count(*)::int n from public.records where entity='Pallet' and id='shortage'")).rows[0].n,0);
 await pallet('missing',20,{package_type:'no-rule'});assert.equal((await snapshot()).pending_count,1);
 await actor(admin);await command('rule',{name:'Other packaging',depot_id:depot,match:{product_type:'fresco',package_type:'no-rule'},lines:[{item_id:box,quantity:1,basis:'package'}]});
 assert.equal(await qty(box,depot),600,'Saving a rule does not retroactively charge pallets');
 const applyOp=id();await command('apply_rule',{pallet_id:'missing'},applyOp);await command('apply_rule',{pallet_id:'missing'},applyOp);assert.equal(await qty(box,depot),580);
 await command('movement',{kind:'traslado',depot_id:depot,destination_id:dest,occurred_on:'2026-10-16',notes:'Traslado QA',lines:[{item_id:box,quantity:80}]});assert.equal(await qty(box,depot),500);assert.equal(await qty(box,dest),80);
 const adjustment=id();await command('movement',{kind:'ajuste',depot_id:dest,occurred_on:'2026-10-16',notes:'Conteo físico',lines:[{item_id:box,quantity:20}]},adjustment);assert.equal(await qty(box,dest),100);
 await command('reverse_document',{document_id:adjustment,notes:'Corrección conteo'});assert.equal(await qty(box,dest),80);
 await assert.rejects(command('reverse_document',{document_id:adjustment,notes:'Otra vez'}),/reversión/);
 // Delete a fresh, unmoved pallet: its consumption is returned by the same transaction.
 await db.query("delete from public.records where entity='Pallet' and id='second'");assert.equal(await qty(box,depot),700);assert.equal(await qty(wood,depot),9);
 await assert.rejects(command('item',{id:box,version:1,code:'BOX',name:'Caja',unit:'kg',minimum:0}),/unidad/);
 const brandRule=id(),sizeRule=id();
 await command('rule',{...recipe,id:brandRule,name:'Brand variant',match:{product_type:'fresco',package_type:'ambiguous',brand:'Rimonim'}});
 await command('rule',{...recipe,id:sizeRule,name:'Size variant',match:{product_type:'fresco',package_type:'ambiguous',calibre:'7'}});
 await assert.rejects(pallet('ambiguous',10,{package_type:'ambiguous'}),/ambiguas/);
 await command('depot',{id:dest,version:1,name:'Secundario',allow_negative:true});
 await command('movement',{kind:'rotura',depot_id:dest,occurred_on:'2026-10-16',notes:'Merma verificada',lines:[{item_id:box,quantity:100}]});assert.equal(await qty(box,dest),-20,'Negative-stock policy is explicit per depot');
 const balances=(await snapshot()).balances;
 for(const b of balances){const sum=(await db.query('select coalesce(sum(quantity),0)::float total from public.supply_movements where company_id=$1 and item_id=$2 and depot_id=$3',[company,b.item_id,b.depot_id])).rows[0].total;assert.equal(b.quantity,sum,'Ledger must equal every materialized balance');}
 const page=(await db.query('select public.supply_snapshot(null,null,null,null,null,null,null,2) result')).rows[0].result;assert.equal(page.movements.length,2);
 const last=page.movements.at(-1);const next=(await db.query('select public.supply_snapshot($1,$2,null,null,null,null,null,2) result',[last.created_at,last.id])).rows[0].result;assert(!next.movements.some(m=>page.movements.some(p=>p.id===m.id)),'Stable pagination must not duplicate rows');
 await db.exec(`reset role;insert into public.companies(name,slug)values('Stock other','stock-other');insert into public.company_memberships(company_id,user_id,role) select id,'${outsider}','admin' from public.companies where slug='stock-other';`);
 const otherCompany=(await db.query("select id from public.companies where slug='stock-other'")).rows[0].id;
 await actor(outsider,otherCompany);assert.equal((await snapshot()).items.length,0);
 await assert.rejects(command('movement',{...receipt,number:'evil'}),/Depósito inválido/);
 await assert.rejects(command('rule',recipe),/depósito activo/);
 await actor(production,otherCompany);await assert.rejects(snapshot(),/no autorizado/);
 console.log('PASS: stock/remitos idempotentes, consumo por pallet 240→214, versiones de reglas, faltantes atómicos, reversión, traslados, ledger, paginación, roles y empresas');
}catch(e){console.error('Supply stock:',e.message,e.where||'');process.exitCode=1;}finally{await db.close();}
