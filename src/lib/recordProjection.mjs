// Device-only projections. Never invent a server romaneo or a departure time.
export function projectRecordOperations(entity, records, operations, palletRecords) {
  const rows = new Map(records.map(row => [row.id, { ...row, data: { ...row.data } }]));
  const blocked = new Set();
  for (const command of operations) {
    if (command.rpc === 'offline_record_operation' && command.params.p_entity === entity) {
      const { p_id: id, p_action: action, p_payload: payload } = command.params;
      let row = rows.get(id);
      if (!row && action === 'create') {
        row = { id, created_date: command.createdAt, data: { ...payload, id } };
        rows.set(id, row);
    }
    if (!row) continue;
    if (command.status === 'conflict') blocked.add(id);
    row.data.pendingStatus = blocked.has(id) ? 'conflict' : command.status;
    if (blocked.has(id)) continue;
    if (action === 'patch') Object.assign(row.data, payload);
    if (action === 'dispatch') { Object.assign(row.data, payload); row.data.pendingDeparture = true; }
    if (entity === 'Pallet' && !row.data.romaneo_number) row.data.romaneo_number = 'Pendiente de numeración';
    continue;
    }
    if (!['load_pallet_into_shipment', 'unload_pallet_from_shipment'].includes(command.rpc)) continue;
    const p = command.params, load = command.rpc === 'load_pallet_into_shipment';
    const row = rows.get(entity === 'Pallet' ? p.p_pallet_id : p.p_shipment_id);
    if (!row || !['Pallet', 'Shipment'].includes(entity)) continue;
    if (command.status === 'conflict') blocked.add(row.id);
    row.data.pendingStatus = blocked.has(row.id) ? 'conflict' : command.status;
    if (blocked.has(row.id)) continue;
    if (entity === 'Shipment') {
      const ids = new Set(row.data.loaded_pallet_ids || []);
      if (load) ids.add(p.p_pallet_id); else ids.delete(p.p_pallet_id);
      row.data.loaded_pallet_ids = [...ids];
      row.data.status = ids.size ? 'cargado' : 'borrador';
    } else {
      row.data.shipment_id = load ? p.p_shipment_id : null;
      row.data.status = load ? 'despachado' : 'liberado';
    }
  }
  if (entity === 'Shipment' && palletRecords) {
    const pallets = new Map(projectRecordOperations('Pallet', palletRecords, operations).map(row => [row.id, row.data]));
    for (const row of rows.values()) {
      const ids = [...new Set(row.data.loaded_pallet_ids || [])];
      const loaded = ids.map(id => pallets.get(id));
      const palletStatus = loaded.some(pallet => pallet?.pendingStatus === 'conflict') ? 'conflict'
        : loaded.some(pallet => pallet?.pendingStatus) ? 'pending' : null;
      if (!row.data.pendingStatus && !palletStatus) continue;
      if (palletStatus) row.data.pendingStatus = row.data.pendingStatus === 'conflict' ? 'conflict' : palletStatus;
      // Never display a partial sum as the total if a pallet is absent locally.
      row.data.pendingTotalsUnavailable = loaded.some(pallet => !pallet);
      if (row.data.pendingTotalsUnavailable) continue;
      row.data.total_weight = loaded.reduce((sum, pallet) => sum + Number(pallet.net_weight || 0), 0);
      row.data.total_packages = loaded.reduce((sum, pallet) => sum + Number(pallet.package_count || 0), 0);
    }
  }
  return [...rows.values()];
}
