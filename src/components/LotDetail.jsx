import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtKg, fmtDate, fmtDay } from '@/lib/qr';
import { isFieldLot, normalizeBinCode } from '@/lib/fieldWorkflow.mjs';
import { fieldOperation } from '@/lib/fieldLots';
import { useAuth } from '@/lib/AuthContext';
import QRLabel from '@/components/QRLabel';
import QRScanner from '@/components/QRScanner';
import StatusBadge from '@/components/StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Layers, LockKeyhole, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export function PendingLotNotice({ lot }) {
  return lot.pendingStatus ? <p className="text-xs text-amber-800">{lot.pendingStatus === 'conflict' ? 'Requiere revisión de sincronización' : 'Cambios en este dispositivo · pendiente de sincronizar'}</p> : null;
}

export function LotSummary({ lot }) {
  const field = isFieldLot(lot);
  return <Card className={`hover:shadow-md transition-shadow ${lot.pendingStatus ? 'border-amber-300' : ''}`}>
    <CardContent className="p-4 flex items-start justify-between gap-3 flex-wrap">
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap"><span className="font-mono font-bold break-all">{lot.lot_code}</span><StatusBadge status={lot.status} />{lot.held && <StatusBadge status="retenido" />}</div>
        <p className="text-sm text-muted-foreground">{lot.producer} · {lot.variety} · {lot.bins_count || 0} BINs{field && lot.status === 'en_campo' ? ` / ${lot.expected_bins_count} declarados` : ''}</p>
        <p className="text-xs text-muted-foreground">{field ? 'Creado en campo' : 'Recibido'}: {fmtDate(lot.field_created_at || lot.receipt_date)}</p>
        {!field && <p className="text-xs text-muted-foreground">Lote del flujo anterior</p>}
        <PendingLotNotice lot={lot} />
      </div>
      <div className="text-right space-y-1 text-sm">
        {lot.net_weight != null ? <><p><span className="text-muted-foreground">Neto:</span> <b>{fmtKg(lot.net_weight)}</b></p>
          <p><span className="text-muted-foreground">Sin volcar:</span> <b className="text-blue-600">{fmtKg(lot.remaining_weight)}</b></p>
          <p><span className="text-muted-foreground">Volcado:</span> <b className="text-amber-600">{fmtKg(lot.dumped_weight)}</b></p></> :
          <p className="text-muted-foreground">Pendiente de pesado</p>}
      </div>
    </CardContent>
  </Card>;
}

