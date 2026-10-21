import {supabase,localSessionIdentity} from '@/api/base44Client';
import {workspaceOwner} from '@/lib/workspace';
import {readSnapshot,saveSnapshot} from '@/lib/offlineStore';
import {allocateFifoOrigins,applyFifoOrigins} from '@/lib/fifoTraceability.mjs';

export async function productionBalance(pallets) {
  const {id,offline}=await localSessionIdentity();const owner=workspaceOwner(id);
  let snapshot,fromCache=offline;
  if(!offline) {
    try {
      const {data,error}=await supabase.rpc('production_balance_inputs');
      if(error)throw error;snapshot=data;await saveSnapshot(owner,'production-balance-v1',snapshot);
    } catch(error) {
      if(!(error instanceof TypeError || error?.status===0 || /failed to fetch|networkerror/i.test(error?.message||'')))throw error;
      fromCache=true;
    }
  }
  if(!snapshot)snapshot=await readSnapshot(owner,'production-balance-v1');
  // Missing cache never blocks pallet creation. It cannot confirm an origin.
  if(!snapshot)return {pallets, rates:[],offline:true,asOf:null,missing:true};
  // Include all confirmed pallets to keep inventory consumed outside the
  // visible page, then overlay this device's projected pending work.
  const merged=new Map((snapshot.pallets||[]).map(p=>[p.id,p]));
  for(const pallet of pallets)if(pallet.pendingStatus || !merged.has(pallet.id))merged.set(pallet.id,pallet);
  const balances=allocateFifoOrigins({...snapshot,pallets:[...merged.values()]});
  return {pallets:applyFifoOrigins(pallets.map(p=>p.pendingStatus?p:merged.get(p.id)||p),balances,fromCache),rates:snapshot.rates||[],offline:fromCache,asOf:snapshot.as_of,missing:false};
}

export async function saveDiscardRate(effectiveDate,percent) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !Number.isFinite(percent) || percent<0 || percent>100)throw new Error('Indicá fecha y descarte entre 0 y 100%');
  if(!navigator.onLine)throw new Error('Conectate para configurar el descarte. El palletizado puede continuar.');
  const {error}=await supabase.from('production_discard_rates').insert({effective_date:effectiveDate,discard_percent:percent});
  if(error)throw error;
}
