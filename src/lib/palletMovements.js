import { supabase } from "@/api/base44Client";

// Keep operationId with a queued mobile command so reconnects can retry safely.
export async function movePalletLocation(action, palletId, locationId, operationId = crypto.randomUUID()) {
  const { data, error } = await supabase.rpc("move_pallet_location", {
    p_operation_id: operationId,
    p_action: action,
    p_pallet_id: palletId,
    p_location_id: locationId,
  });
  if (error) throw error;
  return data;
}

export async function changeCoolingCycle(action, tunnelId, operationId = crypto.randomUUID()) {
  const { data, error } = await supabase.rpc("change_cooling_cycle", {
    p_operation_id: operationId,
    p_action: action,
    p_tunnel_id: tunnelId,
  });
  if (error) throw error;
  return data;
}
