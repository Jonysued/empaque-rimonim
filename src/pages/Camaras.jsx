import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { generateCode, fmtKg } from "@/lib/qr";
import { movePalletLocation } from "@/lib/palletMovements";
import QRScanner from "@/components/QRScanner";
import LocationQR from "@/components/LocationQR";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Warehouse, Plus, Thermometer, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

export default function Camaras() {
  const [chambers, setChambers] = useState([]);
  const [pallets, setPallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [activeChamber, setActiveChamber] = useState(null);
  const [scanMode, setScanMode] = useState(false);
  const [error, setError] = useState("");
  const [scannedPallet, setScannedPallet] = useState(null);

  async function refresh() {
    setLoading(true);
    try {
      const [locs, p] = await Promise.all([
        base44.entities.Location.list(),
        base44.entities.Pallet.list(),
      ]);
      setChambers((locs || []).filter(l => l.type === "camara"));
      setPallets(p || []);
      setActiveChamber(prev => prev ? (locs || []).find(x => x.id === prev.id) || prev : prev);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  async function handleScan(code) {
    setError("");
    const chamber = chambers.find(c => c.location_code === code);
    if (chamber) { setActiveChamber(chamber); setScannedPallet(null); return; }
    const pallet = pallets.find(p => p.pallet_code === code);
    if (pallet) {
      if (!activeChamber) { setError("Escanee primero el QR de la cámara"); return; }
      await loadPalletIntoChamber(activeChamber, pallet);
      return;
    }
    setError(`Código no reconocido: ${code}`);
  }

  async function loadPalletIntoChamber(chamberRef, pallet) {
    setError("");
    const chamber = chambers.find(x => x.id === chamberRef.id) || chamberRef;
    try {
      const result = await movePalletLocation("carga_camara", pallet.id, chamber.id);
      if (result.pending) toast.warning("Guardado en este dispositivo; pendiente de sincronizar");
      else { setScannedPallet(pallet); refresh(); }
    } catch (e) { setError(e.message || "Error"); }
  }

  async function removePallet(pallet) {
    try {
      const result = await movePalletLocation("retiro_camara", pallet.id, pallet.location_id);
      if (result.pending) toast.warning("Guardado en este dispositivo; pendiente de sincronizar");
      else refresh();
    } catch (e) { setError(e.message || "Error al retirar pallet"); }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Warehouse className="w-6 h-6" /> Cámaras</h1>
          <p className="text-muted-foreground">Cámaras frigoríficas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4 mr-1" /> Nueva cámara</Button>
          <Button onClick={() => setScanMode(!scanMode)}><Warehouse className="w-4 h-4 mr-1" /> {scanMode ? "Salir" : "Ingresar pallet"}</Button>
        </div>
      </div>

      {scanMode && (
        <Card className="border-indigo-300 bg-indigo-50">
          <CardContent className="p-4 space-y-3">
            <p className="font-medium text-indigo-900">Ingreso de pallet a cámara</p>
            <p className="text-sm text-indigo-800">1. Escanee el QR de la cámara · 2. Escanee los QR de los pallets</p>
            {activeChamber && (
              <div className="bg-white rounded-lg p-2 border text-sm">
                Cámara activa: <b>{activeChamber.name}</b> · Disponible {Math.max(0, (activeChamber.capacity || 0) - (activeChamber.occupied || 0))} posiciones
              </div>
            )}
            <QRScanner label="Escanear QR (cámara o pallet)" onScan={handleScan} />
            {error && <p className="text-sm text-destructive bg-white p-2 rounded">{error}</p>}
            {scannedPallet && <p className="text-sm text-green-700 bg-white p-2 rounded">✓ Pallet {scannedPallet.romaneo_number} ingresado</p>}
          </CardContent>
        </Card>
      )}

      {error && !scanMode && <p className="text-sm text-destructive">{error}</p>}

      {chambers.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Warehouse className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No hay cámaras configuradas.</p>
        </CardContent></Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {chambers.map(c => {
            const occ = c.occupied || 0;
            const cap = c.capacity || 0;
            const pct = cap ? Math.round(occ / cap * 100) : 0;
            const chamberPallets = pallets.filter(p => p.location_id === c.id && p.status === "en_camara");
            return (
              <Card key={c.id} className={pct >= 100 ? "border-red-300" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{c.name}</span>
                    <span className={`text-xs ${pct >= 100 ? "text-red-600" : "text-muted-foreground"}`}>{occ}/{cap} pallets</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="w-full bg-muted rounded-full h-2"><div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${pct}%` }} /></div>
                  {c.setpoint_temp != null && <p className="text-xs flex items-center gap-1"><Thermometer className="w-3 h-3" /> Setpoint: {c.setpoint_temp}°C · Humedad: {c.humidity || "—"}%</p>}
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10px] text-muted-foreground">{c.location_code}</p>
                    <LocationQR location={c} />
                  </div>
                  {chamberPallets.length > 0 && (
                    <div className="space-y-1 pt-1 border-t max-h-40 overflow-y-auto">
                      {chamberPallets.map(p => (
                        <div key={p.id} className="flex items-center justify-between text-xs">
                          <div>
                            <span className="font-mono">{p.romaneo_number}</span>
                            <span className="text-muted-foreground ml-1">{fmtKg(p.net_weight)}</span>
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => removePallet(p)}>
                            <ArrowRightLeft className="w-3 h-3 mr-1" /> Retirar
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {showAdd && <ChamberForm onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); refresh(); }} />}
    </div>
  );
}

function ChamberForm({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", capacity: "100", setpoint_temp: "0", humidity: "85", product_type_filter: "" });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    try {
      await base44.entities.Location.create({
        location_code: generateCode("CAM"),
        name: form.name, type: "camara",
        capacity: Number(form.capacity) || 100,
        occupied: 0,
        setpoint_temp: Number(form.setpoint_temp) || 0,
        humidity: Number(form.humidity) || 0,
        product_type_filter: form.product_type_filter,
        active: true,
      });
      onSaved();
    } catch { setSaving(false); }
  }

  return (
    <Card><CardContent className="p-4 space-y-3">
      <h3 className="font-medium">Nueva cámara</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1"><Label className="text-xs">Nombre *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Cámara 1" /></div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1"><Label className="text-xs">Capacidad</Label><Input type="number" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} /></div>
          <div className="space-y-1"><Label className="text-xs">Setpoint (°C)</Label><Input type="number" step="0.1" value={form.setpoint_temp} onChange={e => setForm(f => ({ ...f, setpoint_temp: e.target.value }))} /></div>
          <div className="space-y-1"><Label className="text-xs">Humedad (%)</Label><Input type="number" value={form.humidity} onChange={e => setForm(f => ({ ...f, humidity: e.target.value }))} /></div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tipo de producto</Label>
          <Input value={form.product_type_filter} onChange={e => setForm(f => ({ ...f, product_type_filter: e.target.value }))} placeholder="fresco, arilos, sin_procesar (opcional)" />
        </div>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? "Creando…" : "Crear"}</Button>
        </div>
      </form>
    </CardContent></Card>
  );
}
