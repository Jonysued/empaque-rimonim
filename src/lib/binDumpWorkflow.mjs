// Mirror queued BIN scans locally without presenting them as server confirmation.
export function projectBinDumps(lots, bins, events, operations) {
  const projectedLots = lots.map(lot => ({ ...lot }));
  const projectedBins = bins.map(bin => ({ ...bin }));
  const projectedEvents = events.map(event => ({ ...event }));
  const blocked = new Set();
  for (const operation of operations) {
    if (operation.rpc !== 'dump_bin_by_qr') continue;
    const p = operation.params;
    const lot = projectedLots.find(lot => lot.id === p.p_lot_id);
    const bin = projectedBins.find(bin => bin.id === p.p_bin_id);
    if (!lot || !bin || bin.dump_operation_id === operation.id || projectedEvents.some(event => event.id === operation.id)) continue;
    lot.pendingStatus = operation.status === 'conflict' || lot.pendingStatus === 'conflict' ? 'conflict' : 'pending';
    if (operation.status === 'conflict') { blocked.add(lot.id); bin.pendingStatus = 'conflict'; }
    if (blocked.has(lot.id)) continue;
    if (bin.receipt_lot_id !== lot.id || bin.status === 'volcado') continue;
    const dumped = Number(lot.bins_dumped) || 0;
    const kg = dumped + 1 === Number(lot.bins_count) ? Number(lot.remaining_weight) : Number(bin.net_weight);
    if (!(kg > 0) || kg > Number(lot.remaining_weight)) continue;
    const at = p.p_scanned_at || operation.createdAt;
    Object.assign(bin, { status: 'volcado', dumped_at: at, dumped_weight: kg, dump_operation_id: operation.id, pendingStatus: 'pending' });
    Object.assign(lot, { bins_dumped: dumped + 1, dumped_weight: (Number(lot.dumped_weight) || 0) + kg,
      remaining_weight: Math.max(0, Number(lot.remaining_weight) - kg), last_dump_at: at,
      status: dumped + 1 === Number(lot.bins_count) ? 'volcado' : 'parcialmente_volcado' });
    projectedEvents.unshift({ id: operation.id, dump_code: p.p_dump_code, bin_id: bin.id, bin_code: bin.bin_code,
      receipt_lot_id: lot.id, receipt_lot_code: lot.lot_code, bins_dumped: 1, net_weight: kg, dump_date: at, pendingStatus: 'pending' });
  }
  return { lots: projectedLots, bins: projectedBins, dumps: projectedEvents };
}
