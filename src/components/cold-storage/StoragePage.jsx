import React, { useCallback, useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { changeCoolingCycle, storageCommand } from '@/lib/palletMovements';
import { getOperations } from '@/lib/operationQueue';
import { STORAGE_LAYOUTS, sectionCapacity, positionRows, positionLabel, coolingTimes, fifthLoadEnabled, storageSections } from '@/lib/coldStorage.mjs';
import { durationLabel, operationDate } from '@/lib/dashboardMetrics.mjs';
import QRScanner from '@/components/QRScanner';
import LocationQR from '@/components/LocationQR';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Warehouse, Snowflake, LockKeyhole, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function StoragePage({ type, AddForm }) {
  const tunnel = type === 'tunel', Icon = tunnel ? Snowflake : Warehouse;
  const [locations, setLocations] = useState([]), [pallets, setPallets] = useState([]);
  const [cycles, setCycles] = useState([]), [batches, setBatches] = useState([]), [pending, setPending] = useState([]);
  const [selectedId, setSelectedId] = useState(''), [section, setSection] = useState(tunnel ? 0 : 1);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false), [showAdd, setShowAdd] = useState(false), [editing, setEditing] = useState(null);
  const [choosingLayout, setChoosingLayout] = useState(false), [layoutChoice, setLayoutChoice] = useState('camara_flexible');
  const [now, setNow] = useState(Date.now()), [online, setOnline] = useState(navigator.onLine);
  const operationBusy = useRef(false), scanRef = useRef(null), refreshVersion = useRef(0), mounted = useRef(true);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      const [ls, ps, cs, bs, qs] = await Promise.all([
        base44.entities.Location.filter({ type }), base44.entities.Pallet.list(),
        base44.entities.CoolingCycle.list(), base44.entities.StorageBatch.list(), getOperations(),
      ]);
      if (!mounted.current || version !== refreshVersion.current) return;
      setNow(Date.now());
      setLocations(ls || []); setPallets(ps || []); setCycles(cs || []); setBatches(bs || []); setPending(qs || []);
      setSelectedId(id => (ls || []).some(l => l.id === id) ? id : ls?.[0]?.id || '');
    } catch (e) { if (mounted.current && version === refreshVersion.current) setError(e.message || 'No se pudieron actualizar los datos'); }
    finally { if (mounted.current && version === refreshVersion.current) setLoading(false); }
  }, [type]);
  useEffect(() => {
    let active = true; mounted.current = true;
    const update = () => { if (active) { setOnline(navigator.onLine); refresh(); } };
    update();
    const timer = setInterval(() => { setNow(Date.now()); if (navigator.onLine && !operationBusy.current) update(); }, 15000);
    window.addEventListener('rimonim-queue-change', update); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { active = false; mounted.current = false; clearInterval(timer); window.removeEventListener('rimonim-queue-change', update); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [refresh]);
  const location = locations.find(l => l.id === selectedId);
  const occupants = pallets.filter(p => p.location_id === selectedId);
  const openCycle = cycles.find(c => c.tunnel_id === selectedId && c.status === 'abierto');
  const finished = occupants.some(p => p.status === 'prefrio_finalizado');
  const unassigned = occupants.filter(p => p.storage_position == null);
  const layout = location?.storage_layout;
  const fifthEnabled = fifthLoadEnabled(location);
  const sectionCount = occupants.filter(p => Number(p.storage_section) === section).length;
  const locationPending = pending.filter(q => q.params?.p_payload?.location_id === selectedId || q.params?.p_tunnel_id === selectedId);
  const batch = batches.find(b => b.location_id === selectedId && Number(b.section) === section && b.status !== 'cerrado');
  const selectLocation = id => { setSelectedId(id); setSection(tunnel ? 0 : 1); setChoosingLayout(false); setError(''); };

  async function run(action) {
    if (operationBusy.current) return;
    operationBusy.current = true; setBusy(true); setError('');
    try {
      const result = await action();
      if (result.pending) toast.warning('Guardado en el dispositivo. La posición se confirmará al sincronizar.');
      else toast.success('Operación confirmada');
      await refresh();
      return result;
    } catch (e) { setError(e.message || 'No se pudo confirmar la operación'); }
    finally { operationBusy.current = false; setBusy(false); }
  }
  const payloadFor = pallet => ({ location_id: selectedId, pallet_id: pallet.id, section,
    expected_assignment: pallet.storage_assignment_id || null, expected_revision: location?.storage_revision || null });
  async function handleScan(code) {
    if (operationBusy.current) return;
    const next = locations.find(l => l.location_code === code);
    if (next) { selectLocation(next.id); return; }
    const pallet = pallets.find(p => p.pallet_code === code);
    if (!pallet) { setError(`Código no reconocido: ${code}`); return; }
    if (!location || !layout) { setError('Elegí la ubicación y la distribución primero'); return; }
    if (openCycle) { setError('Túnel bloqueado hasta finalizar el prefrío'); return; }
    if (!tunnel && batch?.completed_at) { setError('La carga está completa; reabrila antes de agregar pallets'); return; }
    if (unassigned.length) { setError('Ubicá los pallets existentes antes de ingresar otros'); return; }
    await run(() => storageCommand('ingresar', payloadFor(pallet)));
  }
  const startStop = () => run(() => changeCoolingCycle(openCycle ? 'finalizar' : 'iniciar', selectedId, undefined, openCycle?.id || null)).then(result => { if (result && !result.pending) setScan(false); });
  if (loading) return <p className="py-12 text-center text-muted-foreground">Cargando ubicaciones…</p>;
  return <div className="space-y-5">
    <div className="flex flex-wrap justify-between gap-3">
      <div><h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Icon className="w-6 h-6" />{tunnel ? 'Prefrío' : 'Cámaras'}</h1><p className="text-sm text-muted-foreground">Posiciones físicas y tiempos confirmados</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4 mr-1" />{tunnel ? 'Nuevo túnel' : 'Nueva cámara'}</Button><Button variant="outline" disabled={busy} onClick={refresh} aria-label="Actualizar ubicaciones"><RefreshCw className="w-4 h-4" /></Button></div>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}
    {!online && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Sin conexión. Los movimientos quedan pendientes; el plano muestra las últimas posiciones confirmadas.</p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">{locations.map(l => {
      const count = pallets.filter(p => p.location_id === l.id).length;
      const locked = cycles.some(c => c.tunnel_id === l.id && c.status === 'abierto');
      return <button key={l.id} type="button" onClick={() => selectLocation(l.id)} className={`min-w-0 rounded-xl border p-4 text-left space-y-1 ${selectedId === l.id ? 'border-cyan-600 bg-cyan-50' : 'bg-white'}`}>
        <b className="block break-words">{l.name}</b><span className="block text-sm text-muted-foreground">{count}/{l.capacity || '—'} pallets{locked ? ' · Bloqueado' : ''}</span>
      </button>;
    })}</div>
    {!locations.length && <p className="py-8 text-center text-muted-foreground">No hay ubicaciones configuradas.</p>}
    {location && <Card><CardContent className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-lg">{location.name}</h2><p className="text-xs text-muted-foreground break-all">{location.location_code}</p></div><LocationQR location={location} /></div>
      {(!layout || choosingLayout) ? <div className="rounded-lg border p-3 space-y-3">
        <h3 className="font-medium">Elegí la distribución</h3>
        {tunnel ? <p className="text-sm">Dos filas de nueve posiciones · 18 pallets</p> : <div className="space-y-2">{['camara_flexible'].map(key => <label key={key} className="flex items-center gap-3 rounded-lg border p-3 min-h-11"><input type="radio" name="storage-layout" value={key} checked={layoutChoice === key} onChange={() => setLayoutChoice(key)} /><span className="text-sm">{STORAGE_LAYOUTS[key].label}</span></label>)}</div>}
        <p className="text-xs text-muted-foreground">El plano queda protegido mientras haya posiciones asignadas.</p>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !online || Boolean(openCycle)} onClick={() => run(() => storageCommand('distribucion', { location_id: selectedId, layout: tunnel ? 'tunel_18' : layoutChoice })).then(result => { if (result && !result.pending) setChoosingLayout(false); })}>Confirmar distribución</Button>{layout && <Button variant="outline" onClick={() => setChoosingLayout(false)}>Cancelar</Button>}</div>
      </div> : <>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">{STORAGE_LAYOUTS[layout]?.label}</p><Button variant="outline" size="sm" disabled={busy || occupants.some(p => p.storage_position != null) || Boolean(openCycle) || locationPending.length > 0} onClick={() => { setLayoutChoice(tunnel ? layout : 'camara_flexible'); setChoosingLayout(true); }}>Cambiar distribución</Button></div>
        {!tunnel && <>
          <div className="grid grid-cols-3 gap-2" aria-label="Distribución de la cámara">{[2, 5, 3, 1, 0, 4].map((s, i) => s === 0 || (s === 5 && !fifthEnabled) ? null : <button key={i} style={{ gridColumn: [1,2,3,1,2,3][i], gridRow: s === 5 ? "1 / span 2" : i < 3 ? 1 : 2 }} onClick={() => setSection(s)} className={`min-h-20 rounded-lg border p-2 text-center ${section === s ? 'border-indigo-600 bg-indigo-50' : 'bg-slate-50'}`}><b className="block text-sm">Carga {s}</b><span className="text-xs">{occupants.filter(p => Number(p.storage_section) === s).length}/{sectionCapacity(layout, s, occupants)}</span></button>)}</div>
          {!fifthEnabled && <Button variant="outline" disabled={busy || !online || locationPending.length > 0} onClick={() => run(() => storageCommand('habilitar_quinta', { location_id: selectedId })).then(result => { if (result && !result.pending) setSection(5); })}>Habilitar quinta carga</Button>}
          <p className="text-xs text-muted-foreground">Máximo 101 pallets al habilitar la quinta. Cada posición 21 ocupada en las cargas 1 a 4 reduce en un lugar el espacio de la quinta.</p>
          <p className="text-xs text-muted-foreground">Las cargas son sectores físicos de la cámara. Los despachos se asignan por separado.</p>
        </>}
        {openCycle && <div className="rounded-lg bg-cyan-50 p-3 text-sm text-cyan-900"><p className="font-medium flex items-center gap-2"><LockKeyhole className="w-4 h-4" />Prefrío en curso · {durationLabel(now - Date.parse(openCycle.start_time))}</p><p className="mt-1">No se pueden agregar, retirar ni cambiar posiciones hasta finalizar.</p></div>}
        {tunnel && !openCycle && finished && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900">Prefrío finalizado · pendiente de traslado. Las posiciones siguen ocupadas.</p>}
        <div><h3 className="font-medium mb-2">{tunnel ? 'Plano del túnel' : `Carga ${section} · ${sectionCapacity(layout, section, occupants)} posiciones`}</h3><PositionGrid layout={layout} section={section} pallets={occupants} onSelect={p => setEditing(p)} disabled={busy || Boolean(openCycle)} />{(tunnel || section !== 5) && <p className={`mt-2 text-xs text-muted-foreground ${tunnel ? 'sm:hidden' : 'min-[380px]:hidden'}`}>Deslizá el plano para ver el resto de las posiciones.</p>}</div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span>□ Libre</span><span className="text-cyan-800">■ Ocupado</span><span className="text-green-800">■ Prefrío finalizado</span></div>
        {tunnel ? <div><Button disabled={busy || !online || locationPending.length > 0 || (!openCycle && (!occupants.length || Boolean(finished) || unassigned.length > 0))} onClick={startStop}>{openCycle ? 'Finalizar prefrío' : 'Iniciar prefrío'}</Button></div> : batch && <div className="rounded-lg bg-muted p-3 space-y-2 text-sm">
          <p>Ingreso del primer pallet: {operationDate(batch.first_entry_at)}</p><p>Carga completa: {batch.completed_at ? `${operationDate(batch.completed_at)} · ${batch.completed_count ?? batch.capacity} pallets al completar` : 'Todavía abierta'}</p>
          <Button variant="outline" disabled={busy || !online || locationPending.length > 0 || (!batch.completed_at && (section === 5 ? sectionCount < 1 : ![20, 21].includes(sectionCount)))} onClick={() => run(() => storageCommand(batch.completed_at ? 'reabrir_carga' : 'completar_carga', { location_id: selectedId, section, expected_batch: batch.id }))}>{batch.completed_at ? 'Reabrir carga' : `Marcar completa con ${sectionCount} pallets`}</Button>
          {batch.started_at ? <p>Tiempo de la carga desde inicio: <b>{durationLabel(now - Date.parse(batch.started_at))}</b></p> : <Button variant="outline" disabled={busy || !online || locationPending.length > 0} onClick={() => run(() => storageCommand('iniciar_carga', { location_id: selectedId, section }))}>Iniciar tiempo de esta carga</Button>}
          <p className="text-xs text-muted-foreground">Cada pallet conserva su propio tiempo desde el ingreso. El tiempo de la carga comienza al completarla o al iniciarla manualmente.</p>
        </div>}
        {locationPending.length > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{locationPending.length} operación(es) pendiente(s){locationPending.some(q => q.status === 'conflict') ? ' de revisión' : ' de sincronización'}. Revisalas en el indicador de sincronización.</p>}
        <Button disabled={busy || Boolean(openCycle) || unassigned.length > 0 || location.active === false || (!tunnel && Boolean(batch?.completed_at))} onClick={() => { setScan(v => !v); setTimeout(() => scanRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100); }}>{scan ? 'Cerrar escáner' : tunnel ? 'Ingresar pallet' : `Ingresar pallet a carga ${section}`}</Button>
        {scan && !openCycle && (tunnel || !batch?.completed_at) && <div ref={scanRef} className="rounded-lg border bg-slate-50 p-3 space-y-2"><p className="text-sm">Escaneá el QR del pallet. Se asignará la primera posición libre por número{tunnel ? '.' : ` en carga ${section}.`}</p><QRScanner label="Escanear ubicación o pallet" onScan={handleScan} /></div>}
      </>}
      {unassigned.length > 0 && <p className="text-sm text-amber-900">{unassigned.length} pallet(s) pendiente(s) de ubicar. Elegí «Editar posición» y confirmá su ubicación real.</p>}
      <div className="space-y-3">{occupants.filter(p => tunnel || p.storage_position == null || Number(p.storage_section) === section).map(p => {
        const times = coolingTimes(p, now);
        return <div key={p.id} className="rounded-lg border p-3 space-y-2">
          <div className="flex flex-wrap justify-between gap-2"><b className="text-sm">Pallet {p.romaneo_number || p.pallet_code}</b><span className="text-xs text-muted-foreground">{positionLabel(p)}</span></div>
          <p className="text-xs text-muted-foreground">{tunnel ? `Espera antes de prefrío: ${durationLabel(times.waiting)} · Prefrío efectivo: ${durationLabel(times.cooling)}` : `Tiempo individual en cámara: ${durationLabel(p.storage_entered_at ? now - Date.parse(p.storage_entered_at) : null)}`}</p>
          {p.status === 'prefrio_finalizado' && <p className="text-xs text-green-800">Prefrío finalizado · pendiente de traslado</p>}
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || !layout || Boolean(openCycle)} onClick={() => setEditing(p)}>Editar posición</Button><Button size="sm" variant="outline" disabled={busy || Boolean(openCycle)} onClick={() => run(() => storageCommand('retirar', payloadFor(p)))}>Confirmar salida</Button></div>
        </div>;
      })}</div>
    </CardContent></Card>}
    {editing && location && <PositionEditor pallet={editing} location={location} occupants={occupants} busy={busy} onClose={() => setEditing(null)} onSave={(s, pos) => run(() => storageCommand('posicion', { ...payloadFor(editing), section: s, position: pos })).then(result => { if (result) setEditing(null); })} />}
    {showAdd && <AddForm onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); refresh(); }} />}
  </div>;
}

