import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { palletJourney, durationLabel, operationDate, PALLET_STAGES } from '@/lib/dashboardMetrics.mjs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
const labels = {carga_tunel:'Ingreso a prefrío',liberacion_tunel:'Salida de prefrío',carga_camara:'Ingreso a cámara',traslado:'Salida / traslado de cámara',retiro_camara:'Salida de cámara',carga_despacho:'Carga en transporte',retiro_despacho:'Retiro de carga por corrección',salida_despacho:'Despacho confirmado'};
export default function PalletJourney({pallet, movements = undefined, shipments = undefined}) {
  const [data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    setData(null); setError('');
    if(movements && shipments) { setData(palletJourney(pallet,movements,shipments)); return; }
    Promise.all([base44.entities.MovementEvent.list(),base44.entities.Shipment.list()])
      .then(([ms,ss])=>{if(active)setData(palletJourney(pallet,ms,ss));}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[pallet,movements,shipments]);
  return <Card><CardHeader className="pb-2"><CardTitle className="text-base">Recorrido y tiempos del pallet</CardTitle></CardHeader><CardContent className="space-y-3">
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !data ? <p className="text-sm text-muted-foreground">Cargando historial…</p> : <>
      <p className="text-sm">{data.dispatch!==null ? 'Tiempo total hasta despacho: ' : 'Tiempo desde creación: '}<b>{durationLabel(data.dispatch!==null ? data.dispatch-new Date(pallet.created_date).getTime() : data.missingDispatch ? null : Date.now()-new Date(pallet.created_date).getTime())}</b></p>
      {data.missingDispatch && <p className="text-xs text-amber-800">Despacho histórico sin fecha de salida registrada. El tiempo total no se puede calcular.</p>}
      <div className="text-sm space-y-1">{PALLET_STAGES.filter(([key])=>key!=='palletTotal').map(([key,label])=>{const samples=data.intervals.filter(s=>s.key===key);return <div key={key} className="flex justify-between gap-3 border-b pb-1"><span>{label}</span><b className="whitespace-nowrap">{samples.length?durationLabel(samples.reduce((sum,s)=>sum+s.ms,0)):'—'}</b></div>;})}</div>
      <p className="text-xs text-muted-foreground">Permanencias completadas; los reingresos se suman. La espera actual figura debajo del historial.</p>
      <div className="space-y-2">{data.rows.map(row=><div key={row.id} className="border-l-2 pl-3 text-sm"><div className="flex justify-between gap-3"><b>{labels[row.action]||row.action}</b><span className="text-xs text-muted-foreground">{row.at!==null?operationDate(row.at):'Sin fecha'}</span></div><p className="text-xs text-muted-foreground">{row.location}{row.elapsed!==null && row.elapsed!==undefined ? ` · ${durationLabel(row.elapsed)} desde el movimiento anterior` : ''}</p></div>)}</div>
      {data.waiting[0] && <p className="text-sm bg-muted rounded p-2">En {data.waiting[0].location}: <b>{durationLabel(data.waiting[0].age)}</b></p>}
    </>}
  </CardContent></Card>;
}
