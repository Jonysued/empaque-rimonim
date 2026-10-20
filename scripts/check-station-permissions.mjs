import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {STATIONS,canAccess,canSubmitCommand,offlineEntities} from '../src/lib/permissions.js';

for(const [role,station] of Object.entries(STATIONS)) {
  for(const path of ['/',...Object.values(STATIONS).map(s=>s.path),'/trazabilidad','/catalogos','/usuarios','/empresas'])
    assert.equal(canAccess(role,path),path===station.path,`${role}: ${path}`);
  assert.deepEqual(offlineEntities(role),station.entities);
  assert.equal(canSubmitCommand(role,'reopen_shipment_for_correction'),false);
  assert.equal(canSubmitCommand(role,'offline_record_operation',{p_entity:'Pallet',p_action:'patch'}),false);
  assert.equal(canSubmitCommand(role,'field_lot_operation',{p_action:'remove_bin'}),false);
}
const db=new PGlite(),admin='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',operator='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const id=()=>crypto.randomUUID();
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);`);
  for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
  await db.exec(`insert into auth.users values('${admin}','admin@example.test','{}'),('${operator}','operator@example.test','{}');
    update public.profiles set role='admin' where id='${admin}';
    grant usage on schema auth to authenticated;grant select on public.profiles to authenticated;
    grant select,insert,update,delete on public.records to authenticated;`);
  const actor=async(role)=>{
    await db.exec('reset role');
    if(role!=='admin')await db.query('update public.profiles set role=$1 where id=$2',[role,operator]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.headers','{}',false)",[role==='admin'?admin:operator]);
    await db.exec('set role authenticated');
  };
  const rpc=async(name,params)=>{
    const args=params.map((_,i)=>'$'+(i+1)).join(',');
    if(name==='station_records')return (await db.query(`select * from public.station_records(${args})`,params)).rows;
    return (await db.query(`select public.${name}(${args}) result`,params)).rows[0].result;
  };
  const field=(action,record={})=>rpc('field_lot_operation',[id(),'lot',action,record]);
  const cold=(action,payload)=>rpc('cold_storage_command',[id(),action,payload]);
  const record=async(entity,key,data)=>db.query('insert into public.records(entity,id,data) values($1,$2,$3)',[entity,key,data]);
  const get=async(entity,key)=>(await db.query('select data from public.station_records($1,0,1,$2)',[entity,key])).rows[0]?.data;
  const offline=(entity,key,action,payload)=>rpc('offline_record_operation',[id(),entity,key,action,payload,action==='create'?null:{}]);
  const supply=(action,payload)=>rpc('supply_command',[id(),action,payload]);

  await actor('admin');
  await record('Catalog','producer',{type:'productor',label:'A'});
  await record('Catalog','transport',{type:'transportista',label:'Camión'});
  await record('Location','tunnel',{type:'tunel',capacity:18,active:true});
  await record('Location','room',{type:'camara',capacity:101,active:true});
  await cold('distribucion',{location_id:'tunnel',layout:'tunel_18'});
  await cold('distribucion',{location_id:'room',layout:'camara_flexible'});
  const forbidden=[
    ['field_lot_operation',[id(),'lot','remove_bin',{},'BIN-A']],
    ['offline_record_operation',[id(),'Pallet','p','patch',{},{}]],
    ['reopen_shipment_for_correction',[id(),'shipment']],
    ['unload_pallet_from_shipment',[id(),'shipment','p']],
    ['cold_storage_command',[id(),'posicion',{location_id:'tunnel',pallet_id:'p',position:2}]],
    ['cold_storage_command',[id(),'distribucion',{location_id:'room',layout:'camara_flexible'}]],
    ['supply_command',[id(),'item',{code:'X',name:'X',unit:'un'}]],
    ['supply_command',[id(),'movement',{kind:'ajuste'}]],
  ];
  for(const role of Object.keys(STATIONS)) {
    await actor(role);
    assert.equal((await db.query('select count(*)::int n from public.records')).rows[0].n,0,'Operators cannot read unprojected shared records');
    for(const entity of ['Bin','ReceiptLot','Catalog','Location','Pallet','Shipment','CoolingCycle','StorageBatch']){
      const rows=await rpc('station_records',[entity]);
      if(!STATIONS[role].entities.includes(entity))assert.equal(rows.length,0,`${role}: ${entity}`);
    }
    await assert.rejects(record('Pallet','forged',{net_weight:1,status:'armado'}),/row-level security|permiso/);
    assert.equal((await db.query("update public.records set data='{}' where id='producer' returning id")).rows.length,0);
    assert.equal((await db.query("delete from public.records returning id")).rows.length,0);
    for(const [name,params] of forbidden)await assert.rejects(rpc(name,params),/permiso/,`${role}: ${name}`);
    await assert.rejects(db.query('select empaque_private.station_impl_harvest_bin_operation($1,$2,$3)',[id(),'forged',{}]),/permission denied/);
    if(role!=='insumos')await assert.rejects(rpc('supply_snapshot',[]),/no autorizado/);
  }

  // Real station-to-station flow; each actor has only their station membership.
  await actor('cosecha');const harvestOp=id();
  const harvest={bin_code:'BIN-A',producer:'A',variety:'Wonderful',harvest_date:'2026-10-20',origin:'OP1'};
  await rpc('harvest_bin_operation',[harvestOp,'bin',harvest]);
  await rpc('harvest_bin_operation',[harvestOp,'bin',harvest]);
  assert.equal((await rpc('station_records',['Bin'])).length,1);
  await assert.rejects(field('create',{workflow_version:3,lot_code:'LOT-A',transport:'Camión'}),/permiso/);
  await actor('consolidado');await field('create',{workflow_version:3,lot_code:'LOT-A',transport:'Camión'});
  await rpc('field_lot_operation',[id(),'lot','add_bin',{},'BIN-A']);await field('close');
  await assert.rejects(rpc('field_lot_operation',[id(),'lot','weigh',{},null,1000,100]),/permiso/);
  await actor('pesado');await rpc('field_lot_operation',[id(),'lot','weigh',{},null,1000,100]);
  assert.equal((await get('ReceiptLot','lot')).net_weight,900);
  await assert.rejects(rpc('field_lot_operation',[id(),'lot','weigh',{},null,2000,100]),/cerrado|pesar/);
  await actor('playa');await field('receive');
  await actor('vuelco');await rpc('dump_bin_by_qr',[id(),'bin','lot','BIN-A','VOL-A']);
  assert.equal((await get('ReceiptLot','lot')).remaining_weight,0);
  await actor('consolidado');const limitedLot=await get('ReceiptLot','lot');
  assert.equal(limitedLot.net_weight,undefined);assert.equal(limitedLot.yard_received_at,undefined);
  assert.ok(limitedLot.field_operations.every(op=>['create','add_bin','close'].includes(op.action)));
  await actor('produccion');await offline('Pallet','p','create',{pallet_code:'PAL-A',net_weight:900,status:'armado',product_type:'fresco',package_count:240});
  await assert.rejects(offline('Pallet','p','patch',{net_weight:1000}),/permiso/);
  await actor('prefrio');await cold('ingresar',{location_id:'tunnel',pallet_id:'p'});
  const cycle=(await rpc('cooling_cycle_command',[id(),'iniciar','tunnel',null])).operation_id;
  await rpc('cooling_cycle_command',[id(),'finalizar','tunnel',cycle]);
  assert.equal((await get('Pallet','p')).status,'prefrio_finalizado');
  await assert.rejects(cold('ingresar',{location_id:'room',pallet_id:'p',section:1}),/permiso/);
  await actor('camaras');await cold('ingresar',{location_id:'room',pallet_id:'p',section:1});
  await cold('retirar',{location_id:'room',pallet_id:'p'});
  await actor('despacho');await offline('Shipment','shipment','create',{load_number:'1',shipment_code:'DSP-A',status:'borrador',product_type:'fresco',target_capacity:1,loaded_pallet_ids:[],reserved_pallet_ids:[]});
  await rpc('load_pallet_into_shipment',[id(),'shipment','p']);
  await offline('Shipment','shipment','dispatch',{});
  assert.equal((await get('Shipment','shipment')).status,'enviado');
  await assert.rejects(offline('Shipment','shipment','patch',{client:'changed'}),/permiso/);

  await actor('admin');const item=id(),depot=id();
  await supply('item',{id:item,code:'BOX',name:'Caja',unit:'un'});
  await supply('depot',{id:depot,name:'Principal'});
  await actor('insumos');await supply('movement',{kind:'ingreso',depot_id:depot,number:'REMITO-1',supplier:'Proveedor',occurred_on:'2026-10-20',lines:[{item_id:item,quantity:100}]});
  assert.equal((await rpc('supply_snapshot',[])).balances[0].quantity,100);

  // A forged company header cannot widen read or command permissions.
  await db.exec('reset role');
  await db.exec("insert into public.companies(name,slug) values('Other','other')");
  const other=(await db.query("select id from public.companies where slug='other'")).rows[0].id;
  await actor('cosecha');await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-empaco-company':other})]);
  assert.equal((await db.query('select count(*)::int n from public.records')).rows[0].n,0);
  await assert.rejects(rpc('harvest_bin_operation',[id(),'foreign',harvest]),/autorizada/);
  await db.exec('reset role');
  const executor=(await db.query("select rolcanlogin,rolbypassrls,rolsuper from pg_roles where rolname='empaco_station_executor'")).rows[0];
  assert.deepEqual(executor,{rolcanlogin:false,rolbypassrls:false,rolsuper:false});
  assert.equal((await db.query("select pg_has_role('authenticated','empaco_station_executor','MEMBER') member")).rows[0].member,false);
  console.log('PASS: 10 station roles isolated, append-only RPCs, no direct writes/private bypass, complete harvest→dispatch flow, supply receipt and tenant isolation');
} catch(error){console.error('Station permissions:',error.message,error.actual?.message||'',error.query||'');process.exitCode=1;}
finally{await db.close();}
