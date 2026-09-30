export const FIELD_VERSION = 2;
export const isFieldLot = lot => Number(lot?.workflow_version) >= FIELD_VERSION;
export const canDumpLot = lot => !isFieldLot(lot) || Boolean(lot.yard_received_at) && ['recibido', 'parcialmente_volcado', 'volcado'].includes(lot.status);
export const normalizeBinCode = code => String(code || '').trim().toUpperCase();

// Show a device's pending commands in order without presenting them as server confirmations.
export function projectFieldOperations(confirmedLots, confirmedBins, operations) {
  const lots = new Map(confirmedLots.map(lot => [lot.id, { ...lot }]));
  let bins = confirmedBins.map(bin => ({ ...bin }));
  const blocked = new Set();
  for (const operation of operations) {
    if (operation.rpc === 'harvest_bin_operation') {
      const p = operation.params;
      if (!bins.some(bin => bin.id === p.p_bin_id)) bins.unshift({ ...p.p_record, bin_code: normalizeBinCode(p.p_record.bin_code),
        id: p.p_bin_id, harvest_workflow: 3, status: 'cosechado', created_date: operation.createdAt, scanned_at: operation.createdAt, pendingStatus: operation.status });
      continue;
    }
    if (operation.rpc !== 'field_lot_operation') continue;
    const p = operation.params;
    let lot = lots.get(p.p_lot_id);
    if (lot?.field_operations?.some(item => item.id === operation.id)) continue;
    if (!lot && p.p_action === 'create') {
      lot = { ...p.p_record, id: p.p_lot_id, workflow_version: Number(p.p_record.workflow_version) || FIELD_VERSION, status: 'en_campo',
        bins_count: 0, bins_dumped: 0, remaining_weight: 0, dumped_weight: 0,
        created_date: operation.createdAt, field_created_at: operation.createdAt };
      lots.set(lot.id, lot);
    }
    if (!lot) continue;
    lot.pendingStatus = operation.status === 'conflict' || lot.pendingStatus === 'conflict' ? 'conflict' : 'pending';
    if (operation.status === 'conflict') blocked.add(lot.id);
    if (blocked.has(lot.id)) continue;
    const code = normalizeBinCode(p.p_bin_code);
    const consolidated = Number(lot.workflow_version) === 3;
    if (p.p_action === 'add_bin' && consolidated) {
      const bin = bins.find(bin => bin.bin_code === code && !bin.receipt_lot_id && Number(bin.harvest_workflow) === 3 && bin.pendingStatus !== 'conflict');
      if (bin) { bin.receipt_lot_id = lot.id; bin.receipt_lot_code = lot.lot_code; bin.status = 'en_campo'; }
      else { blocked.add(lot.id); continue; }
    } else if (p.p_action === 'add_bin' && !bins.some(bin => bin.id === operation.id)) {
      bins.push({ id: operation.id, receipt_lot_id: lot.id, bin_code: code, status: 'en_campo', pending: true });
    } else if (p.p_action === 'remove_bin') {
      if (consolidated) bins = bins.map(bin => bin.receipt_lot_id === lot.id && bin.bin_code === code ? { ...bin, receipt_lot_id: undefined, receipt_lot_code: undefined, status: 'cosechado' } : bin);
      else bins = bins.filter(bin => !(bin.receipt_lot_id === lot.id && bin.bin_code === code));
    } else if (p.p_action === 'close') {
      lot.status = 'cerrado_campo'; lot.field_closed_at = operation.createdAt;
    } else if (p.p_action === 'weigh') {
      lot.status = 'pesado'; lot.gross_weight = p.p_gross; lot.tare_weight = p.p_tare;
      lot.net_weight = Math.round((p.p_gross - p.p_tare) * 10) / 10;
      lot.remaining_weight = lot.net_weight; lot.bin_weight = lot.net_weight / lot.bins_count;
      lot.weighed_at = operation.createdAt;
      bins = bins.map(bin => bin.receipt_lot_id === lot.id ? { ...bin, net_weight: lot.bin_weight, status: 'pesado' } : bin);
    } else if (p.p_action === 'receive') {
      lot.status = 'recibido'; lot.yard_received_at = operation.createdAt; lot.receipt_date = operation.createdAt;
    }
    const attached = bins.filter(bin => bin.receipt_lot_id === lot.id);
    lot.bins_count = attached.length;
    if (consolidated) {
      for (const key of ['producer','variety','origin','species','harvest_type','crew']) lot[key] = [...new Set(attached.map(bin => bin[key]).filter(Boolean))].sort().join(' / ');
      if (p.p_action === 'close') lot.expected_bins_count = attached.length;
    }
  }
  return { lots: Array.from(lots.values()).sort((a,b) => String(b.created_date).localeCompare(String(a.created_date))), bins };
}
