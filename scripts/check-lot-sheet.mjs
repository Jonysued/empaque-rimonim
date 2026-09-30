import assert from 'node:assert/strict';
import { lotSheetHtml } from '../src/lib/lotSheet.js';
const lot={lot_code:'LOT-TEST',status:'pesado',producer:'LAS 500',variety:'Wonderful',origin:'OP1NE',transport:'Camión & campo',
  bins_count:53,gross_weight:12000,tare_weight:2000,net_weight:10000,remaining_weight:10000,dumped_weight:0,bins_dumped:0,
  quality_notes:'Sin defectos\n<script>alert(1)</script>',harvest_date:'2026-09-30',weighed_at:'2026-09-30T18:00:00Z'};
const bins=Array.from({length:53},(_,i)=>({bin_code:`BIN-${String(i).padStart(3,'0')}`,producer:'GLONET',origin:'CUADRO 1',
  crew:'MIXTO',crew_breakdown:[{crew:'A'},{crew:'B'}],quality_notes:i===52?'<script>alert(1)</script>':'Revisado',net_weight:10000/53}));
const html=lotSheetHtml(lot,bins);
assert.match(html,/size: A4 portrait/);
assert.match(html,/BIN-052/);
assert.equal((html.match(/<tr><td>/g)||[]).length,53);
assert.ok(html.includes('Camión &amp; campo'));
assert.ok(html.includes('&lt;script&gt;'));
assert.ok(!html.includes('<script>'));
assert.ok(!html.includes('Registro del BIN:'));
assert.ok(html.includes('sheet-bin-columns'));
assert.ok(html.includes('Información individual de cosecha'));
assert.match(html,/BINs volcados<\/span><b>0<\/b>/);
assert.ok(html.includes('Peso bruto') && html.includes('Tara') && html.includes('Peso neto'));
assert.ok(html.includes('table-header-group'));
assert.ok(lotSheetHtml({...lot,net_weight:null,pendingStatus:'pending'},[]).includes('pendientes de sincronizar'));
assert.ok(lotSheetHtml({...lot,net_weight:null},[]).includes('Sin pesar'));
console.log('PASS: ficha A4 completa, todos los BINs, pesos, cuadrillas, datos pendientes y escape de contenido');
