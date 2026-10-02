export const BIN_STAGES = [
  ['consolidate','Cosecha → cierre del consolidado'], ['weigh','Cierre del consolidado → pesado'],
  ['yard','Pesado → recepción Playa Empaque'], ['dump','Playa Empaque → vuelco del BIN'], ['binTotal','Cosecha → vuelco del BIN'],
];
export const PALLET_STAGES = [
  ['toTunnel','Creación → ingreso a prefrío'], ['tunnel','Permanencia en prefrío'],
  ['toChamber','Salida de prefrío → ingreso a cámara'], ['chamber','Permanencia en cámara'],
  ['toLoad','Salida de cámara → carga en transporte'], ['load','Carga → despacho confirmado'], ['palletTotal','Creación → despacho confirmado'],
];
export const STAGE_LABELS = Object.fromEntries([...BIN_STAGES, ...PALLET_STAGES]);
export const timestamp = value => { if (!value) return null; const n = new Date(value).getTime(); return Number.isFinite(n) ? n : null; };
export const operationDay = value => {
  const n = timestamp(value); if (n === null) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(n);
  return ['year','month','day'].map(key => parts.find(p => p.type === key)?.value).join('-');
};
export const operationDate = value => timestamp(value)===null ? '—' : new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(timestamp(value));
export const inPeriod = (value, filters) => { const day = operationDay(value); return Boolean(day) && (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to); };
export function durationLabel(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.floor(ms / 60000); if (mins < 1) return '< 1 min';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60); if (hours < 24) return `${hours} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
  return `${Math.floor(hours / 24)} d${hours % 24 ? ` ${hours % 24} h` : ''}`;
}
export const normalizeFilter = value => String(value||'').trim().toLocaleUpperCase('es-AR');
const fieldMatch=(value,filter)=>!filter || String(value||'').split(' / ').some(v=>normalizeFilter(v)===normalizeFilter(filter));
const identityMatch = (item, f) => fieldMatch(item.producer,f.producer) && fieldMatch(item.variety,f.variety) && fieldMatch(item.origin,f.origin);
const sample = (key, id, start, end, extra = {}) => {
  const a = timestamp(start), b = timestamp(end);
  return a !== null && b !== null && b >= a ? {key, id, start:a, end:b, ms:b-a, ...extra} : null;
};
const pending = (key,id,start,now,extra={}) => { const a=timestamp(start); return {key,id,start:a,age:a !== null && a<=now ? now-a : null,...extra}; };

// Pair actual movements, not the pallet's current status. Repeated stays remain distinct.
export function palletJourney(pallet, movements, shipments, now = Date.now()) {
  const shipment = shipments.find(s => s.id === pallet.shipment_id);
  const sent = shipment?.status === 'enviado';
  const events = movements.filter(m => m.unit_type === 'pallet' && m.unit_id === pallet.id && !m.pendingStatus && timestamp(m.occurred_at || m.created_date) !== null)
    .map(m => ({...m, at:timestamp(m.occurred_at || m.created_date)})).sort((a,b) => a.at-b.at || String(a.id).localeCompare(String(b.id)));
  const intervals=[]; const rows=[{id:`created:${pallet.id}`,action:'Creación del pallet',at:timestamp(pallet.created_date),location:'Producción'}];
  let tunnel=null, chamber=null, lastTunnelExit=null, lastChamberExit=null, load=null, firstTunnel=false, invalid=0;
  const add = (key,start,end) => { const s=sample(key,pallet.id,start,end); if(s) intervals.push(s); else invalid++; };
  let state='toTunnel', stateAt=timestamp(pallet.created_date), location='Producción';
  for(const event of events) {
    const action=event.operation_action || event.action;
    rows.push({id:event.id,action,at:event.at,location:event.destination_location_name || event.origin_location_name || '',section:event.destination_section ?? event.origin_section,position:event.destination_position ?? event.origin_position,elapsed:rows.at(-1)?.at !== null && event.at>=rows.at(-1)?.at ? event.at-rows.at(-1).at : null});
    if(action==='carga_tunel') {
      if(!firstTunnel) { add('toTunnel',pallet.created_date,event.at); firstTunnel=true; }
      tunnel={at:event.at,location:event.destination_location_id}; state='tunnel'; stateAt=event.at; location=event.destination_location_name || 'Túnel';
    } else if(action==='liberacion_tunel') {
      if(tunnel && (!event.origin_location_id || tunnel.location===event.origin_location_id)) add('tunnel',tunnel.at,event.at); else invalid++;
      tunnel=null; lastTunnelExit=event.at; state='toChamber'; stateAt=event.at; location='Espera de cámara';
    } else if(action==='carga_camara') {
      if(tunnel && tunnel.location===event.origin_location_id) { add('tunnel',tunnel.at,event.at); lastTunnelExit=event.at; tunnel=null; }
      if(lastTunnelExit !== null) { add('toChamber',lastTunnelExit,event.at); lastTunnelExit=null; }
      chamber={at:event.at,location:event.destination_location_id}; state='chamber'; stateAt=event.at; location=event.destination_location_name || 'Cámara';
    } else if(action==='retiro_camara' || action==='traslado' && event.origin_location_id && !event.destination_location_id) {
      if(chamber && (!event.origin_location_id || chamber.location===event.origin_location_id)) add('chamber',chamber.at,event.at); else invalid++;
      chamber=null; lastChamberExit=event.at; state='toLoad'; stateAt=event.at; location='Espera de carga';
    } else if(action==='carga_despacho') {
      // A historical direct camera-to-shipment movement also closes the camera stay.
      if(chamber && chamber.location===event.origin_location_id) { add('chamber',chamber.at,event.at); lastChamberExit=event.at; chamber=null; }
      if(lastChamberExit !== null) { add('toLoad',lastChamberExit,event.at); lastChamberExit=null; }
      load={at:event.at,shipmentId:event.destination_location_id}; state='load'; stateAt=event.at; location=event.destination_location_name || 'Transporte';
    } else if(action==='retiro_despacho') {
      load=null; lastChamberExit=event.at; state='toLoad'; stateAt=event.at; location='Disponible para carga';
    }
  }
  const candidate = sent ? timestamp(shipment.dispatched_at) : null;
  const dispatch = candidate!==null && timestamp(pallet.created_date)!==null && candidate>=timestamp(pallet.created_date) && (!load || load.shipmentId!==shipment.id || candidate>=load.at) ? candidate : null;
  if(dispatch !== null) {
    if(load?.shipmentId===shipment.id)add('load',load.at,dispatch);
    add('palletTotal',pallet.created_date,dispatch);
    if(!rows.some(r=>r.action==='salida_despacho' && r.at===dispatch)) rows.push({id:`sent:${shipment.id}`,action:'salida_despacho',at:dispatch,location:shipment.load_number || shipment.shipment_code});
  }
  // Backlog is authoritative from current records; incomplete legacy history is not fabricated.
  if(!sent) {
    if(pallet.shipment_id) { state='load'; stateAt=load?.shipmentId===pallet.shipment_id ? load.at : null; location=shipment?.load_number || 'Transporte'; }
    else if(pallet.location_id) {
      state=pallet.status==='en_camara' ? 'chamber' : 'tunnel';
      stateAt=state==='chamber' && chamber?.location===pallet.location_id ? chamber.at : state==='tunnel' && tunnel?.location===pallet.location_id ? tunnel.at : null;
      location=pallet.location_name || (state==='chamber'?'Cámara':'Túnel');
    } else if(pallet.status==='liberado') { state='toLoad'; stateAt=lastChamberExit!==null ? lastChamberExit : events.at(-1)?.action==='retiro_despacho' ? events.at(-1).at : null; location='Espera de carga'; }
    else if(pallet.status==='prefrio_finalizado') { state='toChamber'; stateAt=lastTunnelExit; location='Espera de cámara'; }
  }
  const active=!sent && pallet.status!=='anulado';
  const waiting=active ? [pending(state,pallet.id,stateAt,now,{code:pallet.romaneo_number || pallet.pallet_code,location}),pending('palletTotal',pallet.id,pallet.created_date,now)] : [];
  return {intervals,rows,waiting,active,dispatch,invalid,missingDispatch:sent && dispatch===null};
}

export function summarizeStages(stages, intervals, waiting, filters) {
  return stages.map(([key,label]) => {
    const sums=new Map();
    intervals.filter(s=>s && s.key===key && inPeriod(s.end,filters)).forEach(s=>sums.set(s.id,(sums.get(s.id)||0)+s.ms));
    const values=[...sums.values()]; const waits=waiting.filter(s=>s.key===key); const ages=waits.map(s=>s.age).filter(n=>n!==null);
    return {key,label,average:values.length ? values.reduce((a,b)=>a+b,0)/values.length : null,count:values.length,pending:waits.length,maxWait:ages.length?Math.max(...ages):null,unknown:waits.length-ages.length};
  });
}

export function dashboardMetrics(data, filters={}, now=Date.now()) {
  const {lots=[],bins=[],dumps=[],pallets=[],movements=[],shipments=[],runs=[],locations=[]}=data;
  const byLot=new Map(lots.map(l=>[l.id,l]));
  const relevantBins=bins.filter(b=>b.status!=='anulado' && identityMatch(b,filters));
  const confirmedDump=new Map(dumps.filter(d=>d.bin_id && !d.pendingStatus).map(d=>[d.bin_id,d]));
  const intervals=[],waiting=[],lotRows=new Map(); let incompleteBins=0;
  for(const bin of relevantBins) {
    const lot=byLot.get(bin.receipt_lot_id), event=confirmedDump.get(bin.id);
    const harvest=bin.scanned_at || (Number(bin.harvest_workflow)===3 ? bin.created_date : null);
    if(lot && !(Number(lot.workflow_version)>=2)) { if(!harvest)incompleteBins++; continue; }
    const closed=lot?.field_closed_at, weighed=lot?.weighed_at, received=lot?.yard_received_at, dumped=bin.dumped_at || event?.dump_date;
    for(const [key,a,b] of [['consolidate',harvest,closed],['weigh',closed,weighed],['yard',weighed,received],['dump',received,dumped],['binTotal',harvest,dumped]]) { const s=sample(key,bin.id,a,b); if(s) intervals.push(s); }
    if(!harvest) incompleteBins++;
    if(bin.status==='volcado' || dumped || lot?.status==='anulado' || lot?.status==='volcado') continue;
    const legacyLot=lot && !(Number(lot.workflow_version)>=2);
    const key=legacyLot?'dump':!closed?'consolidate':!weighed?'weigh':!received?'yard':'dump';
    const start={consolidate:harvest,weigh:closed,yard:weighed,dump:received}[key];
    const wait=pending(key,bin.id,start,now,{code:bin.bin_code}),totalWait=pending('binTotal',bin.id,harvest,now); waiting.push(wait,totalWait);
    const group=lot?.id || 'unconsolidated';
    if(!lotRows.has(group)) lotRows.set(group,{id:group,lot,code:lot?.lot_code || 'Bines sin consolidar',stage:key,station:STAGE_LABELS[key].split('→').at(-1).trim(),count:0,kg:weighed || legacyLot && lot.net_weight!=null ? 0 : null,maxWait:null,unknown:0,producers:new Set(),origins:new Set()});
    const row=lotRows.get(group); row.count++; if(totalWait.age!==null)row.maxTotalWait=Math.max(row.maxTotalWait||0,totalWait.age); if(row.kg!==null) row.kg+=Number(bin.net_weight)||0;
    if(wait.age!==null) row.maxWait=Math.max(row.maxWait||0,wait.age); else row.unknown++;
    row.producers.add(bin.producer || lot?.producer || '—'); row.origins.add(bin.origin || lot?.origin || '—');
  }
  const knownLots=new Set(relevantBins.filter(b=>Number(byLot.get(b.receipt_lot_id)?.workflow_version)>=2).map(b=>b.receipt_lot_id));
  // Legacy lot balances are kept visible, but do not contribute invented per-BIN timing.
  for(const lot of lots.filter(l=>!(Number(l.workflow_version)>=2) && !knownLots.has(l.id) && identityMatch(l,filters) && Number(l.remaining_weight)>0 && l.status!=='anulado')) {
    const count=Math.max(0,(Number(lot.bins_count)||0)-(Number(lot.bins_dumped)||0));
    lotRows.set(lot.id,{id:lot.id,lot,code:lot.lot_code,stage:'dump',station:'Vuelco · historial anterior',count,kg:Number(lot.remaining_weight),maxWait:null,unknown:count,producers:new Set([lot.producer||'—']),origins:new Set([lot.origin||'—'])});
    for(let i=0;i<count;i++) {waiting.push(pending('dump',`${lot.id}:legacy:${i}`,null,now),pending('binTotal',`${lot.id}:legacy:${i}`,null,now));}
  }
  const ps=pallets.filter(p=>identityMatch(p,{...filters,origin:''}));
  const movementsByPallet=new Map();
  for(const m of movements) { if(!movementsByPallet.has(m.unit_id))movementsByPallet.set(m.unit_id,[]); movementsByPallet.get(m.unit_id).push(m); }
  const journeys=ps.map(p=>({pallet:p,...palletJourney(p,movementsByPallet.get(p.id)||[],shipments,now)}));
  const pIntervals=journeys.flatMap(j=>j.intervals),pWaiting=journeys.flatMap(j=>j.waiting);
  const pRows=journeys.filter(j=>j.active).map(j=>({pallet:j.pallet,journey:j,wait:j.waiting[0]})).sort((a,b)=>(b.wait.age??-1)-(a.wait.age??-1));
  const byBin=new Map(bins.map(b=>[b.id,b]));
  const acceptedDumps=dumps.filter(d=>inPeriod(d.dump_date,filters) && identityMatch({...byLot.get(d.receipt_lot_id),...d,...byBin.get(d.bin_id)},filters));
  const applicableLots=lots.filter(l=>identityMatch(l,filters) || relevantBins.some(b=>b.receipt_lot_id===l.id));
  const binStats={harvested:relevantBins.filter(b=>Number(b.harvest_workflow)===3 && inPeriod(b.scanned_at||b.created_date,filters)).length,
    unconsolidated:relevantBins.filter(b=>!b.receipt_lot_id && b.status!=='volcado').length,
    unweighedBins:waiting.filter(w=>w.key==='weigh').length,
    unweighed:applicableLots.filter(l=>l.field_closed_at && !l.weighed_at && l.status!=='anulado').length,
    dumpPending:waiting.filter(w=>w.key==='dump').length,
    dumpKg:[...lotRows.values()].filter(row=>row.stage==='dump').reduce((s,row)=>s+(Number(row.kg)||0),0),
    dumpedBins:acceptedDumps.reduce((s,d)=>s+(Number(d.bins_dumped)||1),0),dumpedKg:acceptedDumps.reduce((s,d)=>s+(Number(d.net_weight)||0),0)};
  const production=runs.filter(r=>identityMatch(r,filters) && inPeriod(r.date || r.start_time || r.created_date,filters));
  const sentJourneys=journeys.filter(j=>j.dispatch!==null && inPeriod(j.dispatch,filters));
  const cold=locations.filter(l=>['tunel','camara'].includes(l.type)).map(l=>({location:l,pallets:ps.filter(p=>p.location_id===l.id),oldest:pRows.filter(r=>r.pallet.location_id===l.id).reduce((m,r)=>r.wait.age===null?m:Math.max(m??0,r.wait.age),null)}));
  return {binStats,binTimes:summarizeStages(BIN_STAGES,intervals,waiting,filters),palletTimes:summarizeStages(PALLET_STAGES,pIntervals,pWaiting,filters),
    lotRows:[...lotRows.values()].sort((a,b)=>(b.maxWait??-1)-(a.maxWait??-1)),pRows,cold,
    production:{fresh:production.reduce((s,r)=>s+(Number(r.fresh_weight)||0),0),aril:production.reduce((s,r)=>s+(Number(r.aril_weight)||0),0),discard:production.reduce((s,r)=>s+(Number(r.discard_weight)||0),0)},
    shipmentsPending:shipments.filter(s=>['borrador','reservado','cargado'].includes(s.status) && (!filters.producer && !filters.variety || ps.some(p=>p.shipment_id===s.id))).length,
    shippedKg:sentJourneys.reduce((s,j)=>s+(Number(j.pallet.net_weight)||0),0),shippedPallets:sentJourneys.length,
    missingDispatch:journeys.filter(j=>j.missingDispatch).length,incompleteBins,invalidIntervals:journeys.reduce((s,j)=>s+j.invalid,0),
    held:lots.filter(l=>l.held && identityMatch(l,filters)).map(l=>`Lote ${l.lot_code} retenido por calidad`)};
}
