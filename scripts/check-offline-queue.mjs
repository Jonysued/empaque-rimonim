// Integration check for the mobile outbox, with an in-memory store and RPC.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const commands = new Map();
const calls = [];
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
};
const listCommands = async user => [...commands.values()].filter(c => c.ownerId === user).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
const saveCommand = async command => commands.set(command.id, command);
const removeCommand = async id => commands.delete(id);
const readLastOwner = async () => owner;
const Capacitor = { isNativePlatform: () => true };
const source = (await readFile('src/lib/operationQueue.js', 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replace(/^export /gm, '');
const queue = new Function('supabase', 'Capacitor', 'readLastOwner', 'listCommands', 'saveCommand', 'removeCommand', `${source}\nreturn { submitOperation, syncOperations };`)(supabase, Capacitor, readLastOwner, listCommands, saveCommand, removeCommand);
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
console.log('Offline → pendiente → sincronizado una vez: OK');
