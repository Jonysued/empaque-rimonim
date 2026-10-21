import assert from 'node:assert/strict';
import {allocateFifoOrigins,applyFifoOrigins} from '../src/lib/fifoTraceability.mjs';
import {lotTrace,palletTrace} from '../src/lib/traceability.mjs';
const rates=[{id:'r',effective_date:'2026-10-01',discard_percent:20,created_at:'2026-10-01T00:00:00Z'}];
const lot=(id,producer='A',variety='Wonderful')=>({id,lot_code:'LOT-'+id,producer,variety});
const dump=(id,receipt_lot_id,net_weight,dump_date)=>({id,receipt_lot_id,net_weight,dump_date});
const pallet=(id,net_weight,created_date,extra={})=>({id,producer:'A',variety:'Wonderful',net_weight,created_date,...extra});
const input={rates,lots:[lot('a'),lot('b'),lot('foreign-producer','B'),lot('foreign-variety','A','Acco')],
 dumps:[dump('d1','a',1000,'2026-10-20T10:00:00Z'),dump('d2','b',1000,'2026-10-20T11:00:00Z'),
 dump('d3','foreign-producer',10000,'2026-10-20T09:00:00Z'),dump('d4','foreign-variety',10000,'2026-10-20T09:00:00Z')],
 pallets:[pallet('p1',600,'2026-10-20T12:00:00Z',{product_type:'fresco'}),pallet('p2',500,'2026-10-20T13:00:00Z',{product_type:'arilos'}),pallet('p3',600,'2026-10-20T14:00:00Z')]};
const result=allocateFifoOrigins(input);
const original=JSON.stringify(input);allocateFifoOrigins(input);assert.equal(JSON.stringify(input),original,'Recalculating never mutates source records');
assert.deepEqual(result.p1.origin_lots,['a']);assert.equal(result.p1.assigned_kg,600);
assert.deepEqual(result.p2.allocations.map(a=>[a.lot_id,a.net_kg]),[['a',200],['b',300]]);
assert.equal(result.p3.assigned_kg,500);assert.equal(result.p3.shortage_kg,100);
assert.equal(Object.values(result).reduce((sum,r)=>sum+r.assigned_kg,0),1600,'Fresh and aril outputs share the same 1600 kg');
assert.equal(result.p1.allocations[0].raw_kg,750);
assert.equal(result.p1.status,'balanced_estimate');
assert.deepEqual(allocateFifoOrigins({...input,dumps:[...input.dumps,input.dumps[0]]}),result,'Duplicate event ID never adds capacity');
assert.deepEqual(allocateFifoOrigins({...input,dumps:[...input.dumps].reverse(),pallets:[...input.pallets].reverse()}),result,'Arrival order cannot change event-time allocation');
const offline={...input,dumps:[],pallets:[input.pallets[0]]};
assert.equal(allocateFifoOrigins(offline).p1.shortage_kg,600);
assert.equal(allocateFifoOrigins({...offline,dumps:[input.dumps[0]]}).p1.status,'balanced_estimate','Late synchronization reconciles an earlier real dump');
assert.equal(allocateFifoOrigins({...offline,dumps:[dump('future','a',1000,'2026-10-20T15:00:00Z')]}).p1.assigned_kg,0,'A physically later dump cannot fund an earlier pallet');
assert.equal(allocateFifoOrigins({...input,rates:[]}).p1.status,'pending_discard','Do not invent a discard percentage');
assert.equal(allocateFifoOrigins({...input,rates:[{...rates[0],discard_percent:100}]}).p1.assigned_kg,0);
assert.equal(allocateFifoOrigins({...input,rates:[{...rates[0],discard_percent:0}]}).p3.shortage_kg,0);
assert.equal(allocateFifoOrigins({...input,rates:[...rates,{...rates[0],id:'new',discard_percent:50,created_at:'2026-10-21T00:00:00Z'}]}).p2.shortage_kg,100,'Adjustments replay from effective day using latest revision');
assert.equal(allocateFifoOrigins({...input,pallets:[pallet('missing',1,'2026-10-20T12:00:00Z',{producer:''})]}).missing.status,'pending_data');
assert.equal(allocateFifoOrigins({...input,pallets:[{...input.pallets[0],pendingStatus:'pending'}]}).p1.status,'pending_sync');
assert.equal(applyFifoOrigins(input.pallets,result,true)[0].trace_balance.status,'pending_offline');
assert.equal(allocateFifoOrigins({...input,pallets:[{...input.pallets[0],pendingStatus:'conflict'},input.pallets[1]]}).p2.status,'pending_sync','Local pending work must not make a later balance look reconciled');
const decimal=allocateFifoOrigins({rates:[{...rates[0],discard_percent:33.33}],lots:[lot('a')],dumps:[dump('d','a',1,'2026-10-20T10:00:00Z')],pallets:[pallet('x',.333,'2026-10-20T11:00:00Z'),pallet('y',.333,'2026-10-20T12:00:00Z')]});
assert.equal(decimal.x.assigned_kg+decimal.y.assigned_kg,.666);
assert.equal(decimal.x.allocations[0].raw_kg+decimal.y.allocations[0].raw_kg,1,'Rounding cannot consume raw fruit twice');
const trace={...input,bins:[],runs:[],pallets:applyFifoOrigins(input.pallets,result),shipments:[{id:'s',loaded_pallet_ids:['p2']} ]};
assert.deepEqual(palletTrace(trace,trace.pallets[1]).lots.map(l=>l.id),['a','b']);
assert.deepEqual(lotTrace(trace,trace.lots[0]).pallets.map(p=>p.id),['p1','p2']);
assert.equal(lotTrace(trace,trace.lots[1]).shipments[0].id,'s');
// San Juan's date, not UTC: 01:00Z is still the previous production day.
assert.equal(allocateFifoOrigins({rates:[{...rates[0],effective_date:'2026-10-20'}],lots:[lot('a')],dumps:[dump('night','a',1000,'2026-10-20T01:00:00Z')],pallets:[input.pallets[0]]}).p1.status,'pending_discard');
console.log('PASS: automatic FIFO, shared fresh/aril balance, discard revisions, late sync, producer/variety isolation, event chronology, grams, unknown settings, offline status and lot→pallet→shipment');
