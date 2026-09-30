import React from 'react';
import { fmtKg, fmtDay } from '@/lib/qr';
export default function BinInfo({ bin }) {
  const rows = [['Productor',bin.producer],['Variedad',bin.variety],['Procedencia/Cuadro',bin.origin],['Especie',bin.species],
    ['Tipo de cosecha',bin.harvest_type],['Cuadrilla',bin.crew],['Fecha de cosecha',fmtDay(bin.harvest_date ? `${bin.harvest_date}T12:00:00` : null)],
    ...(bin.crew === 'MIXTO' ? (bin.crew_breakdown || []).map((item,i)=>[`Cuadrilla ${i+1}`,item.crew]) : []),
    ['Peso prorrateado',bin.net_weight != null ? fmtKg(bin.net_weight) : 'Sin pesar'],['Notas de calidad',bin.quality_notes]];
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">{rows.map(([label,value]) => <div key={label} className="flex justify-between gap-3 border-b pb-1"><span className="text-muted-foreground">{label}</span><span className="font-medium text-right">{value || '—'}</span></div>)}</div>;
}
