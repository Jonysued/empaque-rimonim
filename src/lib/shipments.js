import { submitOperation } from "@/lib/operationQueue";

// Estados de pallet disponibles para armar una carga:
// liberados del prefrio o de las cámaras
export const AVAILABLE_FOR_SHIPMENT = ["prefrio_finalizado", "liberado"];

// The caller can retain operationId across a retry (and later in the mobile outbox).
// Availability and capacity are checked again under row locks in Postgres.
export async function loadPalletIntoShipment(shipmentId, palletId, operationId = crypto.randomUUID()) {
  return submitOperation("load_pallet_into_shipment", {
    p_shipment_id: shipmentId,
    p_pallet_id: palletId,
  }, `pallet:${palletId}`, operationId);
}

export async function loadPalletsIntoShipment(shipment, palletsToAdd) {
  if (!shipment || !palletsToAdd?.length) return [];
  const results = [];
  for (const palletId of new Set(palletsToAdd.map(p => p.id))) {
    results.push(await loadPalletIntoShipment(shipment.id, palletId));
  }
  return results;
}
