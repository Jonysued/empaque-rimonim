import React, { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { getOperations, submitOperation } from '@/lib/operationQueue';
import { canDumpLot, isFieldLot, normalizeBinCode, projectFieldOperations } from '@/lib/fieldWorkflow.mjs';
import { projectBinDumps } from '@/lib/binDumpWorkflow.mjs';
import { generateCode, fmtKg, fmtDate } from '@/lib/qr';
import QRScanner from '@/components/QRScanner';
import StatusBadge from '@/components/StatusBadge';
import LegacyDumpForm from '@/components/LegacyDumpForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Repeat } from 'lucide-react';
import { toast } from 'sonner';

export default function Vuelco() {
  const [state, setState] = useState({ lots: [], bins: [], dumps: [], operations: [], loading: true });
  const [selectedId, setSelectedId] = useState(null);
  const [legacyId, setLegacyId] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const [lots, bins, dumps, operations] = await Promise.all([base44.entities.ReceiptLot.list(),
        base44.entities.Bin.list(), base44.entities.DumpingEvent.list('-created_date',50), getOperations()]);
      const field = projectFieldOperations(lots, bins, operations);
      if (request === sequence.current) setState({ ...projectBinDumps(field.lots, field.bins, dumps, operations), operations, loading: false });
    } catch (e) { if (request === sequence.current) { setError(e.message || 'No se pudo cargar Vuelco'); setState(s => ({ ...s, loading: false })); } }
  }, []);
  useEffect(() => {
    refresh(); window.addEventListener('rimonim-queue-change',refresh); window.addEventListener('focus',refresh);
    return () => { sequence.current++; window.removeEventListener('rimonim-queue-change',refresh); window.removeEventListener('focus',refresh); };
  }, [refresh]);
  const { lots, bins, dumps, operations, loading } = state;
  const selected = lots.find(lot => lot.id === selectedId);
  const legacy = lots.find(lot => lot.id === legacyId);
  const legacyPending = new Set(operations.filter(op => op.rpc === 'dump_lot_by_bins').map(op => op.params.p_lot_id));
  const available = lots.filter(lot => canDumpLot(lot) && !lot.held && lot.pendingStatus !== 'conflict' && !legacyPending.has(lot.id) && Number(lot.remaining_weight) > 0);
  const historic = available.filter(lot => {
    const attached = bins.filter(bin => bin.receipt_lot_id === lot.id);
    return !isFieldLot(lot) && (attached.length !== Number(lot.bins_count) || attached.filter(bin => bin.dump_operation_id).length !== (Number(lot.bins_dumped) || 0));
  });
  const identified = available.filter(lot => !historic.some(item => item.id === lot.id));

  async function scan(raw) {
    if (lock.current) return;
    setError('');
    const code = normalizeBinCode(raw);
    if (!code || /^(LOT|ROM|PAL)-/.test(code)) return setError('Escaneá el QR del BIN que se está volcando.');
    const matches = bins.filter(bin => normalizeBinCode(bin.bin_code) === code);
    const bin = matches.find(bin => !bin.receipt_lot_id || !['volcado','anulado'].includes(lots.find(lot => lot.id === bin.receipt_lot_id)?.status)) || matches[0];
    if (!bin) return setError(`No se encontró el BIN ${code}. Registralo primero en Cosecha.`);
    if (bin.dump_operation_id || bin.status === 'volcado') return setError(`El BIN ${code} ya fue volcado; no se descontó nuevamente.`);
    const lot = lots.find(lot => lot.id === bin.receipt_lot_id);
    if (!lot) return setError('Este BIN todavía no pertenece a un consolidado de lote.');
    if (selectedId && selectedId !== lot.id) return setError(`El BIN pertenece a ${lot.lot_code}. Cambiá el lote seleccionado para volcarlo.`);
    if (!canDumpLot(lot)) return setError('El lote debe estar pesado y recibido en Playa Empaque.');
    if (lot.held) return setError('El lote está retenido por calidad.');
    if (lot.pendingStatus === 'conflict' || bin.pendingStatus === 'conflict' || legacyPending.has(lot.id)) return setError('Hay una operación pendiente de revisión para este lote o BIN.');
    const attached = bins.filter(bin => bin.receipt_lot_id === lot.id);
    const dumped = Number(lot.bins_dumped) || 0;
    if (attached.length !== Number(lot.bins_count) || attached.filter(bin => bin.dump_operation_id).length !== dumped) return setError('Este lote tiene bines o vuelcos anteriores sin identificar; requiere conciliación.');
    const kg = dumped + 1 === Number(lot.bins_count) ? Number(lot.remaining_weight) : Number(bin.net_weight);
    if (!(kg > 0) || kg > Number(lot.remaining_weight)) return setError('El BIN no tiene un peso válido o el lote no tiene saldo.');
    lock.current = true; setBusy(true); setSelectedId(lot.id);
    try {
      const result = await submitOperation('dump_bin_by_qr', { p_bin_id: bin.id, p_lot_id: lot.id, p_bin_code: code,
        p_dump_code: generateCode('VOL'), p_scanned_at: new Date().toISOString() }, `dump-bin:${bin.id}`);
      toast[result.pending ? 'warning' : 'success'](result.pending ? `${code}: vuelco guardado, pendiente de sincronizar` : `${code}: ${fmtKg(kg)} descontados del lote`);
      await refresh();
    } catch (e) { setError(e.message || 'No se pudo registrar el vuelco'); await refresh(); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Repeat className="w-6 h-6" /> Vuelco</h1><p className="text-muted-foreground">Escanear cada BIN para descontar automáticamente su peso del lote y habilitarlo para producción</p></div>
    <div className="grid lg:grid-cols-2 gap-6">
      <Card><CardHeader><CardTitle className="text-base">Escanear BIN para volcar</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Cada escaneo registra el vuelco de un bin. No hace falta ingresar kilos ni cantidad.</p>
        {busy ? <p role="status">Registrando vuelco…</p> : <QRScanner label="Escanear QR del BIN" onScan={scan} />}
        {error && <p role="alert" className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>}
        {selected && <div className="rounded-lg border bg-blue-50 p-3 text-sm space-y-1"><div className="flex justify-between gap-2"><b className="font-mono">{selected.lot_code}</b><Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelectedId(null)}>Cambiar lote</Button></div>
          <p>{selected.producer} · {selected.variety}</p><p>BINs: <b>{selected.bins_count} totales · {selected.bins_dumped || 0} volcados · {Number(selected.bins_count) - (Number(selected.bins_dumped) || 0)} pendientes</b></p>
          <p>Volcado: <b>{fmtKg(selected.dumped_weight)}</b> · Saldo: <b>{fmtKg(selected.remaining_weight)}</b></p>
          {selected.pendingStatus && <p className="text-xs text-amber-800">{selected.pendingStatus === 'conflict' ? 'Requiere revisión' : 'Saldo de este dispositivo · pendiente de sincronizar'}</p>}
          {selected.status === 'volcado' && <p className="font-medium text-green-800">Se completó el vuelco del lote.</p>}
        </div>}
        <div className="border-t pt-3 space-y-2"><p className="text-xs text-muted-foreground">Lotes disponibles ({identified.length})</p>
          {loading ? <p>Cargando…</p> : identified.map(lot => <button type="button" disabled={busy} key={lot.id} className="w-full text-left border rounded-lg p-2 text-sm hover:bg-muted" onClick={() => { setSelectedId(lot.id); setError(''); }}><div className="flex justify-between gap-2"><b className="font-mono">{lot.lot_code}</b><StatusBadge status={lot.status} /></div><p>{lot.producer} · {lot.variety} · {Number(lot.bins_count) - (Number(lot.bins_dumped) || 0)} BINs pendientes · {fmtKg(lot.remaining_weight)}</p></button>)}
          {!loading && !identified.length && <p className="text-sm text-muted-foreground">No hay lotes individualizados disponibles para volcar.</p>}
        </div>
        {historic.length > 0 && <details className="border-t pt-3"><summary className="text-sm cursor-pointer">Lotes anteriores sin QR de BIN</summary><p className="text-xs text-muted-foreground my-2">Conservan el registro anterior por cantidad para completar sus saldos históricos.</p>{legacy ? <LegacyDumpForm lot={legacy} onCancel={() => setLegacyId(null)} onSaved={async pending => { setLegacyId(null); if (pending) toast.warning('Vuelco histórico pendiente de sincronizar'); await refresh(); }} /> : historic.map(lot => <Button key={lot.id} variant="outline" className="m-1" onClick={() => setLegacyId(lot.id)}>{lot.lot_code}</Button>)}</details>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Vuelcos recientes</CardTitle></CardHeader><CardContent className="space-y-2">
        {loading ? <p>Cargando…</p> : !dumps.length ? <p className="text-sm text-muted-foreground">Sin vuelcos registrados.</p> : dumps.slice(0,20).map(event => <div key={event.id} className="border rounded-lg p-2 text-sm"><div className="flex justify-between gap-2"><b className="font-mono text-xs">{event.bin_code || event.dump_code}</b><span className="text-xs text-muted-foreground">{fmtDate(event.dump_date)}</span></div><p>{event.bins_dumped || 1} {(event.bins_dumped || 1) === 1 ? 'BIN' : 'BINs'} · {fmtKg(event.net_weight)} · Lote {event.receipt_lot_code}</p>{event.pendingStatus && <p className="text-xs text-amber-800">Pendiente de sincronizar</p>}</div>)}
      </CardContent></Card>
    </div>
  </div>;
}
