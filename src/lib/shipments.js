import { base44 } from "@/api/base44Client";
import { generateCode } from "@/lib/qr";
import { syncOccupancy } from "@/lib/occupancy";

// Estados de pallet disponibles para armar una carga:
// liberados del prefrio o de las cámaras
export const AVAILABLE_FOR_SHIPMENT = ["prefrio_finalizado", "liberado"];

// Carga uno o más pallets en un despacho: actualiza totales,
// marca los pallets como despachados y registra los movimientos.
export async function loadPalletsIntoShipment(shipment, palletsToAdd) {
  if (!shipment || !palletsToAdd || palletsToAdd.length === 0) return;

  const currentIds = shipment.loaded_pallet_ids || [];
  const adding = palletsToAdd.filter(p => !currentIds.includes(p.id));
  if (adding.length === 0) return;
  if (adding.some(p => !AVAILABLE_FOR_SHIPMENT.includes(p.status) || p.product_type !== shipment.product_type)) {
    throw new Error("La carga contiene pallets no disponibles o de otro producto");
  }
  if (currentIds.length + adding.length > (shipment.target_capacity || 21)) {
    throw new Error("Capacidad de carga alcanzada");
  }

  const loaded = [...currentIds, ...adding.map(p => p.id)];
  const totalWeight = (shipment.total_weight || 0) + adding.reduce((s, p) => s + (p.net_weight || 0), 0);
  const totalPackages = (shipment.total_packages || 0) + adding.reduce((s, p) => s + (p.package_count || 0), 0);

  await base44.entities.Shipment.update(shipment.id, {
    loaded_pallet_ids: loaded,
    total_weight: totalWeight,
    total_packages: totalPackages,
    status: loaded.length > 0 ? "cargado" : "borrador",
  });

  await base44.entities.Pallet.bulkUpdate(
    adding.map(p => ({ id: p.id, status: "despachado", shipment_id: shipment.id }))
  );

  // Un pallet que sale de una cámara deja de ocupar esa ubicación.
  for (const pallet of adding.filter(p => p.location_id)) {
    await base44.entities.Pallet.updateMany(
      { id: pallet.id },
      { $unset: { location_id: "", location_name: "" } }
    );
  }
  for (const locationId of new Set(adding.map(p => p.location_id).filter(Boolean))) {
    await syncOccupancy(locationId);
  }

  await base44.entities.MovementEvent.bulkCreate(
    adding.map(p => ({
      event_code: generateCode("MOV"),
      unit_type: "pallet", unit_id: p.id, unit_code: p.pallet_code,
      origin_location_id: p.location_id, origin_location_name: p.location_name,
      destination_location_id: shipment.id, destination_location_name: shipment.load_number,
      action: "carga_despacho",
    }))
  );
}
