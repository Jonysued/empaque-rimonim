import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
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
                      <p>{fmtKg(d.net_weight)} · Lote {d.receipt_lot_code}</p>
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
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const saldo = lot.remaining_weight || 0;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const kg = Number(weight);
    if (!kg || kg <= 0) return setError("Ingrese kilos válidos");
    if (kg > saldo) return setError(`No puede volcar más del saldo disponible (${fmtKg(saldo)})`);
    setSaving(true);
    try {
      const code = generateCode("VOL");
      const now = new Date().toISOString();
      await base44.entities.DumpingEvent.create({
        dump_code: code,
        receipt_lot_id: lot.id,
        receipt_lot_code: lot.lot_code,
        dump_date: now,
        net_weight: kg,
        producer: lot.producer,
        variety: lot.variety,
      });
      // Actualizar saldo del lote
      const newRemaining = saldo - kg;
      const newDumped = (lot.dumped_weight || 0) + kg;
      await base44.entities.ReceiptLot.update(lot.id, {
        remaining_weight: newRemaining,
        dumped_weight: newDumped,
        status: newRemaining <= 0.01 ? "volcado" : "parcialmente_volcado",
      });
      onSaved();
    } catch (e) {
      setError(e.message || "Error al registrar vuelco");
      setSaving(false);
    }
  }

  function volcarTodo() {
    setWeight(String(saldo));
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
        <p className="text-sm">Saldo disponible: <b className="text-blue-700">{fmtKg(saldo)}</b></p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>}
        <div className="space-y-1">
          <Label className="text-xs">Kilos a volcar (kg) *</Label>
          <Input type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} autoFocus />
          <Button type="button" variant="outline" size="sm" onClick={volcarTodo}>Volcar saldo completo ({fmtKg(saldo)})</Button>
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