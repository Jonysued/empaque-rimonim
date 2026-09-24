import React from "react";
import { History } from "lucide-react";

const ACTION_LABELS = {
  vuelco: "Vuelco",
  carga_tunel: "Carga a túnel",
  liberacion_tunel: "Liberación de túnel",
  carga_camara: "Ingreso a cámara",
  traslado: "Traslado / retiro",
  reserva: "Reserva para despacho",
  carga_despacho: "Carga a despacho",
  retiro_despacho: "Corrección: retiro de despacho",
  descarga: "Descarga",
  retencion: "Retención por calidad",
  liberacion_calidad: "Liberación por calidad",
};

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function fmtDuration(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "< 1 min";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remM = mins % 60;
  if (hours < 24) return remM ? `${hours} h ${remM} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH ? `${days} d ${remH} h` : `${days} d`;
}

export default function MovementTimeline({ movements }) {
  const events = [...(movements || [])].sort((a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime());
  return (
    <div className="border rounded-lg p-3">
      <p className="text-xs font-medium flex items-center gap-1 mb-2 text-muted-foreground">
        <History className="w-3.5 h-3.5" /> Historial de movimientos ({events.length})
      </p>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin movimientos registrados.</p>
      ) : (
        <div className="space-y-1">
          {events.map((m, i) => {
            const prev = i > 0 ? events[i - 1] : null;
            const elapsed = prev && prev.created_date && m.created_date
              ? fmtDuration(new Date(m.created_date).getTime() - new Date(prev.created_date).getTime())
              : null;
            return (
              <div key={m.id} className="border-l-2 border-muted pl-2 py-1 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{ACTION_LABELS[m.action] || m.action}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(m.created_date)}</span>
                </div>
                {elapsed && <p className="text-xs font-medium text-blue-600">+{elapsed} desde el movimiento anterior</p>}
                <p className="text-xs text-muted-foreground">
                  {m.origin_location_name ? `${m.origin_location_name} → ` : ""}{m.destination_location_name || ""}
                  {m.notes ? ` · ${m.notes}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
