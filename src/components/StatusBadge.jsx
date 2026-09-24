import React from "react";
import { cn } from "@/lib/utils";

const STATUS_COLORS = {
  recibido: "bg-blue-100 text-blue-800",
  parcialmente_volcado: "bg-amber-100 text-amber-800",
  volcado: "bg-green-100 text-green-800",
  retenido: "bg-red-100 text-red-800",
  disponible: "bg-blue-100 text-blue-800",
  descartado: "bg-gray-200 text-gray-700",
  abierta: "bg-blue-100 text-blue-800",
  cerrada: "bg-gray-200 text-gray-700",
  armado: "bg-amber-100 text-amber-800",
  parcial: "bg-amber-100 text-amber-800",
  en_tunel: "bg-cyan-100 text-cyan-800",
  prefrio_finalizado: "bg-teal-100 text-teal-800",
  en_camara: "bg-indigo-100 text-indigo-800",
  reservado: "bg-purple-100 text-purple-800",
  despachado: "bg-green-100 text-green-800",
  liberado: "bg-green-100 text-green-800",
  borrador: "bg-gray-100 text-gray-700",
  cargado: "bg-blue-100 text-blue-800",
  enviado: "bg-green-100 text-green-800",
  anulado: "bg-red-100 text-red-800",
  activa: "bg-red-100 text-red-800",
  libre: "bg-green-100 text-green-800",
};

const LABELS = {
  recibido: "Recibido",
  parcialmente_volcado: "Parcialmente volcado",
  volcado: "Volcado",
  retenido: "Retenido",
  disponible: "Disponible",
  descartado: "Descartado",
  abierta: "Abierta",
  cerrada: "Cerrada",
  armado: "Terminado",
  parcial: "Parcial",
  en_tunel: "En túnel",
  prefrio_finalizado: "Prefrío finalizado",
  en_camara: "En cámara",
  reservado: "Reservado",
  despachado: "Despachado",
  liberado: "Liberado",
  borrador: "Borrador",
  cargado: "Cargado",
  enviado: "Enviado",
  anulado: "Anulado",
  activa: "Retención activa",
  libre: "Libre",
};

/** @param {{ status: string, className?: string, label?: string }} props */
export default function StatusBadge({ status, className, label: customLabel }) {
  const color = STATUS_COLORS[status] || "bg-gray-100 text-gray-700";
  const label = customLabel || LABELS[status] || status;
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium", color, className)}>
      {label}
    </span>
  );
}
