import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtKg } from '@/lib/qr';

export default function DashboardProductivity({ metrics, data }) {
  const p=metrics.productivity;
  const occupancy=data.locations.filter(location=>['tunel','camara'].includes(location.type)).map(location=>{
    const pallets=data.pallets.filter(pallet=>!pallet.pendingStatus && pallet.status!=='anulado' && pallet.location_id===location.id);
    const capacity=Number(location.capacity);
    return {location,occupied:pallets.length,capacity:Number.isFinite(capacity)&&capacity>0?capacity:null,kg:pallets.reduce((sum,pallet)=>sum+(Number(pallet.net_weight)||0),0)};
  });
  return <div className="min-w-0 space-y-5">
    <p className="text-sm text-muted-foreground">Volumen del período y stock actual. Los filtros de fecha se aplican a la actividad; el stock incluye todos los días. Cuadro filtra únicamente bines.</p>
    <div className="grid grid-cols-1 min-[380px]:grid-cols-2 xl:grid-cols-4 gap-3">
      <Indicator label="Kg cosechados" value={fmtKg(p.harvestedKg)} detail={`${p.harvestedBins} bines · ${p.unweighedHarvested} todavía sin peso`}/>
      <Indicator label="Kg volcados" value={fmtKg(metrics.binStats.dumpedKg)} detail={`${metrics.binStats.dumpedBins} bines volcados`}/>
      <Indicator label="Kg producidos" value={fmtKg(p.producedKg)} detail={`${p.producedPallets} pallets · ${p.producedPackages} bultos`}/>
      <Indicator label="Kg despachados" value={fmtKg(metrics.shippedKg)} detail={`${metrics.shippedPallets} pallets con salida confirmada`}/>
    </div>
    <p className="text-xs text-muted-foreground">Cosecha usa la fecha declarada de cosecha y el peso neto asignado al pesar el lote; los bines sin peso no suman kilos. Producción usa la fecha de creación de los pallets. Estos totales pueden corresponder a fruta de días distintos y no representan un porcentaje de rendimiento.</p>
    <Card><CardHeader><CardTitle className="text-base">Producción diaria · kg en pallets terminados</CardTitle></CardHeader><CardContent>
      {!p.daily.length?<p className="text-sm text-muted-foreground">Sin producción registrada en el período.</p>:<div className="h-72 min-w-0" role="img" aria-label="Gráfico de producción diaria por producto; los valores también están en la tabla siguiente"><ResponsiveContainer width="100%" height="100%"><BarChart data={p.daily} margin={{top:8,right:8,left:0,bottom:8}}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="day" tickFormatter={day=>day.slice(5).split('-').reverse().join('/')} tick={{fontSize:11}}/><YAxis tick={{fontSize:11}} width={60}/><Tooltip formatter={value=>fmtKg(value)}/><Legend/><Bar dataKey="fresh" name="Fresco" stackId="kg" fill="#184b3b"/><Bar dataKey="aril" name="Arilos" stackId="kg" fill="#8baf4b"/><Bar dataKey="discard" name="Descarte" stackId="kg" fill="#c9ad79"/></BarChart></ResponsiveContainer></div>}
      {p.daily.length>0&&<div className="mt-4"><Rows headers={['Día','Fresco','Arilos','Descarte','Total']} empty={false}>{p.daily.map(day=><tr key={day.day} className="border-b"><td>{day.day.split('-').reverse().join('/')}</td><td>{fmtKg(day.fresh)}</td><td>{fmtKg(day.aril)}</td><td>{fmtKg(day.discard)}</td><td className="font-semibold">{fmtKg(day.fresh+day.aril+day.discard)}</td></tr>)}</Rows></div>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Producción por productor, variedad y categoría</CardTitle></CardHeader><CardContent><Rows headers={['Productor','Variedad','Categoría','Pallets','Bultos','Kilos']} empty={!p.groups.length}>{p.groups.map(row=><tr key={row.id} className="border-b"><td>{row.producer}</td><td>{row.variety}</td><td>{row.category}</td><td>{row.pallets}</td><td>{row.packages}</td><td>{fmtKg(row.kg)}</td></tr>)}</Rows></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Stock por etapa · situación actual</CardTitle></CardHeader><CardContent><Rows headers={['Etapa','Unidades','Kilos conocidos','Sin peso']} empty={false}>{p.stock.map(row=><tr key={row.key} className="border-b"><td>{row.label}</td><td>{row.units}</td><td>{row.unknown&&row.kg===0?'Pendiente de pesado':fmtKg(row.kg)}</td><td>{row.unknown||'—'}</td></tr>)}</Rows><p className="mt-3 text-xs text-muted-foreground">Las primeras cuatro filas cuentan bines; las restantes cuentan pallets. No se suman como una sola unidad de stock.</p></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Ocupación de prefrío y cámaras</CardTitle></CardHeader><CardContent><Rows headers={['Ubicación','Pallets ocupados / capacidad','Lugares libres','Kilos almacenados']} empty={!occupancy.length}>{occupancy.map(({location,occupied,capacity,kg})=><tr key={location.id} className="border-b"><td>{location.name}</td><td>{occupied} / {capacity??'Sin configurar'}</td><td>{capacity===null?'—':Math.max(0,capacity-occupied)}</td><td>{fmtKg(kg)}</td></tr>)}</Rows><p className="mt-3 text-xs text-muted-foreground">Ocupación actual completa de cada ubicación, sin aplicar los filtros de fecha, productor, variedad ni cuadro.</p></CardContent></Card>
    <p className="text-xs text-muted-foreground">{metrics.shipmentsPending} cargas pendientes de despacho. Kg/hora, productividad por persona y rendimiento se incorporarán cuando existan horas efectivas y vínculos de producción verificables.</p>
  </div>;
}
function Indicator({label,value,detail}) {return <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold break-words mt-1">{value}</p><p className="text-xs text-muted-foreground mt-1">{detail}</p></CardContent></Card>;}
function Rows({headers,children,empty}) {return <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-sm text-left [&_td]:p-2 [&_td]:whitespace-nowrap"><thead><tr className="border-b bg-muted/40">{headers.map(h=><th scope="col" className="p-2 font-medium whitespace-nowrap" key={h}>{h}</th>)}</tr></thead><tbody>{empty?<tr><td colSpan={headers.length} className="text-muted-foreground">Sin registros para mostrar.</td></tr>:children}</tbody></table></div>;}
