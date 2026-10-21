import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {allocateFifoOrigins,applyFifoOrigins} from '../src/lib/fifoTraceability.mjs';
const source=(await readFile('src/lib/productionBalance.js','utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
let company='a',isOffline=false,failNetwork=false,cache=new Map(),inserts=0;
const p={id:'p',created_date:'2026-10-20T12:00:00Z',producer:'A',variety:'V',net_weight:800};
const snapshot={as_of:'2026-10-20T13:00:00Z',pallets:[p],lots:[{id:'l',producer:'A',variety:'V',lot_code:'L'}],
 dumps:[{id:'d',receipt_lot_id:'l',net_weight:1000,dump_date:'2026-10-20T10:00:00Z'}],
 rates:[{id:'r',effective_date:'2026-10-01',discard_percent:20,created_at:'2026-10-01T00:00:00Z'}]};
const supabase={rpc:async()=>{if(failNetwork)throw new TypeError('Failed to fetch');return {data:snapshot,error:null};},from:()=>({insert:async()=>{inserts++;return {error:null};}})};
const client=new Function('supabase','localSessionIdentity','workspaceOwner','readSnapshot','saveSnapshot','allocateFifoOrigins','applyFifoOrigins',source+';return {productionBalance,saveDiscardRate};')(
 supabase,async()=>({id:'u',offline:isOffline}),id=>id+'::'+company,async(owner,key)=>cache.get(owner+key),async(owner,key,value)=>cache.set(owner+key,value),allocateFifoOrigins,applyFifoOrigins);
assert.equal((await client.productionBalance([p])).pallets[0].trace_balance.status,'balanced_estimate');
isOffline=true;assert.equal((await client.productionBalance([p])).pallets[0].trace_balance.status,'pending_offline');
company='b';const missing=await client.productionBalance([p]);assert.equal(missing.missing,true);assert.equal(missing.pallets[0].trace_balance,undefined,'No cache from another company');
company='a';isOffline=false;failNetwork=true;assert.equal((await client.productionBalance([p])).offline,true);failNetwork=false;
// A stale list fetched before the RPC must not replace its newer weights.
assert.equal((await client.productionBalance([{...p,net_weight:200}])).pallets[0].net_weight,800);
assert.equal((await client.productionBalance([{...p,net_weight:900,pendingStatus:'pending'}])).pallets[0].trace_balance.shortage_kg,100);
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
await assert.rejects(client.saveDiscardRate('2026-10-20',NaN),/entre 0 y 100/);
await assert.rejects(client.saveDiscardRate('2026-10-20',101),/entre 0 y 100/);
await client.saveDiscardRate('2026-10-20',0);assert.equal(inserts,1);
navigator.onLine=false;await assert.rejects(client.saveDiscardRate('2026-10-20',20),/palletizado puede continuar/);
console.log('PASS: confirmed snapshot, stale-read protection, offline provisional balance, no-cache continuation, tenant cache isolation, pending previews and discard validation');
