import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { subscribeOperationalRefresh } from '../src/lib/operationalRefresh.mjs';
mock.timers.enable({apis:['setTimeout','setInterval']});
const flush = async () => { for (let i=0;i<5;i++) await Promise.resolve(); };
const win = new EventTarget(), doc = new EventTarget();
doc.visibilityState = 'visible';
let calls=0, active=0, peak=0, release;
const stop = subscribeOperationalRefresh(async () => {
  calls++; active++; peak=Math.max(peak,active);
  await new Promise(resolve=>{release=resolve;}); active--;
}, {windowTarget:win,documentTarget:doc,intervalMs:15000});
assert.equal(calls,1);
for(let i=0;i<100;i++) win.dispatchEvent(new Event('rimonim-queue-change'));
mock.timers.tick(200); assert.equal(calls,1);
release(); await flush(); mock.timers.tick(150); assert.equal(calls,2);
assert.equal(peak,1,'No overlapping automatic requests');
release(); await flush();
doc.visibilityState='hidden'; mock.timers.tick(60000); assert.equal(calls,2);
win.dispatchEvent(new Event('rimonim-queue-change'));
doc.visibilityState='visible'; doc.dispatchEvent(new Event('visibilitychange'));
mock.timers.tick(150); assert.equal(calls,3,'Refresh on return from background');
stop(); release(); await flush();
win.dispatchEvent(new Event('focus')); mock.timers.tick(60000); assert.equal(calls,3);

// Simulated independent clients: this measures scheduling, not server capacity.
let simulatedReads=0;
const clients=Array.from({length:60},()=>{
  const windowTarget=new EventTarget(),documentTarget=new EventTarget();
  documentTarget.visibilityState='visible';
  return {windowTarget,stop:subscribeOperationalRefresh(async()=>{simulatedReads++;},{windowTarget,documentTarget})};
});
await flush(); assert.equal(simulatedReads,60);
for(const client of clients) for(let i=0;i<50;i++) client.windowTarget.dispatchEvent(new Event('rimonim-queue-change'));
mock.timers.tick(150); await flush();
assert.equal(simulatedReads,120,'60 clients each coalesce 50 events into one new read');
clients.forEach(client=>client.stop());mock.timers.reset();
console.log('PASS: 60 clientes simulados, 3000 avisos agrupados en 60 refrescos; sin solapamiento, pausa en segundo plano, recuperación y limpieza');
