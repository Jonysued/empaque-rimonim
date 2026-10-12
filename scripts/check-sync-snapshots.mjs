import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectRecordOperations } from '../src/lib/recordProjection.mjs';

Object.defineProperty(globalThis, 'navigator', {value: {onLine: true}, configurable: true});
globalThis.window = {dispatchEvent() {}};
const source = (await readFile('src/lib/operationQueue.js', 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const commands = new Map(), snapshots = new Map(), receipts = new Map();
const pallet = {id: 'p1', data: {shipment_id: 's1', net_weight: 800, package_count: 240, status: 'cargado'}};
const shipment = {id: 's1', data: {loaded_pallet_ids: ['p1'], total_weight: 800, total_packages: 240, status: 'cargado'}};
snapshots.set('Pallet', [structuredClone(pallet)]); snapshots.set('Shipment', [structuredClone(shipment)]);
let failRelatedRead = true, mutations = 0;
const supabase = {
  rpc: async (_rpc, params) => {
    if (!receipts.has(params.p_operation_id)) {
      mutations++;
      if (params.p_entity === 'Pallet') {
        Object.assign(pallet.data, params.p_payload);
        shipment.data.total_weight = pallet.data.net_weight;
        shipment.data.total_packages = pallet.data.package_count;
      } else {
        shipment.data.status = 'enviado'; pallet.data.status = 'enviado';
      }
      receipts.set(params.p_operation_id, structuredClone({record: params.p_entity === 'Pallet' ? pallet : shipment}));
    }
    return {data: receipts.get(params.p_operation_id)};
  },
  from: () => ({select: () => ({eq: (_field, entity) => ({eq: () => ({single: async () => {
    if (failRelatedRead) throw new TypeError('Failed to fetch');
    return {data: structuredClone(entity === 'Pallet' ? pallet : shipment)};
  }})})})}),
};
const args = [supabase, {isNativePlatform: () => true}, async () => 'u', async () => [...commands.values()], async c => commands.set(c.id,c), async c => commands.set(c.id,c), async id => commands.delete(id), x => x, async () => ({id:'u',offline:false}), async (_owner,entity) => snapshots.get(entity), async (_owner,entity,rows) => snapshots.set(entity,rows)];
const makeQueue = () => new Function('supabase','Capacitor','readLastOwner','listCommands','saveCommand','enqueueCommand','removeCommand','workspaceOwner','localSessionIdentity','readSnapshot','saveSnapshot', source + '\nreturn {submitOperation,syncOperations};')(...args);
let queue = makeQueue();
const edit = await queue.submitOperation('offline_record_operation', {p_entity:'Pallet',p_id:'p1',p_action:'patch',p_payload:{net_weight:850,package_count:214}}, 'p1');
assert.equal(edit.pending, true, 'Keep UUID until related shipment is stored');
const projected = projectRecordOperations('Shipment', snapshots.get('Shipment'), [...commands.values()], snapshots.get('Pallet'))[0].data;
assert.equal(projected.total_weight,850); assert.equal(projected.total_packages,214); assert.equal(projected.pendingStatus,'pending');
queue = makeQueue(); // Restart after RPC success, before the dependent snapshot was saved.
failRelatedRead = false;
await queue.syncOperations();
assert.equal(commands.size,0); assert.equal(mutations,1);
assert.equal(snapshots.get('Shipment')[0].data.total_weight,850);
assert.equal(snapshots.get('Shipment')[0].data.total_packages,214);
failRelatedRead = true;
const dispatch = await queue.submitOperation('offline_record_operation', {p_entity:'Shipment',p_id:'s1',p_action:'dispatch',p_payload:{}}, 's1');
assert.equal(dispatch.pending,true);
failRelatedRead = false; await makeQueue().syncOperations();
assert.equal(commands.size,0); assert.equal(mutations,2);
assert.equal(snapshots.get('Pallet')[0].data.status,'enviado');
assert.equal(snapshots.get('Shipment')[0].data.status,'enviado');
console.log('PASS: corte después del commit; reinicio y reintento sin duplicar; total relacionado y pallets enviados guardados antes de vaciar la cola');
