import { submitOperation } from "@/lib/operationQueue";

// Keep operationId with a queued mobile command so reconnects can retry safely.
export async function movePalletLocation(action, palletId, locationId, operationId = crypto.randomUUID()) {
  return submitOperation("move_pallet_location", {
    p_action: action,
    p_pallet_id: palletId,
    p_location_id: locationId,
  }, `pallet:${palletId}`, operationId);
}

export async function changeCoolingCycle(action, tunnelId, operationId = crypto.randomUUID(), expectedCycleId = null) {
  if (!navigator.onLine) throw new Error("Conectate para confirmar el inicio o el fin del prefrío");
  return submitOperation("cooling_cycle_command", {
    p_action: action,
    p_tunnel_id: tunnelId,
    p_expected_cycle_id: expectedCycleId,
  }, `tunnel:${tunnelId}`, operationId);
}

export async function storageCommand(action, payload, operationId = crypto.randomUUID()) {
  if (["distribucion", "iniciar_carga"].includes(action) && !navigator.onLine) {
    throw new Error("Conectate para confirmar la distribución o el inicio de la carga");
  }
  return submitOperation("cold_storage_command", {
    p_action: action, p_payload: payload,
  }, payload.pallet_id ? `pallet:${payload.pallet_id}` : `location:${payload.location_id}`, operationId);
}
