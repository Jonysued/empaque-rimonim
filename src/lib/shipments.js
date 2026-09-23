import { base44 } from "@/api/base44Client";
import { generateCode } from "@/lib/qr";

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

  await base44.entities.MovementEvent.bulkCreate(
    adding.map(p => ({
      event_code: generateCode("MOV"),
      unit_type: "pallet", unit_id: p.id, unit_code: p.pallet_code,
      destination_location_id: shipment.id, destination_location_name: shipment.load_number,
      action: "carga_despacho",
    }))
  );
}