export default function LotDetail({ lot, bins, onClose, onUpdated }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const field = isFieldLot(lot);
  const editable = field && lot.status === 'en_campo' && lot.pendingStatus !== 'conflict'
    && ['admin', 'supervisor', 'recepcion', 'calidad'].includes(user?.role);
  const complete = bins.length > 0 && bins.length === Number(lot.expected_bins_count);

  async function change(action, code) {
    if (busyRef.current) return;
    setError('');
    code = normalizeBinCode(code);
    if (action === 'add_bin' && bins.some(bin => bin.bin_code === code)) return setError(`El BIN ${code} ya está en este lote`);
    busyRef.current = true; setBusy(true);
    try {
      const result = await fieldOperation(lot.id, action, code ? { p_bin_code: code } : {});
      if (result.pending) toast.warning('Cambio guardado en este dispositivo; pendiente de sincronizar');
      else toast.success(action === 'close' ? 'Lote cerrado. Ya puede pasar a Pesado de Lote.' : action === 'remove_bin' ? 'BIN retirado del lote' : `BIN ${code} agregado`);
      await onUpdated();
    } catch (e) { setError(e.message || 'No se pudo guardar el cambio'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Ficha del lote {lot.lot_code}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="flex justify-center"><QRLabel code={lot.lot_code} title="Lote" subtitle={`${lot.producer} · ${lot.variety}`} /></div>
        <div className="flex items-center gap-2 flex-wrap"><StatusBadge status={lot.status} />{lot.held && <StatusBadge status="retenido" />}<PendingLotNotice lot={lot} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <Info label="Productor" value={lot.producer} /><Info label="Variedad" value={lot.variety} />
          <Info label="Procedencia/Cuadro" value={lot.origin} /><Info label="Especie" value={lot.species} />
          <Info label="Tipo de cosecha" value={lot.harvest_type} /><Info label="Cuadrilla" value={lot.crew} />
          {lot.crew === 'MIXTO' && lot.crew_breakdown?.map((item,i) => <Info key={i} label={item.crew} value={`${item.bins_count} BINs`} />)}
          <Info label="Transporte" value={lot.transport} /><Info label="Fecha de cosecha" value={fmtDay(lot.harvest_date ? `${lot.harvest_date}T12:00:00` : null)} />
          <Info label="BINs del lote" value={String(lot.bins_count || 0)} />
          {field && <><Info label="Creado en campo" value={fmtDate(lot.field_created_at)} /><Info label="Cierre en campo" value={fmtDate(lot.field_closed_at)} />
            <Info label="Pesado" value={fmtDate(lot.weighed_at)} /><Info label="Recepción Playa Empaque" value={fmtDate(lot.yard_received_at)} /></>}
          {lot.net_weight != null && <><Info label="Peso bruto" value={fmtKg(lot.gross_weight)} /><Info label="Tara" value={fmtKg(lot.tare_weight)} />
            <Info label="Peso neto" value={fmtKg(lot.net_weight)} /><Info label="Peso teórico por BIN" value={lot.bins_count > 0 ? fmtKg(lot.net_weight / lot.bins_count) : '—'} />
            <Info label="Saldo sin volcar" value={fmtKg(lot.remaining_weight)} /><Info label="Volcado acumulado" value={fmtKg(lot.dumped_weight)} />
            <Info label="BINs volcados" value={String(lot.bins_dumped ?? (lot.status === 'volcado' ? lot.bins_count : 0))} /></>}
        </div>
        {lot.quality_notes && <p className="text-sm"><span className="text-muted-foreground">Notas de calidad:</span> {lot.quality_notes}</p>}
        <div className="border-t pt-3 space-y-3">
          <h4 className="font-medium flex items-center gap-2"><Layers className="w-4 h-4" /> BINs del lote ({bins.length}{editable ? ` / ${lot.expected_bins_count}` : ''})</h4>
          {editable && !complete && !busy && <QRScanner label="Escanear QR de un BIN" onScan={code => change('add_bin', code)} />}
          {busy && <p role="status" className="text-sm text-muted-foreground">Guardando…</p>}
          {error && <p role="alert" className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>}
          {!bins.length && <p className="text-sm text-muted-foreground">{field ? 'Escaneá cada BIN que integra este lote.' : 'Lote anterior sin BINs individualizados.'}</p>}
          <div className="space-y-2 max-h-64 overflow-y-auto">{bins.map(bin => <div key={bin.id} className="flex items-center justify-between gap-2 border rounded-lg p-2 text-sm">
            <span className="font-mono break-all">{bin.bin_code}</span>
            <span className="shrink-0">{bin.net_weight != null ? fmtKg(bin.net_weight) : 'Sin pesar'}</span>
            {editable && <Button type="button" variant="ghost" size="sm" disabled={busy} aria-label={`Retirar BIN ${bin.bin_code}`} onClick={() => change('remove_bin', bin.bin_code)}><Trash2 className="w-4 h-4" /></Button>}
          </div>)}</div>
          {editable && (complete ? <Button type="button" className="w-full" disabled={busy} onClick={() => change('close')}><LockKeyhole className="w-4 h-4 mr-2" /> Cerrar lote</Button> :
            <p className="text-sm text-muted-foreground">Faltan {Math.max(0, Number(lot.expected_bins_count) - bins.length)} BINs para cerrar el lote.</p>)}
          {field && lot.status === 'cerrado_campo' && <Button asChild variant="outline"><Link to="/pesado-lote">Ir a Pesado de Lote</Link></Button>}
          {field && lot.status === 'pesado' && <Button asChild variant="outline"><Link to="/recepcion-playa">Ir a Recepción Playa Empaque</Link></Button>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}

function Info({ label, value }) {
  return <div className="flex justify-between gap-3 border-b pb-1"><span className="text-muted-foreground">{label}</span><span className="font-medium text-right">{value || '—'}</span></div>;
}
