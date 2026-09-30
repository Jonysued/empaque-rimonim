import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { getOperations } from '@/lib/operationQueue';
import { useAuth } from '@/lib/AuthContext';
import { dashboardMetrics, operationDay, operationDate, durationLabel, STAGE_LABELS } from '@/lib/dashboardMetrics.mjs';
import { fmtKg } from '@/lib/qr';
import LotDetail from '@/components/LotDetail';
import PalletJourney from '@/components/PalletJourney';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Clock, AlertTriangle, Package, Repeat, Snowflake, Truck, Settings2 } from 'lucide-react';
const ENTITIES={lots:'ReceiptLot',bins:'Bin',dumps:'DumpingEvent',pallets:'Pallet',movements:'MovementEvent',shipments:'Shipment',runs:'ProductionRun',locations:'Location',catalogs:'Catalog'};
const EMPTY=Object.fromEntries(Object.keys(ENTITIES).map(k=>[k,[]]));
const overLimit=(ms,key,limits)=>Number(limits[key])>0 && ms!==null && ms>Number(limits[key])*3600000;
export default function Dashboard() {
  const {user}=useAuth();
  const [data,setData]=useState(EMPTY),[loading,setLoading]=useState(true),[error,setError]=useState(''),[pending,setPending]=useState(0),[updated,setUpdated]=useState(null);
  const [filters,setFilters]=useState(()=>({from:operationDay(Date.now()),to:operationDay(Date.now()),producer:'',variety:'',origin:''}));
  const [now,setNow]=useState(Date.now()),[selectedLot,setSelectedLot]=useState(null),[selectedPallet,setSelectedPallet]=useState(null),[settings,setSettings]=useState(false);
  const [draftLimits,setDraftLimits]=useState({}),[saving,setSaving]=useState(false),[settingsError,setSettingsError]=useState('');
  const sequence=useRef(0);
  const refresh=useCallback(async()=>{
    const request=++sequence.current;
    try {
      const values=await Promise.all([...Object.values(ENTITIES).map(entity=>base44.entities[entity].list()),getOperations()]);
      if(request!==sequence.current)return;
      setData(Object.fromEntries(Object.keys(ENTITIES).map((key,i)=>[key,values[i]]))); setPending(values.at(-1).length);
      setUpdated(Date.now());setNow(Date.now());setError('');
    } catch(e) { if(request===sequence.current)setError(e.message || 'No se pudo actualizar el dashboard'); }
    finally {if(request===sequence.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    refresh();
    const tick=setInterval(()=>{setNow(Date.now());if(document.visibilityState==='visible')refresh();},60000);
    window.addEventListener('focus',refresh);window.addEventListener('online',refresh);window.addEventListener('rimonim-queue-change',refresh);
    return()=>{sequence.current++;clearInterval(tick);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);window.removeEventListener('rimonim-queue-change',refresh);};
  },[refresh]);
  const validPeriod=!filters.from || !filters.to || filters.from<=filters.to;
  const metrics=useMemo(()=>dashboardMetrics(data,filters,now),[data,filters,now]);
  const config=data.catalogs.find(c=>c.type==='dashboard_limits' && c.name==='Tiempos por estación');
  const limits=config?.limits || {};
  const options=useMemo(()=>{
    const unique=key=>[...new Set([...data.bins,...data.pallets,...data.lots].flatMap(row=>String(row[key]||'').split(' / ')).filter(Boolean))].sort();
    return {producer:unique('producer'),variety:unique('variety'),origin:[...new Set([...data.bins,...data.lots].flatMap(b=>String(b.origin||'').split(' / ')).filter(Boolean))].sort()};
  },[data.bins,data.pallets,data.lots]);
  const binAlerts=metrics.lotRows.filter(row=>overLimit(row.maxWait, row.lot?.yard_received_at?'dump':row.lot?.weighed_at?'yard':row.lot?.field_closed_at?'weigh':'consolidate',limits)||overLimit(row.maxTotalWait??null,'binTotal',limits));
  const palletAlerts=metrics.pRows.filter(row=>overLimit(row.wait.age,row.wait.key,limits)||overLimit(row.journey.waiting.find(w=>w.key==='palletTotal')?.age??null,'palletTotal',limits));
  const fullCold=data.locations.filter(l=>['tunel','camara'].includes(l.type) && Number(l.capacity)>0 && data.pallets.filter(p=>p.location_id===l.id).length>=Number(l.capacity));
  async function saveLimits() {
    const cleaned=Object.fromEntries(Object.entries(draftLimits).filter(([,v])=>v!=='' && v!=null).map(([key,value])=>[key,Number(value)]));
    if(Object.values(cleaned).some(v=>!Number.isFinite(v)||v<=0))return setSettingsError('Ingresá horas mayores a cero o dejá el campo vacío para desactivar la alerta.');
    setSaving(true);setSettingsError('');
    try { const record={type:'dashboard_limits',name:'Tiempos por estación',limits:cleaned}; if(config)await base44.entities.Catalog.update(config.id,record);else await base44.entities.Catalog.create(record);setSettings(false);await refresh(); }
    catch(e){setSettingsError(e.message);}finally{setSaving(false);}
  }
  if(loading)return <p role="status" className="py-16 text-center text-muted-foreground">Cargando actividad y tiempos del empaque…</p>;
  return <div className="space-y-6">
    <div className="flex items-start justify-between gap-4 flex-wrap"><div><h1 className="text-2xl font-heading font-bold">Dashboard del empaque</h1><p className="text-muted-foreground">Actividad, pendientes y tiempos desde Cosecha hasta despacho</p><p className="text-xs text-muted-foreground mt-1">Actualización automática cada minuto · Hora de San Juan{updated ? ` · Última consulta: ${operationDate(updated)}` : ''}</p></div>
      {['admin','supervisor'].includes(user?.role) && <Button variant="outline" onClick={()=>{setDraftLimits({...limits});setSettingsError('');setSettings(true);}}><Settings2 className="w-4 h-4 mr-2"/> Límites de demora</Button>}
    </div>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-destructive">{error}. {updated?'Se conservan los datos de la última consulta.':'No hay datos disponibles.'}</p>}
    {(!navigator.onLine || pending>0) && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{!navigator.onLine?'Sin conexión: se muestran los últimos datos guardados. ':''}{pending>0?`${pending} operaciones de este dispositivo pendientes de sincronizar o revisar. `:''}Los saldos y promedios muestran registros confirmados; las operaciones pendientes se incorporan al sincronizar.</p>}
    <Card><CardContent className="p-4 flex flex-wrap items-end gap-3">
      <FilterDate label="Desde" value={filters.from} onChange={v=>setFilters(f=>({...f,from:v}))}/><FilterDate label="Hasta" value={filters.to} onChange={v=>setFilters(f=>({...f,to:v}))}/>
      <Button variant="outline" onClick={()=>setFilters(f=>({...f,from:operationDay(now),to:operationDay(now)}))}>Hoy</Button><Button variant="ghost" onClick={()=>setFilters(f=>({...f,from:'',to:''}))}>Todo el historial</Button>
      {['producer','variety','origin'].map(key=><label key={key} className="space-y-1 text-xs text-muted-foreground">{({producer:'Productor',variety:'Variedad',origin:'Cuadro · bines'})[key]}<select aria-label={({producer:'Productor',variety:'Variedad',origin:'Cuadro · bines'})[key]} className="block h-10 max-w-56 rounded-md border bg-background px-3 text-sm text-foreground" value={filters[key]} onChange={e=>setFilters(f=>({...f,[key]:e.target.value}))}><option value="">Todos</option>{options[key].map(v=><option key={v}>{v}</option>)}</select></label>)}
    </CardContent></Card>
    {!validPeriod ? <p role="alert" className="text-destructive">La fecha Desde no puede ser posterior a Hasta.</p> : <>
      <p className="text-xs text-muted-foreground">Actividad y promedios del período seleccionado. Los pendientes incluyen todos los días y respetan los filtros de productor y variedad; Cuadro se aplica a bines. Promedios calculados con tramos terminados en el período, por unidad; las permanencias repetidas se suman por pallet.</p>
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <Metric icon={Package} label="Bines cosechados · período" value={metrics.binStats.harvested}/><Metric icon={Package} label="Bines sin consolidar" value={metrics.binStats.unconsolidated}/>
        <Metric icon={Clock} label="Lotes pendientes de pesar" value={metrics.binStats.unweighed} detail={`${metrics.binStats.unweighedBins} bines`}/><Metric icon={Repeat} label="Pendientes de vuelco" value={`${metrics.binStats.dumpPending} bines`} detail={fmtKg(metrics.binStats.dumpKg)}/>
        <Metric icon={Repeat} label="Volcado · período" value={fmtKg(metrics.binStats.dumpedKg)} detail={`${metrics.binStats.dumpedBins} bines`}/>
      </div>
      {(binAlerts.length+palletAlerts.length+metrics.held.length+fullCold.length)>0 && <Card className="border-amber-300 bg-amber-50"><CardContent className="p-4 text-sm text-amber-900"><p className="font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>Alertas de la operación</p><p>{binAlerts.length} grupos de bines y {palletAlerts.length} pallets superan su límite de espera.</p>{metrics.held.map(item=><p key={item}>{item}</p>)}{fullCold.map(l=><p key={l.id}>{l.name}: capacidad completa</p>)}</CardContent></Card>}
      <Times title="Tiempos de bines entre estaciones" rows={metrics.binTimes} unit="Bines" limits={limits}/>
      <Times title="Tiempos de pallets hasta el despacho" rows={metrics.palletTimes} unit="Pallets" limits={limits}/>
      <Card><CardHeader><CardTitle className="text-base">Bines y lotes pendientes · mayor espera primero</CardTitle></CardHeader><CardContent><DataTable headers={['Lote','Productor / cuadro','Estación pendiente','Bines','Kilos pendientes','Mayor espera']} empty={!metrics.lotRows.length}>{metrics.lotRows.map(row=><tr key={row.id} className="border-b"><td className="p-2">{row.lot?<button className="text-blue-700 font-mono underline text-left" onClick={()=>setSelectedLot(row.lot.id)}>{row.code}</button>:row.code}</td><td className="p-2">{[...row.producers].join(' / ')}<p className="text-xs text-muted-foreground">{[...row.origins].join(' / ')}</p></td><td className="p-2">{row.station}</td><td className="p-2">{row.count}</td><td className="p-2">{row.kg===null?'Pendiente de pesado':fmtKg(row.kg)}</td><td className="p-2 whitespace-nowrap">{durationLabel(row.maxWait)}{row.unknown>0 && <p className="text-xs text-muted-foreground">Hay fechas incompletas</p>}</td></tr>)}</DataTable></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Pallets pendientes · mayor espera primero</CardTitle></CardHeader><CardContent><DataTable headers={['Pallet','Producto / productor','Estación actual','Kilos','Espera actual','Desde creación']} empty={!metrics.pRows.length}>{metrics.pRows.map(({pallet,wait,journey})=><tr key={pallet.id} className="border-b"><td className="p-2"><button className="text-blue-700 font-mono underline text-left" onClick={()=>setSelectedPallet(pallet.id)}>{pallet.romaneo_number||pallet.pallet_code}</button></td><td className="p-2">{pallet.product_type==='fresco'?'Fresco':'Arilos'}<p className="text-xs text-muted-foreground">{pallet.producer||'—'}</p></td><td className="p-2">{wait.location}{pallet.held && <p className="text-amber-800">Retenido por calidad</p>}</td><td className="p-2">{fmtKg(pallet.net_weight)}</td><td className={`p-2 whitespace-nowrap ${overLimit(wait.age,wait.key,limits)?'text-amber-800 font-bold':''}`}>{durationLabel(wait.age)}</td><td className="p-2 whitespace-nowrap">{durationLabel(journey.waiting.find(w=>w.key==='palletTotal')?.age)}</td></tr>)}</DataTable></CardContent></Card>
      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3"><Metric icon={Package} label="Fresco · producción del período" value={fmtKg(metrics.production.fresh)}/><Metric icon={Package} label="Arilos · producción del período" value={fmtKg(metrics.production.aril)}/><Metric icon={Package} label="Descarte · producción del período" value={fmtKg(metrics.production.discard)}/><Metric icon={Truck} label="Cargas pendientes" value={metrics.shipmentsPending}/><Metric icon={Truck} label="Despachado · período" value={fmtKg(metrics.shippedKg)} detail={`${metrics.shippedPallets} pallets con salida confirmada`}/></div>
      <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Snowflake className="w-4 h-4"/>Prefrío y cámaras · stock actual</CardTitle></CardHeader><CardContent><DataTable headers={['Ubicación','Pallets filtrados','Ocupación total / capacidad','Kilos filtrados','Mayor permanencia actual']} empty={!metrics.cold.length}>{metrics.cold.map(({location,pallets,oldest})=><tr key={location.id} className="border-b"><td className="p-2">{location.name}</td><td className="p-2">{pallets.length}</td><td className="p-2">{data.pallets.filter(p=>p.location_id===location.id).length} / {location.capacity||'—'}</td><td className="p-2">{fmtKg(pallets.reduce((s,p)=>s+(Number(p.net_weight)||0),0))}</td><td className="p-2">{durationLabel(oldest)}</td></tr>)}</DataTable></CardContent></Card>
      <p className="text-xs text-muted-foreground">Los datos históricos sin fechas completas no aportan tiempos estimados. {metrics.incompleteBins} bines sin fecha individual de Cosecha; {metrics.missingDispatch} pallets enviados sin fecha de salida verificable.{metrics.invalidIntervals>0?` ${metrics.invalidIntervals} tramos de pallets incompletos o fuera de secuencia no se incluyen en los promedios.`:''} Producción se atribuye a la fecha de la corrida; no se distribuye entre días sin registros diarios.</p>
    </>}
    {selectedLot && data.lots.find(l=>l.id===selectedLot) && <LotDetail lot={data.lots.find(l=>l.id===selectedLot)} bins={data.bins.filter(b=>b.receipt_lot_id===selectedLot)} onClose={()=>setSelectedLot(null)} onUpdated={refresh}/>}
    {selectedPallet && data.pallets.find(p=>p.id===selectedPallet) && <Dialog open onOpenChange={()=>setSelectedPallet(null)}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Pallet {data.pallets.find(p=>p.id===selectedPallet).romaneo_number}</DialogTitle></DialogHeader><PalletJourney pallet={data.pallets.find(p=>p.id===selectedPallet)} movements={data.movements} shipments={data.shipments}/></DialogContent></Dialog>}
    {settings && <Dialog open onOpenChange={()=>!saving&&setSettings(false)}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Límites de demora por estación</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Horas máximas de espera actual. Dejá vacío para no generar una alerta. Se guardan para todos los usuarios.</p><div className="space-y-3">{Object.entries(STAGE_LABELS).map(([key,label])=><label key={key} className="flex items-center justify-between gap-4 text-sm">{label}<Input aria-label={`Límite en horas: ${label}`} type="number" min="0.1" step="0.1" className="w-24" value={draftLimits[key]??''} onChange={e=>setDraftLimits(l=>({...l,[key]:e.target.value}))}/></label>)}</div>{settingsError&&<p role="alert" className="text-destructive text-sm">{settingsError}</p>}<Button disabled={saving} onClick={saveLimits}>{saving?'Guardando…':'Guardar límites'}</Button></DialogContent></Dialog>}
  </div>;
}
function FilterDate({label,value,onChange}) {return <label className="space-y-1 text-xs text-muted-foreground">{label}<Input type="date" aria-label={label} value={value} onChange={e=>onChange(e.target.value)} className="w-40"/></label>;}
function Metric({icon:Icon,label,value,detail=undefined}) {return <Card><CardContent className="p-4"><Icon className="w-4 h-4 mb-2 text-muted-foreground"/><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold mt-1">{value}</p>{detail&&<p className="text-xs text-muted-foreground mt-1">{detail}</p>}</CardContent></Card>;}
function DataTable({headers,children,empty}) {return <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr className="border-b bg-muted/40">{headers.map(h=><th key={h} scope="col" className="p-2 font-medium whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{empty?<tr><td className="p-4 text-muted-foreground" colSpan={headers.length}>Sin registros para mostrar.</td></tr>:children}</tbody></table></div>;}
function Times({title,rows,unit,limits}) {return <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4"/>{title}</CardTitle></CardHeader><CardContent><DataTable headers={['Tramo','Promedio',`${unit} medidos`,`${unit} pendientes`,'Mayor espera actual']} empty={false}>{rows.map(row=><tr key={row.key} className={`border-b ${row.key.endsWith('Total')?'bg-blue-50 font-semibold':''}`}><td className="p-2">{row.label}</td><td className="p-2 whitespace-nowrap">{durationLabel(row.average)}</td><td className="p-2">{row.count}</td><td className="p-2">{row.pending}</td><td className={`p-2 whitespace-nowrap ${overLimit(row.maxWait,row.key,limits)?'text-amber-800 font-bold':''}`}>{durationLabel(row.maxWait)}{row.unknown>0&&<p className="text-xs text-muted-foreground font-normal">{row.unknown} sin fecha</p>}</td></tr>)}</DataTable></CardContent></Card>;}
