import React, { useState } from 'react';
import { useFieldLots, fieldOperation } from '@/lib/fieldLots';
import { isFieldLot } from '@/lib/fieldWorkflow.mjs';
import { fmtKg, fmtDate } from '@/lib/qr';
import QRScanner from '@/components/QRScanner';
import { LotSummary, PendingLotNotice } from '@/components/LotDetail';
import StatusBadge from '@/components/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Warehouse, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function RecepcionPlaya() {
  const { lots, loading, error: loadError, refresh } = useFieldLots();
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const selected = lots.find(lot => lot.id === selectedId);
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
  return <div className="min-w-0 space-y-6">
    <div><h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Warehouse className="w-6 h-6" /> Recepción Playa Empaque</h1><p className="text-muted-foreground">Escanear el QR del lote recibido para habilitarlo en Vuelco</p></div>
    {(loadError || error) && <p role="alert" className="text-sm text-destructive">{loadError || error}</p>}
    <Card><CardHeader><CardTitle className="text-base">Recibir lote en playa</CardTitle></CardHeader><CardContent className="space-y-4">
      {selected ? <><LotSummary lot={selected} /><p className="text-sm">{selected.bins_count} BINs · Neto {fmtKg(selected.net_weight)}</p><PendingLotNotice lot={selected} />
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={saving} onClick={() => setSelectedId(null)}>Cancelar</Button><Button disabled={saving} onClick={receive}><CheckCircle2 className="w-4 h-4 mr-2" />{saving ? 'Registrando…' : 'Confirmar recepción en playa'}</Button></div></> :
        <QRScanner label="Escanear QR del lote recibido" onScan={scan} />}
    </CardContent></Card>
    <div className="min-w-0 space-y-3"><h2 className="font-semibold">Pendientes de llegada ({available.length})</h2><p className="text-sm text-muted-foreground">Escaneá el QR del lote cuando llegue al empaque.</p>
      {loading ? <p>Cargando…</p> : !available.length ? <p className="text-sm text-muted-foreground">No hay lotes pesados pendientes de recibir.</p> : <>
        <p className="text-xs text-muted-foreground sm:hidden">Deslizá la tabla hacia los costados para ver todas las columnas.</p>
        <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
          <Table aria-label="Lotes pendientes de llegada a Playa Empaque">
            <TableHeader><TableRow>
              <TableHead scope="col">Lote</TableHead><TableHead scope="col">Estado</TableHead>
              <TableHead scope="col">Transporte</TableHead><TableHead scope="col">Productor</TableHead>
              <TableHead scope="col">Variedad</TableHead><TableHead scope="col" className="text-right">BINs</TableHead>
              <TableHead scope="col">Fecha de registro</TableHead><TableHead scope="col" className="text-right">Peso neto</TableHead>
            </TableRow></TableHeader>
            <TableBody>{available.map(lot => <TableRow key={lot.id}>
              <TableCell className="font-mono font-semibold">{lot.lot_code}</TableCell>
              <TableCell><StatusBadge status={lot.status} /><PendingLotNotice lot={lot} /></TableCell>
              <TableCell>{lot.transport || '—'}</TableCell><TableCell>{lot.producer || '—'}</TableCell>
              <TableCell>{lot.variety || '—'}</TableCell><TableCell className="text-right">{lot.bins_count || 0}</TableCell>
              <TableCell>{fmtDate(lot.field_created_at || lot.receipt_date)}</TableCell>
              <TableCell className="text-right">{lot.net_weight != null ? fmtKg(lot.net_weight) : '—'}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
      </>}</div>
  </div>;
}
