import { base44 } from "@/api/base44Client";

const STATUS_BY_TYPE = {
  tunel: ["en_tunel", "prefrio_finalizado"],
  camara: ["en_camara"],
};

// Recalcula la ocupación de una ubicación contando los pallets reales en la base,
// para evitar desfases al cargar/liberar varios pallets seguidos.
export async function syncOccupancy(locationId) {
  if (!locationId) return 0;
  const loc = await base44.entities.Location.get(locationId);
  if (!loc) return 0;
  const statuses = STATUS_BY_TYPE[loc.type] || [];
  const all = await base44.entities.Pallet.filter({ location_id: locationId });
  const count = (all || []).filter(p => statuses.includes(p.status)).length;
  if ((loc.occupied || 0) !== count) {
    await base44.entities.Location.update(locationId, { occupied: count });
  }
  return count;
}