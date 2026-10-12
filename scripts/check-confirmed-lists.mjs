import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectRecordOperations } from '../src/lib/recordProjection.mjs';
const source=await readFile('src/api/base44Client.js','utf8');
const body=source.slice(source.indexOf('const entityClient ='),source.indexOf('const profile ='));
const confirmed=[{id:'existing',created_date:'2026-10-01T12:00:00Z',data:{net_weight:500,status:'armado'}}];
const operations=[{rpc:'offline_record_operation',status:'pending',params:{p_entity:'Pallet',p_id:'existing',p_action:'patch',p_payload:{net_weight:900}}},{rpc:'offline_record_operation',status:'pending',createdAt:'2026-10-12T12:00:00Z',params:{p_entity:'Pallet',p_id:'new',p_action:'create',p_payload:{net_weight:700,status:'armado'}}}];
const client=new Function('rows','getOperations','projectRecordOperations','flatten','requireConfigured',`${body};return entityClient('Pallet');`)(async()=>confirmed,async()=>operations,projectRecordOperations,row=>({...row.data,id:row.id,created_date:row.created_date}),()=>{});
const local=await client.list();assert.equal(local.length,2);assert.equal(local.find(p=>p.id==='existing').net_weight,900);
const server=await client.listConfirmed();assert.equal(server.length,1);assert.equal(server[0].net_weight,500);assert.equal(server[0].pendingStatus,undefined);
assert.equal(confirmed[0].data.net_weight,500);
console.log('PASS: el dashboard conserva la versión confirmada de un pallet editado offline y excluye altas locales; operación local conserva la proyección');

const palletRows = [
  { id: 'p1', data: { net_weight: 800, package_count: 240, shipment_id: 's1' } },
  { id: 'p2', data: { net_weight: 700, package_count: 214 } },
];
const shipmentRows = [{ id: 's1', data: { loaded_pallet_ids: ['p1'], status: 'cargado', total_weight: 800, total_packages: 240 } }];
const load = { rpc: 'load_pallet_into_shipment', status: 'pending', params: { p_shipment_id: 's1', p_pallet_id: 'p2' } };
const unload = { rpc: 'unload_pallet_from_shipment', status: 'pending', params: { p_shipment_id: 's1', p_pallet_id: 'p1' } };
const edit = { rpc: 'offline_record_operation', status: 'pending', params: { p_entity: 'Pallet', p_id: 'p1', p_action: 'patch', p_payload: { net_weight: 850, package_count: 214 } } };
const project = commands => projectRecordOperations('Shipment', shipmentRows, commands, palletRows)[0].data;
assert.equal(project([load]).total_weight, 1500);
assert.equal(project([load]).total_packages, 454);
assert.equal(project([load, load]).total_weight, 1500, 'Replaying a load never counts a pallet twice');
assert.equal(project([load, unload]).total_weight, 700);
assert.equal(project([load, unload]).total_packages, 214);
assert.equal(project([unload]).total_weight, 0);
assert.equal(project([unload]).total_packages, 0);
assert.equal(project([edit]).total_weight, 850);
assert.equal(project([edit]).total_packages, 214);
assert.equal(project([edit]).pendingStatus, 'pending', 'A loaded pallet edit marks shipment totals as local');
assert.equal(project([edit, load]).total_weight, 1550);
assert.equal(project([{ ...edit, status: 'conflict' }, load]).pendingStatus, 'conflict');
assert.equal(project([{ ...edit, status: 'conflict' }, load]).total_weight, 1500, 'Rejected edits do not alter the weight');
const missing = project([{ ...load, params: { p_shipment_id: 's1', p_pallet_id: 'missing' } }]);
assert.equal(missing.pendingTotalsUnavailable, true, 'Missing pallet data must never produce a partial total');
assert.equal(project([]).total_weight, 800);
assert.equal(shipmentRows[0].data.total_weight, 800);
assert.equal(palletRows[0].data.net_weight, 800);
const createShipment = { rpc: 'offline_record_operation', status: 'pending', params: { p_entity: 'Shipment', p_id: 'new-s', p_action: 'create', p_payload: { loaded_pallet_ids: [], total_weight: 0, total_packages: 0 } } };
const createPallet = { rpc: 'offline_record_operation', status: 'pending', params: { p_entity: 'Pallet', p_id: 'new-p', p_action: 'create', p_payload: { net_weight: 600, package_count: 240 } } };
const newLoad = { ...load, params: { p_shipment_id: 'new-s', p_pallet_id: 'new-p' } };
const departure = { rpc: 'offline_record_operation', status: 'pending', params: { p_entity: 'Shipment', p_id: 'new-s', p_action: 'dispatch', p_payload: {} } };
const newLocal = projectRecordOperations('Shipment', [], [createShipment, createPallet, newLoad, departure], [])[0].data;
assert.equal(newLocal.total_weight, 600);
assert.equal(newLocal.total_packages, 240);
assert.equal(newLocal.pendingDeparture, true);

let queued = [load, edit];
const shipClient = new Function('rows','getOperations','projectRecordOperations','flatten','requireConfigured',`${body};return entityClient('Shipment');`)(
  async entity => entity === 'Shipment' ? shipmentRows : palletRows,
  async () => queued, projectRecordOperations, row => ({...row.data,id:row.id}), () => {},
);
assert.equal((await shipClient.list())[0].total_weight, 1550);
assert.equal((await shipClient.get('s1')).total_packages, 428);
assert.equal((await shipClient.listConfirmed())[0].total_weight, 800);
assert.equal((await shipClient.listConfirmed())[0].pendingStatus, undefined);
queued = [];
assert.equal((await shipClient.list())[0].total_weight, 800, 'Once the queue is empty, only confirmed totals remain');
const syncedRows = [{ id: 's1', data: { ...shipmentRows[0].data, loaded_pallet_ids: ['p1', 'p2'], total_weight: 1550, total_packages: 428 } }];
assert.equal(projectRecordOperations('Shipment', syncedRows, [], palletRows)[0].data.total_weight, 1550, 'Reconnection preserves the server total without adding local changes twice');
console.log('PASS: totales locales de carga/retiro/edición; reintentos sin duplicar; conflictos y datos faltantes; dashboard confirmado independiente');
