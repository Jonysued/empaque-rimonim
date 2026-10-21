const group = row => [row.producer, row.variety].map(value => String(value || '').trim().toUpperCase());
const key = row => JSON.stringify(group(row));
const grams = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value) * 1000) : 0;
const time = row => Date.parse(row.dump_date || row.created_date || '');
const compare = (a,b) => time(a) - time(b) || String(a.id).localeCompare(String(b.id));
const sanJuanDay = stamp => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Argentina/San_Juan',year:'numeric',month:'2-digit',day:'2-digit'}).format(stamp);
const cancelled = row => ['anulado','cancelado'].includes(row.status);

// A deterministic projection of one confirmed server snapshot. Nothing is
// guessed from producer alone, no stock is written and all product categories
// consume the SAME remaining FIFO pool. Late arrivals replay in event time.
export function allocateFifoOrigins({lots=[],dumps=[],pallets=[],rates=[]}={}) {
  const lotMap = new Map(lots.map(lot => [lot.id,lot]));
  const rateOrder = [...rates].sort((a,b) => String(b.effective_date).localeCompare(String(a.effective_date))
    || Date.parse(b.created_at)-Date.parse(a.created_at) || String(b.id).localeCompare(String(a.id)));
  const seenDumps = new Set();
  const supplies = dumps.filter(dump => {
    if (!dump.id || seenDumps.has(dump.id) || cancelled(dump) || dump.pendingStatus) return false;
    seenDumps.add(dump.id);return true;
  }).map(dump => {
    const lot=lotMap.get(dump.receipt_lot_id), stamp=time(dump);
    if(!lot || cancelled(lot) || lot.held || !Number.isFinite(stamp))return null;
    const day=sanJuanDay(stamp), rate=rateOrder.find(r => r.effective_date<=day);
    const percent=rate?.discard_percent == null ? NaN : Number(rate.discard_percent);
    const configured=Number.isFinite(percent) && percent>=0 && percent<=100;
    const raw=grams(dump.net_weight), usable=configured ? Math.floor(raw*(10000-Math.round(percent*100))/10000) : 0;
    return {...dump,lot,stamp,group:key(lot),raw,usable,left:usable,percent:configured?percent:null,rateId:configured?rate.id:null};
  }).filter(Boolean).sort(compare);
  const pools=new Map();
  for(const supply of supplies) {
    if(!pools.has(supply.group))pools.set(supply.group,{sources:[],cursor:0,unknownAt:Infinity});
    const pool=pools.get(supply.group);
    if(supply.percent===null && supply.raw>0)pool.unknownAt=Math.min(pool.unknownAt,supply.stamp);
    if(supply.usable>0)pool.sources.push(supply);
  }
  const results={};
  const provisionalGroups=new Set(pallets.filter(p=>p.pendingStatus && !cancelled(p)).map(key));
  const ordered=[...pallets].sort(compare);
  for(const pallet of ordered) {
    if(!pallet.id || results[pallet.id] || cancelled(pallet))continue;
    const requested=grams(pallet.net_weight), stamp=time(pallet), identity=group(pallet).every(Boolean);
    let remaining=requested;const allocations=[];
    const pool=identity && Number.isFinite(stamp) ? pools.get(key(pallet)) : null;
    while(remaining && pool && pool.cursor<pool.sources.length) {
      const supply=pool.sources[pool.cursor];
      if(supply.stamp>stamp)break;
      const used=Math.min(remaining,supply.left);
      const consumedBefore=supply.usable-supply.left;
      const rawUsed=Math.floor(supply.raw*(consumedBefore+used)/supply.usable)-Math.floor(supply.raw*consumedBefore/supply.usable);
      allocations.push({dump_id:supply.id,lot_id:supply.lot.id,lot_code:supply.lot.lot_code,
        net_kg:used/1000,raw_kg:rawUsed/1000,discard_percent:supply.percent,rate_id:supply.rateId});
      supply.left-=used;remaining-=used;
      if(!supply.left)pool.cursor++;
    }
    const status=!identity || !Number.isFinite(stamp) || !requested ? 'pending_data'
      : remaining ? pool?.unknownAt<=stamp ? 'pending_discard' : 'pending_dump'
        : provisionalGroups.has(key(pallet)) ? 'pending_sync' : 'balanced_estimate';
    results[pallet.id]={method:'fifo_estimated',status,requested_kg:requested/1000,assigned_kg:(requested-remaining)/1000,
      shortage_kg:remaining/1000,origin_lots:[...new Set(allocations.map(a=>a.lot_id))],allocations};
  }
  return results;
}

export const fifoStatusLabel = status => ({balanced_estimate:'Balance conciliado · estimado',pending_dump:'Pendiente de vuelcos / revisar diferencia',
  pending_discard:'Pendiente de configurar descarte',pending_data:'Faltan productor, variedad, peso o fecha',pending_sync:'Pendiente de sincronizar',
  pending_offline:'Balance guardado · sin conexión'}[status] || 'Pendiente de conciliación');

export function applyFifoOrigins(pallets, balances, offline=false) {
  return pallets.map(pallet => balances[pallet.id] ? {...pallet,composition_estimated:true,
    origin_lots:balances[pallet.id].origin_lots,trace_balance:{...balances[pallet.id],status:offline?'pending_offline':balances[pallet.id].status}} : pallet);
}
