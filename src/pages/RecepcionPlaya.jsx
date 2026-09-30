import React, { useState } from 'react';
import { useFieldLots, fieldOperation } from '@/lib/fieldLots';
import { isFieldLot } from '@/lib/fieldWorkflow.mjs';
import { fmtKg, fmtDate } from '@/lib/qr';
import QRScanner from '@/components/QRScanner';
import LotDetail, { LotSummary, PendingLotNotice } from '@/components/LotDetail';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Warehouse, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function RecepcionPlaya() {
  const { lots, bins, loading, error: loadError, refresh } = useFieldLots();
  const [selectedId, setSelectedId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const selected = lots.find(lot => lot.id === selectedId);
  const detail = lots.find(lot => lot.id === detailId);
  const available = lots.filter(lot => isFieldLot(lot) && lot.status === 'pesado' && !lot.held && lot.pendingStatus !== 'conflict');
  function scan(code) {
    setError('');
    const lot = lots.find(item => item.lot_code === code.trim());
    if (!lot) return setError(`No se encontró el lote ${code}`);
    if (lot.yard_received_at) return setError(`El lote ${code} ya fue recibido en Playa Empaque el ${fmtDate(lot.yard_received_at)}.`);
    if (lot.held) return setError('Este lote está retenido por calidad.');
    if (!available.some(item => item.id === lot.id)) return setError('El lote debe estar pesado antes de recibirlo en playa.');
    setOperationId(crypto.randomUUID()); setSelectedId(lot.id);
  }
  async function receive() {
    if (saving || !selected) return;
    setSaving(true); setError('');
    try {
      const result = await fieldOperation(selected.id, 'receive', {}, operationId);
      toast[result.pending ? 'warning' : 'success'](result.pending ? 'Recepción guardada en este dispositivo; pendiente de sincronizar' : 'Lote recibido en Playa Empaque y habilitado para Vuelco.');
      setSelectedId(null); await refresh();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Warehouse className="w-6 h-6" /> Recepción Playa Empaque</h1><p className="text-muted-foreground">Escanear el QR del lote recibido para habilitarlo en Vuelco</p></div>
    {(loadError || error) && <p role="alert" className="text-sm text-destructive">{loadError || error}</p>}
    <Card><CardHeader><CardTitle className="text-base">Recibir lote en playa</CardTitle></CardHeader><CardContent className="space-y-4">
      {selected ? <><LotSummary lot={selected} /><p className="text-sm">{selected.bins_count} BINs · Neto {fmtKg(selected.net_weight)}</p><PendingLotNotice lot={selected} />
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={saving} onClick={() => setSelectedId(null)}>Cancelar</Button><Button disabled={saving} onClick={receive}><CheckCircle2 className="w-4 h-4 mr-2" />{saving ? 'Registrando…' : 'Confirmar recepción en playa'}</Button></div></> :
        <QRScanner label="Escanear QR del lote recibido" onScan={scan} />}
    </CardContent></Card>
    <div className="space-y-3"><h2 className="font-semibold">Pendientes de llegada ({available.length})</h2><p className="text-sm text-muted-foreground">Escaneá el QR del lote cuando llegue al empaque.</p>
      {loading ? <p>Cargando…</p> : !available.length ? <p className="text-sm text-muted-foreground">No hay lotes pesados pendientes de recibir.</p> : available.map(lot => <LotSummary key={lot.id} lot={lot} />)}</div>
    <div className="space-y-3"><h2 className="font-semibold">Últimos lotes recibidos en playa</h2>{lots.filter(lot => isFieldLot(lot) && lot.yard_received_at).slice(0,20).map(lot =>
      <button key={lot.id} type="button" className="block w-full text-left" onClick={() => setDetailId(lot.id)}><LotSummary lot={lot} /></button>)}</div>
    {detail && <LotDetail lot={detail} bins={bins.filter(bin => bin.receipt_lot_id === detail.id)} onClose={() => setDetailId(null)} onUpdated={refresh} />}
  </div>;
}
