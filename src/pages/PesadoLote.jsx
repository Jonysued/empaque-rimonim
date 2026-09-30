import React, { useState } from 'react';
import { useFieldLots, fieldOperation } from '@/lib/fieldLots';
import { isFieldLot } from '@/lib/fieldWorkflow.mjs';
import { fmtKg } from '@/lib/qr';
import QRScanner from '@/components/QRScanner';
import LotDetail, { LotSummary, PendingLotNotice } from '@/components/LotDetail';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Scale } from 'lucide-react';
import { toast } from 'sonner';

export default function PesadoLote() {
  const { lots, bins, loading, error: loadError, refresh } = useFieldLots();
  const [selectedId, setSelectedId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [error, setError] = useState('');
  const available = lots.filter(lot => isFieldLot(lot) && lot.status === 'cerrado_campo' && lot.pendingStatus !== 'conflict');
  const selected = lots.find(lot => lot.id === selectedId);
  const detail = lots.find(lot => lot.id === detailId);
  function scan(code) {
    setError('');
    const lot = lots.find(item => item.lot_code === code.trim());
    if (!lot) return setError(`No se encontró el lote ${code}`);
    if (!available.some(item => item.id === lot.id)) return setError('El lote debe estar cerrado en Consolidado de Lote y pendiente de pesado.');
    setSelectedId(lot.id);
  }
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Scale className="w-6 h-6" /> Pesado de Lote</h1><p className="text-muted-foreground">Ingresar bruto y tara; distribuir el neto entre los bines del lote cerrado</p></div>
    {(loadError || error) && <p role="alert" className="text-sm text-destructive">{loadError || error}</p>}
    <Card><CardHeader><CardTitle className="text-base">{selected ? `Pesar ${selected.lot_code}` : 'Escanear el QR del lote cerrado'}</CardTitle></CardHeader>
      <CardContent>{selected && <Button type="button" variant="outline" className="mb-4" onClick={() => setDetailId(selected.id)}>Ver ficha completa e imprimir A4</Button>}{selected ? <WeightForm key={selected.id} lot={selected} onCancel={() => setSelectedId(null)} onSaved={async pending => {
        setSelectedId(null); toast[pending ? 'warning' : 'success'](pending ? 'Pesado guardado en este dispositivo; pendiente de sincronizar' : 'Lote pesado. Ya puede recibirse en Playa Empaque.'); await refresh();
      }} /> : <QRScanner label="Escanear QR del lote" onScan={scan} />}</CardContent></Card>
    <div className="space-y-3"><h2 className="font-semibold">Pendientes de pesado ({available.length})</h2>
      {loading ? <p>Cargando…</p> : !available.length ? <p className="text-sm text-muted-foreground">No hay lotes cerrados pendientes de pesado.</p> : available.map(lot =>
        <button type="button" key={lot.id} className="block w-full text-left" onClick={() => { setSelectedId(lot.id); setError(''); }}><LotSummary lot={lot} /></button>)}</div>
    <div className="space-y-3"><h2 className="font-semibold">Últimos lotes pesados</h2>{lots.filter(lot => lot.weighed_at || (!isFieldLot(lot) && lot.net_weight != null)).slice(0,20).map(lot =>
      <button type="button" key={lot.id} className="block w-full text-left" onClick={() => setDetailId(lot.id)}><LotSummary lot={lot} /></button>)}</div>
    {detail && <LotDetail printFullSheet lot={detail} bins={bins.filter(bin => bin.receipt_lot_id === detail.id)} onClose={() => setDetailId(null)} onUpdated={refresh} />}
  </div>;
}

function WeightForm({ lot, onCancel, onSaved }) {
  const [gross, setGross] = useState('');
  const [tare, setTare] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const net = gross !== '' && tare !== '' ? Math.round((Number(gross) - Number(tare)) * 10) / 10 : null;
  function update(setter, value) { setter(value); setOperationId(crypto.randomUUID()); }
  async function save(event) {
    event.preventDefault(); setError('');
    if (gross === '' || tare === '' || !Number.isFinite(Number(gross)) || !Number.isFinite(Number(tare)) || Number(gross) <= 0 || Number(tare) < 0 || Number(tare) >= Number(gross) || !(net > 0)) {
      return setError('Ingresá un bruto mayor a cero y una tara menor al bruto, sin valores negativos.');
    }
    if (lot.status !== 'cerrado_campo' || lot.pendingStatus === 'conflict') return setError('Este lote ya no está disponible para pesar.');
    setSaving(true);
    try { const result = await fieldOperation(lot.id, 'weigh', { p_gross: Number(gross), p_tare: Number(tare) }, operationId); await onSaved(result.pending); }
    catch (e) { setError(e.message); setSaving(false); }
  }
  return <form onSubmit={save} className="space-y-4">
    <p className="text-sm">{lot.producer} · {lot.variety} · <b>{lot.bins_count} BINs</b></p><PendingLotNotice lot={lot} />
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1"><Label htmlFor="lot-gross">Peso bruto (kg) *</Label><Input id="lot-gross" type="number" required min="0.1" step="0.1" disabled={saving} value={gross} onChange={e => update(setGross,e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="lot-tare">Tara (kg) *</Label><Input id="lot-tare" type="number" required min="0" step="0.1" disabled={saving} value={tare} onChange={e => update(setTare,e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="lot-net">Peso neto (kg)</Label><Input id="lot-net" readOnly value={net > 0 ? net.toFixed(1) : ''} placeholder="Bruto − tara" /></div>
      <div className="space-y-1"><Label htmlFor="lot-bin-weight">Peso teórico por BIN</Label><Input id="lot-bin-weight" readOnly value={net > 0 ? fmtKg(net / lot.bins_count) : ''} placeholder="Neto ÷ BINs del lote" /></div>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Confirmar pesado'}</Button></div>
  </form>;
}
