import { submitOperation } from "@/lib/operationQueue";

// Keep operationId with a queued mobile command so reconnects can retry safely.
export async function movePalletLocation(action, palletId, locationId, operationId = crypto.randomUUID()) {
  return submitOperation("move_pallet_location", {
    p_action: action,
    p_pallet_id: palletId,
    p_location_id: locationId,
  }, `pallet:${palletId}`, operationId);
}

export async function changeCoolingCycle(action, tunnelId, operationId = crypto.randomUUID()) {
  return submitOperation("change_cooling_cycle", {
    p_action: action,
    p_tunnel_id: tunnelId,
  }, `tunnel:${tunnelId}`, operationId);
}
