// Device-only projections. Never invent a server romaneo or a departure time.
export function projectRecordOperations(entity, records, operations) {
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
  return [...rows.values()];
}
