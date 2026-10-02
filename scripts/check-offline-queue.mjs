// Integration check for the mobile outbox, with an in-memory store and RPC.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const commands = new Map();
const calls = [];
const records = new Map();
let disconnectAfterInsert = false;
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
globalThis.window = { dispatchEvent() {} };
globalThis.Event = class Event { constructor(type) { this.type = type; } };
const owner = 'operator-1';
const supabase = {
  auth: { getSession: async () => {
    if (!navigator.onLine) throw new Error('No se debe renovar la sesión sin conexión');
    return { data: { session: { user: { id: owner } } }, error: null };
  } },
  rpc: async (rpc, params) => { calls.push({ rpc, params }); return { error: null }; },
  from: table => {
    assert.equal(table, 'records');
    return {
      insert: async row => {
        const key = `${row.entity}:${row.id}`;
        if (records.has(key)) return { error: { code: '23505', message: 'duplicate key' } };
        records.set(key, row);
        if (disconnectAfterInsert) {
          disconnectAfterInsert = false;
          throw new TypeError('Failed to fetch');
        }
        return { error: null };
      },
      select: () => ({
        eq: (_column, entity) => ({
          eq: (_idColumn, id) => ({
            single: async () => ({ data: records.get(`${entity}:${id}`), error: null }),
          }),
        }),
      }),
    };
  },
};
const listCommands = async user => [...commands.values()].filter(c => c.ownerId === user).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
const saveCommand = async command => commands.set(command.id, command);
const enqueueCommand = async command => {
  if ([...commands.values()].some(c => c.ownerId === command.ownerId && c.resourceKey === command.resourceKey)) throw new Error('Operación pendiente');
  commands.set(command.id, command);
};
const removeCommand = async id => commands.delete(id);
const readLastOwner = async () => owner;
const Capacitor = { isNativePlatform: () => true };
const source = (await readFile('src/lib/operationQueue.js', 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replace(/^export /gm, '');
const queue = new Function('supabase', 'Capacitor', 'readLastOwner', 'listCommands', 'saveCommand', 'enqueueCommand', 'removeCommand', `${source}\nreturn { submitOperation, syncOperations };`)(supabase, Capacitor, readLastOwner, listCommands, saveCommand, enqueueCommand, removeCommand);
const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const params = { p_lot_id: 'lot-1', p_bins: 2, p_dump_code: 'VOL-1' };
assert.deepEqual(await queue.submitOperation('dump_lot_by_bins', params, 'lot:lot-1', id), { operation_id: id, pending: true });
assert.equal(commands.size, 1);
assert.equal(calls.length, 0);
await assert.rejects(queue.submitOperation('dump_lot_by_bins', params, 'lot:lot-1'), /pendiente/);
globalThis.navigator.onLine = true;
await queue.syncOperations();
assert.equal(calls.length, 1);
assert.equal(calls[0].params.p_operation_id, id);
assert.equal(commands.size, 0);
await queue.syncOperations();
assert.equal(calls.length, 1);
const lotId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const lot = { lot_code: 'LOT-1', bins_count: 48, net_weight: 30000 };
globalThis.navigator.onLine = false;
assert.deepEqual(await queue.submitOperation('create_receipt_lot', { p_record: lot }, `receipt:${lotId}`, lotId), { operation_id: lotId, pending: true });
assert.equal(records.size, 0);
globalThis.navigator.onLine = true;
disconnectAfterInsert = true;
await queue.syncOperations();
assert.equal(commands.size, 1, 'An uncertain commit must remain pending');
assert.equal(records.size, 1, 'The server already committed this lot');
const firstRecord = records.get(`ReceiptLot:${lotId}`);
assert.equal(firstRecord.data.operation_id, lotId);
await queue.syncOperations();
assert.equal(commands.size, 0, 'A duplicate from the same operation is confirmed');
assert.equal(records.size, 1, 'Retry must not create another lot');
assert.equal(records.get(`ReceiptLot:${lotId}`), firstRecord, 'Retry must not overwrite later changes');
console.log('Offline → pendiente → sincronizado una vez; alta de lote con reintento idempotente: OK');
