import React, { useState, useEffect } from "react";
import { base44, supabase } from "@/api/base44Client";
import { generateCode, fmtKg, fmtDate } from "@/lib/qr";
import QRScanner from "@/components/QRScanner";
import StatusBadge from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Repeat, CheckCircle2 } from "lucide-react";

export default function Vuelco() {
  const [lots, setLots] = useState([]);
  const [dumps, setDumps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scannedLot, setScannedLot] = useState(null);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const [l, d] = await Promise.all([
        base44.entities.ReceiptLot.list("-created_date", 50),
        base44.entities.DumpingEvent.list("-created_date", 20),
      ]);
      setLots(l || []);
      setDumps(d || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  async function handleScan(code) {
    setError("");
    const lot = lots.find(l => l.lot_code === code);
    if (!lot) {
      setError(`No se encontró un lote con código ${code}`);
      return;
    }
    if (lot.held) { setError(`El lote ${code} está retenido por calidad`); return; }
    setScannedLot(lot);
  }

  const availableLots = lots.filter(l => !l.held && (l.remaining_weight || 0) > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Repeat className="w-6 h-6" /> Vuelco</h1>
        <p className="text-muted-foreground">Habilitar kilos de materia prima para producción</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Escaneo */}
        <Card>
          <CardHeader><CardTitle className="text-base">Escanear lote para volcar</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!scannedLot ? (
              <>
                <QRScanner label="Escanear QR del lote" onScan={handleScan} />
                {error && <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>}
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground mb-2">Lotes disponibles ({availableLots.length})</p>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {availableLots.map(l => (
                      <button key={l.id} onClick={() => setScannedLot(l)} className="w-full text-left border rounded-lg p-2 hover:bg-muted text-sm">
                        <div className="flex justify-between">
                          <span className="font-mono">{l.lot_code}</span>
                          <StatusBadge status={l.status} />
                        </div>
                        <p className="text-xs text-muted-foreground">{l.producer} · {l.variety} · Saldo: {fmtKg(l.remaining_weight)}</p>
                      </button>
                    ))}
                    {availableLots.length === 0 && <p className="text-sm text-muted-foreground">No hay lotes con saldo disponible.</p>}
                  </div>
                </div>
              </>
            ) : (
              <DumpForm lot={scannedLot} onCancel={() => { setScannedLot(null); setError(""); }} onSaved={() => { setScannedLot(null); refresh(); }} />
            )}
          </CardContent>
        </Card>

        {/* Resumen / eventos recientes */}
        <Card>
          <CardHeader><CardTitle className="text-base">Eventos de vuelco recientes</CardTitle></CardHeader>
          <CardContent>
            {loading ? <p className="text-sm text-muted-foreground">Cargando…</p> :
              dumps.length === 0 ? <p className="text-sm text-muted-foreground">Sin vuelcos registrados.</p> : (
                <div className="space-y-2">
                  {dumps.map(d => (
                    <div key={d.id} className="border rounded-lg p-2 text-sm">
                      <div className="flex justify-between">
                        <span className="font-mono text-xs">{d.dump_code}</span>
                        <span className="text-xs text-muted-foreground">{fmtDate(d.dump_date)}</span>
                      </div>
                      <p>{d.bins_dumped ? `${d.bins_dumped} BINs · ` : ""}{fmtKg(d.net_weight)} · Lote {d.receipt_lot_code}</p>
                    </div>
                  ))}
                </div>
              )
            }
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DumpForm({ lot, onCancel, onSaved }) {
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
      const { error: rpcError } = await supabase.rpc("dump_lot_by_bins", {
        p_operation_id: operationId,
        p_lot_id: lot.id,
        p_bins: selectedBins,
        p_dump_code: dumpCode,
      });
      if (rpcError) throw rpcError;
      onSaved();
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
          <span>Recibido: <b>{fmtKg(lot.net_weight)}</b></span>
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
