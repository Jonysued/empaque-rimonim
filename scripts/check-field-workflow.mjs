import assert from 'node:assert/strict';
import { projectFieldOperations, canDumpLot } from '../src/lib/fieldWorkflow.mjs';
const op = (id, action, params = {}, status = 'pending') => ({ id, rpc: 'field_lot_operation', status,
  createdAt: `2026-09-30T12:00:0${id}Z`, params: { p_lot_id: 'lot', p_action: action, ...params } });
const operations = [op('1','create',{p_record:{lot_code:'LOT-TEST',expected_bins_count:2}}),
  op('2','add_bin',{p_bin_code:'bin-a'}), op('3','add_bin',{p_bin_code:'bin-b'}), op('4','close'),
  op('5','weigh',{p_gross:43000,p_tare:13000}), op('6','receive')];
let state = projectFieldOperations([], [], operations.slice(0,3));
assert.equal(state.lots[0].bins_count,2);
assert.equal(state.lots[0].net_weight,undefined);
assert.equal(canDumpLot(state.lots[0]),false);
state = projectFieldOperations([], [], operations.slice(0,5));
assert.equal(state.lots[0].net_weight,30000);
assert.deepEqual(state.bins.map(bin=>bin.net_weight),[15000,15000]);
assert.equal(canDumpLot(state.lots[0]),false);
state = projectFieldOperations([], [], operations);
assert.equal(canDumpLot(state.lots[0]),true);
assert.equal(state.lots[0].pendingStatus,'pending');
// An earlier rejected command blocks later local transitions instead of making them look successful.
state = projectFieldOperations([], [], [operations[0],{...operations[1],status:'conflict'},...operations.slice(2)]);
assert.equal(state.lots[0].status,'en_campo');
assert.equal(state.lots[0].pendingStatus,'conflict');
assert.equal(canDumpLot(state.lots[0]),false);
// A response lost after server commit must not count the same scan a second time.
state = projectFieldOperations([{id:'lot',workflow_version:2,status:'en_campo',bins_count:1,field_operations:[{id:'2'}]}],
  [{id:'2',receipt_lot_id:'lot',bin_code:'BIN-A'}],[operations[1]]);
assert.equal(state.bins.length,1);
assert.equal(state.lots[0].bins_count,1);
assert.equal(canDumpLot({status:'recibido',net_weight:1000}),true,'Legacy lots retain their workflow');
console.log('PASS: proyección offline ordenada, prorrateo, conflictos, reintentos y compatibilidad anterior');
