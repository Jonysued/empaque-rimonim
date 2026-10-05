import React, { useState } from 'react';
import { submitOperation } from '@/lib/operationQueue';
import { generateCode, fmtKg } from '@/lib/qr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2 } from 'lucide-react';
export default function LegacyDumpForm({ lot, onCancel, onSaved }) {
  const [bins, setBins] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [dumpCode, setDumpCode] = useState(() => generateCode("VOL"));

  const totalBins = Number(lot.bins_count) || 0;
  const dumpedBins = Number(lot.bins_dumped ?? (lot.status === "volcado" ? totalBins : 0));
  const pendingBins = totalBins - dumpedBins;
  const saldo = Number(lot.remaining_weight) || 0;
  const selectedBins = Number(bins);
  const estimatedKg = selectedBins === pendingBins ? saldo : Math.round((Number(lot.net_weight) || 0) * selectedBins / totalBins * 10) / 10;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!Number.isInteger(selectedBins) || selectedBins <= 0) return setError("Ingresá una cantidad entera de BINs");
    if (!totalBins || pendingBins <= 0) return setError("El lote no tiene BINs pendientes para volcar");
    if (selectedBins > pendingBins) return setError(`Sólo quedan ${pendingBins} BINs pendientes`);
    if (lot.dumped_weight > 0 && lot.bins_dumped == null && lot.status !== "volcado") return setError("Este lote tiene vuelcos anteriores sin BINs; requiere conciliación");
    setSaving(true);
    try {
      const result = await submitOperation("dump_lot_by_bins", {
        p_lot_id: lot.id,
        p_bins: selectedBins,
        p_dump_code: dumpCode,
      }, `lot:${lot.id}`, operationId);
      onSaved(result.pending);
    } catch (e) {
      setError(e.message || "Error al registrar vuelco");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="font-mono font-bold">{lot.lot_code}</p>
        <p className="text-sm">{lot.producer} · {lot.variety}</p>
        <div className="flex justify-between text-sm mt-1">
          <span>Recibido en Empaque: <b>{fmtKg(lot.net_weight)}</b></span>
          <span>Volcado: <b>{fmtKg(lot.dumped_weight)}</b></span>
        </div>
        <p className="text-sm">BINs: <b>{totalBins} recibidos · {dumpedBins} volcados · {pendingBins} pendientes</b></p>
        {totalBins > 0 && <p className="text-sm">Promedio por BIN: <b>{fmtKg(Number(lot.net_weight) / totalBins)}</b></p>}
        <p className="text-sm">Saldo disponible: <b className="text-blue-700">{fmtKg(saldo)}</b></p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>}
        <div className="space-y-1">
          <Label className="text-xs">BINs a volcar *</Label>
          <Input type="number" min="1" max={Math.max(0, pendingBins)} step="1" value={bins} onChange={e => { setBins(e.target.value); setOperationId(crypto.randomUUID()); setDumpCode(generateCode("VOL")); }} autoFocus />
          <Button type="button" variant="outline" size="sm" disabled={pendingBins <= 0} onClick={() => { setBins(String(pendingBins)); setOperationId(crypto.randomUUID()); setDumpCode(generateCode("VOL")); }}>Volcar todos los BINs pendientes ({pendingBins})</Button>
          {Number.isInteger(selectedBins) && selectedBins > 0 && selectedBins <= pendingBins && <p className="text-sm">Kilos a descontar: <b>{fmtKg(estimatedKg)}</b></p>}
        </div>
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={saving}>
            <CheckCircle2 className="w-4 h-4 mr-1" /> {saving ? "Registrando…" : "Confirmar vuelco"}
          </Button>
        </div>
      </form>
    </div>
  );
}
