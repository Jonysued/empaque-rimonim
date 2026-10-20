import assert from 'node:assert/strict';
import { getWeighedLots } from '../src/lib/weighedLots.mjs';
import { projectFieldOperations } from '../src/lib/fieldWorkflow.mjs';

const lots = [
  { id: 'pending', status: 'cerrado_campo', net_weight: 100 },
  ...['pesado', 'recibido', 'parcialmente_volcado', 'volcado'].map((status, index) => ({
    id: status, lot_code: `LOT-${index}`, status, weighed_at: `2026-10-${10 + index}T10:00:00Z`,
    producer: 'Rimonim', transport: 'Camión A', variety: 'Wonderful',
  })),
];
const before = structuredClone(lots);
assert.deepEqual(getWeighedLots(lots).map(lot => lot.id), ['volcado', 'parcialmente_volcado', 'recibido', 'pesado']);
assert.deepEqual(lots, before, 'Sorting must not mutate the operational snapshot');
assert.equal(getWeighedLots(lots, ' lot-1 ')[0].id, 'recibido');
for (const search of ['RIMONIM', 'camión', 'Wonderful']) assert.equal(getWeighedLots(lots, search).length, 4);
assert.equal(getWeighedLots(lots, 'missing').length, 0);
assert.equal(getWeighedLots(Array.from({ length: 250 }, (_, id) => ({ id, weighed_at: '2026-10-20' }))).length, 250, 'History must not have a recent-record limit');

const pending = projectFieldOperations([{ id: 'offline', workflow_version: 3, status: 'cerrado_campo', bins_count: 1 }],
  [{ id: 'bin', receipt_lot_id: 'offline' }], [{ id: 'op', rpc: 'field_lot_operation', status: 'pending',
    createdAt: '2026-10-20T12:00:00Z', params: { p_lot_id: 'offline', p_action: 'weigh', p_gross: 1200, p_tare: 200 } }]);
assert.equal(getWeighedLots(pending.lots)[0].pendingStatus, 'pending');
assert.equal(getWeighedLots(pending.lots)[0].net_weight, 1000);
assert.equal(getWeighedLots([{ ...lots[1], weighed_at: undefined, status: 'cerrado_campo' }]).length, 0, 'Deleted weighings return to pending instead of remaining in history');
console.log('PASS: full weighing history, downstream stages, search, ordering, offline pending status and deleted weighings');
