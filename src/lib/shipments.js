import { submitOperation } from "@/lib/operationQueue";
import { base44 } from '@/api/base44Client';

async function checkDeparture(shipmentId) {
  const shipment = await base44.entities.Shipment.get(shipmentId);
  if (shipment.pendingDeparture) throw new Error('La salida ya está pendiente de sincronizar; no se pueden cambiar sus pallets.');
}

// Estados de pallet disponibles para armar una carga:
// liberados del prefrio o de las cámaras
export const AVAILABLE_FOR_SHIPMENT = ["prefrio_finalizado", "liberado"];

// The caller can retain operationId across a retry (and later in the mobile outbox).
// Availability and capacity are checked again under row locks in Postgres.
export async function loadPalletIntoShipment(shipmentId, palletId, operationId = crypto.randomUUID()) {
  await checkDeparture(shipmentId);
  return submitOperation("load_pallet_into_shipment", {
    p_shipment_id: shipmentId,
    p_pallet_id: palletId,
  }, `pallet:${palletId}`, operationId);
}

export async function unloadPalletFromShipment(shipmentId, palletId, operationId = crypto.randomUUID()) {
  await checkDeparture(shipmentId);
  return submitOperation("unload_pallet_from_shipment", {
    p_shipment_id: shipmentId,
    p_pallet_id: palletId,
  }, `pallet:${palletId}`, operationId);
}

export async function reopenShipmentForCorrection(shipmentId, operationId = crypto.randomUUID()) {
  if (!navigator.onLine) throw new Error('Conectate para reabrir un despacho enviado');
  return submitOperation("reopen_shipment_for_correction", {
    p_shipment_id: shipmentId,
  }, `shipment:${shipmentId}:reopen`, operationId);
}

export async function loadPalletsIntoShipment(shipment, palletsToAdd) {
  if (!shipment || !palletsToAdd?.length) return [];
  const results = [];
  for (const palletId of new Set(palletsToAdd.map(p => p.id))) {
    results.push(await loadPalletIntoShipment(shipment.id, palletId));
  }
  return results;
}
