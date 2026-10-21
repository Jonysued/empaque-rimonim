const normalize = value => String(value ?? '').trim().toUpperCase();

// Explicit lot IDs are authoritative. Never infer a link from dates, producer
// or variety; legacy production-run links remain readable.
export const originLotIds = pallet => [...new Set((Array.isArray(pallet.origin_lots) ? pallet.origin_lots : [])
  .filter(id => typeof id === 'string' && id.trim()))];

export function findTrace(data, code) {
  const value = normalize(code);
  if (!value) return null;
  for (const { type, key, fields } of [
    {type:'lote', key:'lots', fields:['lot_code']}, {type:'bin', key:'bins', fields:['bin_code']},
    {type:'pallet', key:'pallets', fields:['pallet_code', 'romaneo_number']},
    {type:'despacho', key:'shipments', fields:['shipment_code', 'load_number']},
  ]) {
    const entity = data[key].find(item => fields.some(field => item[field] != null && normalize(item[field]) === value));
    if (entity) return { type, entity };
  }
  return null;
}

export function lotTrace(data, lot) {
  const dumps = data.dumps.filter(dump => dump.receipt_lot_id === lot.id);
  const runIds = new Set(dumps.map(dump => dump.production_run_id).filter(Boolean));
  const runs = data.runs.filter(run => runIds.has(run.id));
  const pallets = data.pallets.filter(pallet => pallet.trace_balance?.method === 'fifo_estimated' || originLotIds(pallet).length
    ? originLotIds(pallet).includes(lot.id)
    : pallet.production_run_id && runIds.has(pallet.production_run_id));
  const shipmentIds = new Set(pallets.map(pallet => pallet.shipment_id).filter(Boolean));
  return { dumps, runs, pallets, shipments: data.shipments.filter(shipment => shipmentIds.has(shipment.id)
    || (shipment.loaded_pallet_ids || []).some(id => pallets.some(p => p.id === id))) };
}

export function palletTrace(data, pallet) {
  const run = pallet.production_run_id ? data.runs.find(item => item.id === pallet.production_run_id) : null;
  const explicit = originLotIds(pallet);
  const automatic=pallet.trace_balance?.method === 'fifo_estimated';
  const dumps = automatic ? data.dumps.filter(dump => pallet.trace_balance.allocations.some(a=>a.dump_id===dump.id)) : explicit.length ? data.dumps.filter(dump => explicit.includes(dump.receipt_lot_id)
    && new Date(dump.dump_date || dump.created_date).getTime() <= new Date(pallet.created_date).getTime())
    : pallet.production_run_id ? data.dumps.filter(dump => dump.production_run_id === pallet.production_run_id) : [];
  const lotIds = new Set(automatic || explicit.length ? explicit : dumps.map(dump => dump.receipt_lot_id).filter(Boolean));
  return { run: automatic || explicit.length ? null : run, dumps, lots: data.lots.filter(lot => lotIds.has(lot.id)), shipment: data.shipments.find(shipment =>
    shipment.id === pallet.shipment_id || (shipment.loaded_pallet_ids || []).includes(pallet.id)) };
}
