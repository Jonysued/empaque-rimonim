import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { getOperations } from '@/lib/operationQueue';
import { subscribeOperationalRefresh } from '@/lib/operationalRefresh.mjs';
import { useAuth } from '@/lib/AuthContext';
import { dashboardMetrics, operationDay, operationDate, durationLabel, normalizeFilter, STAGE_LABELS } from '@/lib/dashboardMetrics.mjs';
import { fmtKg } from '@/lib/qr';
import LotDetail from '@/components/LotDetail';
import DashboardProductivity from '@/components/DashboardProductivity';
import PalletJourney from '@/components/PalletJourney';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Clock, AlertTriangle, Settings2 } from 'lucide-react';
const ENTITIES={lots:'ReceiptLot',bins:'Bin',dumps:'DumpingEvent',pallets:'Pallet',movements:'MovementEvent',shipments:'Shipment',cycles:'CoolingCycle',locations:'Location',catalogs:'Catalog'};
const EMPTY=Object.fromEntries(Object.keys(ENTITIES).map(k=>[k,[]]));
const overLimit=(ms,key,limits)=>Number(limits[key])>0 && ms!==null && ms>Number(limits[key])*3600000;
export default function Dashboard() {
  const {user}=useAuth();
  const [data,setData]=useState(EMPTY),[loading,setLoading]=useState(true),[error,setError]=useState(''),[pending,setPending]=useState(0),[updated,setUpdated]=useState(null);
  const [filters,setFilters]=useState(()=>({from:operationDay(Date.now()),to:operationDay(Date.now()),producer:'',variety:'',origin:''}));
  const [now,setNow]=useState(Date.now()),[selectedLot,setSelectedLot]=useState(null),[selectedPallet,setSelectedPallet]=useState(null),[settings,setSettings]=useState(false);
  const [draftLimits,setDraftLimits]=useState({}),[saving,setSaving]=useState(false),[settingsError,setSettingsError]=useState('');
  const [activeSection,setActiveSection]=useState('times'),[selectedStage,setSelectedStage]=useState(null);
  const sequence=useRef(0);
  const refresh=useCallback(async()=>{
    const request=++sequence.current;
    try {
      const values=await Promise.all([...Object.values(ENTITIES).map(entity=>base44.entities[entity].listConfirmed()),getOperations()]);
      if(request!==sequence.current)return;
      setData(Object.fromEntries(Object.keys(ENTITIES).map((key,i)=>[key,values[i]]))); setPending(values.at(-1).length);
      setUpdated(Date.now());setNow(Date.now());setError('');
    } catch(e) { if(request===sequence.current)setError(e.message || 'No se pudo actualizar el dashboard'); }
    finally {if(request===sequence.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    const stop=subscribeOperationalRefresh(refresh,{intervalMs:60000,onTick:()=>setNow(Date.now())});
    return()=>{sequence.current++;stop();};
  },[refresh]);
  const validPeriod=!filters.from || !filters.to || filters.from<=filters.to;
  const metrics=useMemo(()=>dashboardMetrics(data,filters,now),[data,filters,now]);
  const config=data.catalogs.find(c=>c.type==='dashboard_limits' && c.name==='Tiempos por estación');
  const limits=config?.limits || {};
  const options=useMemo(()=>{
    const unique=key=>[...new Map([...data.bins,...data.pallets,...data.lots].flatMap(row=>String(row[key]||'').split(' / ')).filter(Boolean).map(value=>[normalizeFilter(value),normalizeFilter(value)])).values()].sort();
    return {producer:unique('producer'),variety:unique('variety'),origin:unique('origin')};
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
  return <div className="min-w-0 space-y-6">
    <div className="flex items-start justify-between gap-4 flex-wrap"><div><h1 className="text-2xl font-heading font-bold">Dashboard del empaque</h1><p className="text-muted-foreground">Actividad, pendientes y tiempos desde Cosecha hasta despacho</p><p className="text-xs text-muted-foreground mt-1">Actualización automática cada minuto · Hora de San Juan{updated ? ` · Última consulta: ${operationDate(updated)}` : ''}</p></div>
      {['admin','supervisor'].includes(user?.role) && <Button variant="outline" onClick={()=>{setDraftLimits({...limits});setSettingsError('');setSettings(true);}}><Settings2 className="w-4 h-4 mr-2"/> Objetivos y límites</Button>}
    </div>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-destructive">{error}. {updated?'Se conservan los datos de la última consulta.':'No hay datos disponibles.'}</p>}
    {(!navigator.onLine || pending>0) && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{!navigator.onLine?'Sin conexión: se muestran los últimos datos guardados. ':''}{pending>0?`${pending} operaciones de este dispositivo pendientes de sincronizar o revisar. `:''}Los saldos y promedios muestran registros confirmados; las operaciones pendientes se incorporan al sincronizar.</p>}
    <Card><CardContent className="p-4 flex flex-wrap items-end gap-3">
      <FilterDate label="Desde" value={filters.from} onChange={v=>setFilters(f=>({...f,from:v}))}/><FilterDate label="Hasta" value={filters.to} onChange={v=>setFilters(f=>({...f,to:v}))}/>
      <Button variant="outline" onClick={()=>setFilters(f=>({...f,from:operationDay(now),to:operationDay(now)}))}>Hoy</Button><Button variant="ghost" onClick={()=>setFilters(f=>({...f,from:'',to:''}))}>Todo el historial</Button>
      {['producer','variety','origin'].map(key=><label key={key} className="min-w-0 w-full sm:w-auto space-y-1 text-xs text-muted-foreground">{({producer:'Productor',variety:'Variedad',origin:'Cuadro · bines'})[key]}<select aria-label={({producer:'Productor',variety:'Variedad',origin:'Cuadro · bines'})[key]} className="block h-10 w-full max-w-full sm:max-w-56 rounded-md border bg-background px-3 text-sm text-foreground" value={filters[key]} onChange={e=>setFilters(f=>({...f,[key]:e.target.value}))}><option value="">Todos</option>{options[key].map(v=><option key={v}>{v}</option>)}</select></label>)}
    </CardContent></Card>
    {!validPeriod ? <p role="alert" className="text-destructive">La fecha Desde no puede ser posterior a Hasta.</p> : <>
      <p className="text-xs text-muted-foreground">Actividad y promedios del período seleccionado. Los pendientes incluyen todos los días y respetan los filtros de productor y variedad; Cuadro se aplica a bines. Promedios calculados con tramos terminados en el período, por unidad; las permanencias repetidas se suman por pallet.</p>
      <nav aria-label="Secciones del dashboard" className="grid grid-cols-2 gap-2 lg:hidden">
        <Button variant={activeSection==='times'?'default':'outline'} className="h-auto min-h-11 whitespace-normal" aria-pressed={activeSection==='times'} onClick={()=>setActiveSection('times')}>Tiempos de proceso</Button>
        <Button variant={activeSection==='productivity'?'default':'outline'} className="h-auto min-h-11 whitespace-normal" aria-pressed={activeSection==='productivity'} onClick={()=>setActiveSection('productivity')}>Productividad</Button>
      </nav>
      {(binAlerts.length+palletAlerts.length+metrics.held.length+fullCold.length)>0 && <Card className="border-amber-300 bg-amber-50"><CardContent className="p-4 text-sm text-amber-900"><p className="font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>Alertas de la operación</p><p>{binAlerts.length} grupos de bines y {palletAlerts.length} pallets superan su límite de espera.</p>{metrics.held.map(item=><p key={item}>{item}</p>)}{fullCold.map(l=><p key={l.id}>{l.name}: capacidad completa</p>)}</CardContent></Card>}
      <section aria-labelledby="dashboard-times" className={`min-w-0 space-y-5 ${activeSection==='times'?'block':'hidden'} lg:block`}>
        <div><h2 id="dashboard-times" className="text-xl font-semibold">Tiempos de proceso</h2><p className="text-sm text-muted-foreground">Dónde espera la fruta y cuánto demora cada etapa.</p></div>
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 xl:grid-cols-4 gap-3">
          {[['Cosecha → recepción en empaque',metrics.binTimes.find(r=>r.key==='harvestToYard')],['Recepción → vuelco',metrics.binTimes.find(r=>r.key==='dump')],['Pallet terminado → prefrío',metrics.palletTimes.find(r=>r.key==='toTunnel')],['Pallet terminado → despacho',metrics.palletTimes.find(r=>r.key==='palletTotal')]].map(([label,row])=><Metric key={label} icon={Clock} label={label} value={durationLabel(row?.average)} detail={`${row?.count||0} unidades con etapa terminada`}/>)}
        </div>
      <Times title="Tiempos de bines entre estaciones" rows={metrics.binTimes} unit="Bines" limits={limits} onSelect={row=>setSelectedStage({...row,unit:"bin"})}/>
      <Times title="Tiempos de pallets hasta el despacho" rows={metrics.palletTimes} unit="Pallets" limits={limits} onSelect={row=>setSelectedStage({...row,unit:"pallet"})}/>
      <Card><CardHeader><CardTitle className="text-base">Bines y lotes pendientes · mayor espera primero</CardTitle></CardHeader><CardContent><DataTable headers={['Lote','Productor / cuadro','Estación pendiente','Bines','Kilos pendientes','Mayor espera']} empty={!metrics.lotRows.length}>{metrics.lotRows.map(row=><tr key={row.id} className="border-b"><td className="p-2">{row.lot?<button className="text-blue-700 font-mono underline text-left" onClick={()=>setSelectedLot(row.lot.id)}>{row.code}</button>:row.code}</td><td className="p-2">{[...row.producers].join(' / ')}<p className="text-xs text-muted-foreground">{[...row.origins].join(' / ')}</p></td><td className="p-2">{row.station}</td><td className="p-2">{row.count}</td><td className="p-2">{row.kg===null?'Pendiente de pesado':fmtKg(row.kg)}</td><td className="p-2 whitespace-nowrap">{durationLabel(row.maxWait)}{row.unknown>0 && <p className="text-xs text-muted-foreground">Hay fechas incompletas</p>}</td></tr>)}</DataTable></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Pallets pendientes · mayor espera primero</CardTitle></CardHeader><CardContent><DataTable headers={['Pallet','Producto / productor','Estación actual','Kilos','Espera actual','Desde creación']} empty={!metrics.pRows.length}>{metrics.pRows.map(({pallet,wait,journey})=><tr key={pallet.id} className="border-b"><td className="p-2"><button className="text-blue-700 font-mono underline text-left" onClick={()=>setSelectedPallet(pallet.id)}>{pallet.romaneo_number||pallet.pallet_code}</button></td><td className="p-2">{pallet.product_type==='fresco'?'Fresco':'Arilos'}<p className="text-xs text-muted-foreground">{pallet.producer||'—'}</p></td><td className="p-2">{wait.location}{pallet.held && <p className="text-amber-800">Retenido por calidad</p>}</td><td className="p-2">{fmtKg(pallet.net_weight)}</td><td className={`p-2 whitespace-nowrap ${overLimit(wait.age,wait.key,limits)?'text-amber-800 font-bold':''}`}>{durationLabel(wait.age)}</td><td className="p-2 whitespace-nowrap">{durationLabel(journey.waiting.find(w=>w.key==='palletTotal')?.age)}</td></tr>)}</DataTable></CardContent></Card>
      <p className="text-xs text-muted-foreground">Los datos históricos sin fechas completas no aportan tiempos estimados. {metrics.incompleteBins} bines sin fecha individual de Cosecha; {metrics.missingDispatch} pallets enviados sin fecha de salida verificable.{metrics.invalidIntervals>0?` ${metrics.invalidIntervals} tramos de pallets incompletos o fuera de secuencia no se incluyen en los promedios.`:''} El prefrío efectivo usa inicio y fin de los ciclos; la permanencia en túnel incluye las esperas antes y después del proceso.</p>
      </section>
      <section aria-labelledby="dashboard-productivity" className={`min-w-0 space-y-5 ${activeSection==='productivity'?'block':'hidden'} lg:block`}>
        <div><h2 id="dashboard-productivity" className="text-xl font-semibold">Productividad</h2><p className="text-sm text-muted-foreground">Cuánto se hizo y qué volumen queda en cada etapa.</p></div>
        <DashboardProductivity metrics={metrics} data={data}/>
      </section>
    </>}
    {selectedStage && <Dialog open onOpenChange={()=>setSelectedStage(null)}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{selectedStage.label}</DialogTitle></DialogHeader><p className="text-xs text-muted-foreground">Etapas terminadas en el período y pendientes actuales, de todos los días.</p><DataTable headers={['Unidad','Situación','Tiempo']} empty={!selectedStage.samples.length&&!selectedStage.waiting.length}>{[...selectedStage.samples.map(sample=>({...sample,state:'Etapa terminada',duration:sample.ms})),...selectedStage.waiting.map(wait=>({...wait,state:'Pendiente actual',duration:wait.age}))].map(sample=>{const unit=(selectedStage.unit==='bin'?data.bins:data.pallets).find(item=>item.id===sample.id);return <tr key={`${sample.state}:${sample.id}`} className="border-b"><td className="p-2">{unit?.bin_code||unit?.romaneo_number||unit?.pallet_code||sample.id}</td><td className="p-2">{sample.state}</td><td className="p-2">{durationLabel(sample.duration)}</td></tr>;})}</DataTable></DialogContent></Dialog>}
    {selectedLot && data.lots.find(l=>l.id===selectedLot) && <LotDetail lot={data.lots.find(l=>l.id===selectedLot)} bins={data.bins.filter(b=>b.receipt_lot_id===selectedLot)} onClose={()=>setSelectedLot(null)} onUpdated={refresh}/>}
    {selectedPallet && data.pallets.find(p=>p.id===selectedPallet) && <Dialog open onOpenChange={()=>setSelectedPallet(null)}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Pallet {data.pallets.find(p=>p.id===selectedPallet).romaneo_number}</DialogTitle></DialogHeader><PalletJourney pallet={data.pallets.find(p=>p.id===selectedPallet)} movements={data.movements} shipments={data.shipments}/></DialogContent></Dialog>}
    {settings && <Dialog open onOpenChange={()=>!saving&&setSettings(false)}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Objetivos y límites por estación</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Horas de referencia para comparar el promedio y alertar sobre la espera actual. Dejá vacío para desactivar el objetivo. Se guardan para todos los usuarios.</p><div className="space-y-3">{Object.entries(STAGE_LABELS).map(([key,label])=><label key={key} className="flex items-center justify-between gap-4 text-sm">{label}<Input aria-label={`Límite en horas: ${label}`} type="number" min="0.1" step="0.1" className="w-24" value={draftLimits[key]??''} onChange={e=>setDraftLimits(l=>({...l,[key]:e.target.value}))}/></label>)}</div>{settingsError&&<p role="alert" className="text-destructive text-sm">{settingsError}</p>}<Button disabled={saving} onClick={saveLimits}>{saving?'Guardando…':'Guardar límites'}</Button></DialogContent></Dialog>}
  </div>;
}
function FilterDate({label,value,onChange}) {return <label className="min-w-0 w-full sm:w-auto space-y-1 text-xs text-muted-foreground">{label}<Input type="date" aria-label={label} value={value} onChange={e=>onChange(e.target.value)} className="dashboard-date-input block box-border min-w-0 w-full max-w-full sm:w-40"/></label>;}
function Metric({icon:Icon,label,value,detail=undefined}) {return <Card><CardContent className="p-4"><Icon className="w-4 h-4 mb-2 text-muted-foreground"/><p className="text-xs text-muted-foreground">{label}</p><p className="break-words text-xl font-bold mt-1">{value}</p>{detail&&<p className="text-xs text-muted-foreground mt-1">{detail}</p>}</CardContent></Card>;}
function DataTable({headers,children,empty}) {return <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-sm text-left [overflow-wrap:normal] [&_td]:whitespace-nowrap"><thead><tr className="border-b bg-muted/40">{headers.map(h=><th key={h} scope="col" className="p-2 font-medium whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{empty?<tr><td className="p-4 text-muted-foreground" colSpan={headers.length}>Sin registros para mostrar.</td></tr>:children}</tbody></table></div>;}
function Times({title,rows,unit,limits,onSelect}) {return <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4"/>{title}</CardTitle></CardHeader><CardContent><DataTable headers={['Tramo','Promedio',`${unit} medidos`,`${unit} pendientes`,'Objetivo / límite','Mayor espera actual']} empty={false}>{rows.map(row=><tr key={row.key} className={`border-b ${row.key.endsWith('Total')?'bg-blue-50 font-semibold':''}`}><td className="p-2"><button type="button" className="min-h-11 text-left text-primary rounded-sm hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>onSelect(row)}>{row.label}</button></td><td className={`p-2 whitespace-nowrap ${overLimit(row.average,row.key,limits)?'text-amber-800 font-bold':''}`}>{durationLabel(row.average)}{row.average!==null && Number(limits[row.key])>0 && <p className="text-xs font-normal text-muted-foreground">{overLimit(row.average,row.key,limits)?'Supera el objetivo':'Dentro del objetivo'}</p>}</td><td className="p-2">{row.count}</td><td className="p-2">{row.pending}</td><td className="p-2">{Number(limits[row.key])>0?durationLabel(Number(limits[row.key])*3600000):'Sin configurar'}</td><td className={`p-2 whitespace-nowrap ${overLimit(row.maxWait,row.key,limits)?'text-amber-800 font-bold':''}`}>{durationLabel(row.maxWait)}{row.unknown>0&&<p className="text-xs text-muted-foreground font-normal">{row.unknown} sin fecha</p>}</td></tr>)}</DataTable></CardContent></Card>;}
