// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import-data -- export.json
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
const [file] = process.argv.slice(2);
if (!file || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Indicá export.json, SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
const allowed = new Set(['ReceiptLot','Bin','DumpingEvent','ProductionRun','Pallet','Location','CoolingCycle','Shipment','MovementEvent','Catalog','QualityHold','AuditEvent']);
const source=JSON.parse(readFileSync(file,'utf8'));
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
for(const [entity,items] of Object.entries(source)) {
 if(!allowed.has(entity)) throw Error(`Entidad desconocida: ${entity}`);
 if(!Array.isArray(items)) throw Error(`${entity}: se esperaba una lista`);
 let count=0;
 for(let i=0;i<items.length;i+=100) {
  const batch=items.slice(i,i+100).map(item=>({entity,id:item.id ? String(item.id) : randomUUID(),data:item,created_date:item.created_date||new Date().toISOString()}));
  const {error}=await client.from('records').upsert(batch,{onConflict:'entity,id'});
  if(error) throw Error(`${entity}: ${error.message}`);
  count+=batch.length;
 }
 console.log(`${entity}: ${count} registros`);
}