function PositionGrid({ layout, section, pallets, onSelect, disabled, selectedPosition = null, selecting = false, currentId = '' }) {
  const rows = positionRows(layout, section, pallets), tunnel = layout === 'tunel_18';
  return <div className="max-w-full overflow-x-auto rounded-lg border p-2" aria-label="Posiciones del plano"><div className={`${tunnel ? 'min-w-[450px] space-y-8' : section !== 5 ? 'min-w-[288px] space-y-1' : 'min-w-[240px] space-y-1'}`}>{rows.map((row, r) => <div key={r} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>{row.map((number, c) => {
    if (number === null) return <div key={`blank:${c}`} />;
    const pallet = pallets.find(p => Number(p.storage_section) === section && Number(p.storage_position) === number);
    const blocked = selecting ? Boolean(pallet && pallet.id !== currentId) : !pallet;
    return <button key={number} type="button" disabled={disabled || blocked} aria-label={`Posición ${number}${pallet ? `, pallet ${pallet.romaneo_number || pallet.pallet_code}` : ', libre'}`} onClick={() => onSelect(selecting ? number : pallet)} className={`min-h-12 min-w-0 rounded border px-1 py-1 text-center ${selectedPosition === number ? 'ring-2 ring-indigo-600' : ''} ${pallet ? pallet.status === 'prefrio_finalizado' ? 'border-green-300 bg-green-50 text-green-900' : 'border-cyan-300 bg-cyan-50 text-cyan-900' : 'bg-white text-slate-600'} disabled:opacity-75`}><b className="block text-sm">{number}</b>{pallet && <span className="block truncate text-[10px]">{pallet.romaneo_number || pallet.pallet_code}</span>}</button>;
  })}</div>)}</div></div>;
}
function PositionEditor({ pallet, location, occupants, busy, onClose, onSave }) {
  const [section, setSection] = useState(Number(pallet.storage_section) || (location.type === 'tunel' ? 0 : 1));
  const [position, setPosition] = useState(pallet.storage_position == null ? null : Number(pallet.storage_position));
  return <Dialog open onOpenChange={() => { if (!busy) onClose(); }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Posición del pallet {pallet.romaneo_number || ''}</DialogTitle></DialogHeader>
    <DialogDescription>{location.name} · {positionLabel(pallet)}</DialogDescription>
    {location.type === 'camara' && <label className="text-sm space-y-1"><span>Carga del plano</span><select className="block w-full rounded-md border bg-white px-3 py-2 min-h-11" value={section} onChange={e => { setSection(Number(e.target.value)); setPosition(null); }}>{storageSections(location).map(s => <option key={s} value={s}>Carga {s}</option>)}</select></label>}
    <p className="text-sm">Elegí una posición libre. La ubicación se confirma al guardar.</p>
    <PositionGrid layout={location.storage_layout} section={section} pallets={occupants} selecting currentId={pallet.id} selectedPosition={position} onSelect={setPosition} disabled={busy} />
    <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button><Button disabled={busy || position === null} onClick={() => onSave(section, position)}>Guardar posición {position || ''}</Button></div>
  </DialogContent></Dialog>;
}
