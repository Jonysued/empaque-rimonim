import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { generateCode, fmtKg, fmtDate } from "@/lib/qr";
import QRScanner from "@/components/QRScanner";
import StatusBadge from "@/components/StatusBadge";
import LocationQR from "@/components/LocationQR";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Snowflake, Plus, Thermometer, Clock, CheckCircle2 } from "lucide-react";

export default function Prefrio() {
  const [tunnels, setTunnels] = useState([]);
  const [pallets, setPallets] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [activeTunnel, setActiveTunnel] = useState(null);
  const [scanMode, setScanMode] = useState(false);
  const [error, setError] = useState("");
  const [scannedPallet, setScannedPallet] = useState(null);

  async function refresh() {
    setLoading(true);
    try {
      const [t, p, c] = await Promise.all([
        base44.entities.Location.filter({ type: "tunel" }),
        base44.entities.Pallet.list(),
        base44.entities.CoolingCycle.list("-created_date", 20),
      ]);
      setTunnels(t || []);
      setPallets(p || []);
      setCycles(c || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  // Escaneo: primero túnel, luego pallets
  async function handleScan(code) {
    setError("");
    // ¿Es un túnel?
    const tunnel = tunnels.find(t => t.location_code === code);
    if (tunnel) {
      setActiveTunnel(tunnel);
      setScannedPallet(null);
      return;
    }
    // ¿Es un pallet?
    const pallet = pallets.find(p => p.pallet_code === code);
    if (pallet) {
      if (!activeTunnel) {
        setError("Escanee primero el QR del túnel");
        return;
      }
      await loadPalletIntoTunnel(activeTunnel, pallet);
      return;
    }
    setError(`Código no reconocido: ${code}`);
  }

  async function loadPalletIntoTunnel(tunnel, pallet) {
    setError("");
    if (pallet.status === "en_tunel") { setError(`El pallet ${pallet.romaneo_number} ya está en un túnel`); return; }
    if (pallet.held || pallet.status === "retenido") { setError(`El pallet ${pallet.romaneo_number} está retenido`); return; }
    if ((tunnel.occupied || 0) >= (tunnel.capacity || 0)) { setError(`El túnel ${tunnel.name} está lleno`); return; }
    try {
      // Buscar ciclo abierto del túnel o crear uno
      let cycle = cycles.find(c => c.tunnel_id === tunnel.id && c.status === "abierto");
      const now = new Date().toISOString();
      if (!cycle) {
        cycle = await base44.entities.CoolingCycle.create({
          cycle_code: generateCode("CIC"),
          tunnel_id: tunnel.id, tunnel_name: tunnel.name,
          start_time: now, reference_hours: 15,
          status: "abierto", pallet_ids: [],
          target_temp: tunnel.target_temp || 0, initial_temp: 0,
        });
      }
      // Actualizar pallet
      await base44.entities.Pallet.update(pallet.id, {
        status: "en_tunel",
        location_id: tunnel.id, location_name: tunnel.name,
        tunnel_entry_time: now,
      });
      // Actualizar ciclo
      await base44.entities.CoolingCycle.update(cycle.id, {
        pallet_ids: [...(cycle.pallet_ids || []), pallet.id],
      });
      // Actualizar ocupación del túnel
      await base44.entities.Location.update(tunnel.id, { occupied: (tunnel.occupied || 0) + 1 });
      // Movimiento
      await base44.entities.MovementEvent.create({
        event_code: generateCode("MOV"),
        unit_type: "pallet", unit_id: pallet.id, unit_code: pallet.pallet_code,
        destination_location_id: tunnel.id, destination_location_name: tunnel.name,
        action: "carga_tunel",
      });
      setScannedPallet(pallet);
      refresh();
    } catch (e) { setError(e.message || "Error al cargar pallet"); }
  }

  async function releasePallet(pallet) {
    const tunnel = tunnels.find(t => t.id === pallet.location_id);
    if (!tunnel) return;
    try {
      await base44.entities.Pallet.update(pallet.id, { status: "liberado", tunnel_exit_time: new Date().toISOString() });
      await base44.entities.Location.update(tunnel.id, { occupied: Math.max(0, (tunnel.occupied || 0) - 1) });
      await base44.entities.MovementEvent.create({
        event_code: generateCode("MOV"),
        unit_type: "pallet", unit_id: pallet.id, unit_code: pallet.pallet_code,
        origin_location_id: tunnel.id, origin_location_name: tunnel.name,
        action: "liberacion_tunel",
      });
      refresh();
    } catch (e) { console.error(e); }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Snowflake className="w-6 h-6" /> Prefrío</h1>
          <p className="text-muted-foreground">Túneles de pre-enfriado</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4 mr-1" /> Nuevo túnel</Button>
          <Button onClick={() => setScanMode(!scanMode)}><Snowflake className="w-4 h-4 mr-1" /> {scanMode ? "Salir" : "Cargar pallet"}</Button>
        </div>
      </div>

      {scanMode && (
        <Card className="border-cyan-300 bg-cyan-50">
          <CardContent className="p-4 space-y-3">
            <p className="font-medium text-cyan-900">Carga de pallet en túnel</p>
            <p className="text-sm text-cyan-800">1. Escanee el QR del túnel · 2. Escanee los QR de los pallets</p>
            {activeTunnel && (
              <div className="bg-white rounded-lg p-2 border text-sm">
                Túnel activo: <b>{activeTunnel.name}</b> · Ocupación {activeTunnel.occupied || 0}/{activeTunnel.capacity || 0}
              </div>
            )}
            <QRScanner label="Escanear QR (túnel o pallet)" onScan={handleScan} />
            {error && <p className="text-sm text-destructive bg-white p-2 rounded">{error}</p>}
            {scannedPallet && <p className="text-sm text-green-700 bg-white p-2 rounded">✓ Pallet {scannedPallet.romaneo_number} cargado</p>}
          </CardContent>
        </Card>
      )}

      {tunnels.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Snowflake className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No hay túneles configurados.</p>
          <p className="text-sm mt-1">Use «Nuevo túnel» o configure desde Catálogos.</p>
        </CardContent></Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {tunnels.map(t => {
            const occ = t.occupied || 0;
            const cap = t.capacity || 0;
            const pct = cap ? Math.round(occ / cap * 100) : 0;
            const tunnelPallets = pallets.filter(p => p.location_id === t.id && p.status === "en_tunel");
            const releasedPallets = pallets
              .filter(p => p.location_id === t.id && p.status === "liberado")
              .sort((a, b) => (b.tunnel_exit_time || "").localeCompare(a.tunnel_exit_time || ""))
              .slice(0, 3);
            const fmtTime = d => d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
            return (
              <Card key={t.id} className={pct >= 100 ? "border-red-300" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{t.name}</span>
                    <span className={`text-xs ${pct >= 100 ? "text-red-600" : "text-muted-foreground"}`}>{occ}/{cap}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="w-full bg-muted rounded-full h-2"><div className="bg-cyan-500 h-2 rounded-full" style={{ width: `${pct}%` }} /></div>
                  <div className="text-xs space-y-1">
                    {t.setpoint_temp != null && <p className="flex items-center gap-1"><Thermometer className="w-3 h-3" /> Setpoint: {t.setpoint_temp}°C</p>}
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-[10px] text-muted-foreground">{t.location_code}</p>
                      <LocationQR location={t} />
                    </div>
                  </div>
                  {tunnelPallets.length > 0 && (
                    <div className="space-y-1 pt-1 border-t">
                      {tunnelPallets.map(p => (
                        <div key={p.id} className="flex items-center justify-between text-xs">
                          <div>
                            <span className="font-mono">{p.romaneo_number}</span>
                            <p className="text-[10px] text-muted-foreground">Ingresado {fmtTime(p.tunnel_entry_time)}</p>
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => releasePallet(p)}>
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Liberar
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {releasedPallets.length > 0 && (
                    <div className="space-y-1 pt-1 border-t">
                      <p className="text-[10px] text-muted-foreground">Liberados</p>
                      {releasedPallets.map(p => (
                        <div key={p.id} className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="font-mono">{p.romaneo_number}</span>
                          <span>{fmtTime(p.tunnel_entry_time)} → {fmtTime(p.tunnel_exit_time)}</span>
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
      {showAdd && <TunnelForm onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); refresh(); }} />}
    </div>
  );
}

function TunnelForm({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", capacity: 18, positions: 18, setpoint_temp: 0, target_temp: 0 });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    try {
      await base44.entities.Location.create({
        location_code: generateCode("TUN"),
        name: form.name, type: "tunel",
        capacity: Number(form.capacity) || 18,
        positions: Number(form.positions) || 18,
        occupied: 0,
        setpoint_temp: Number(form.setpoint_temp) || 0,
        target_temp: Number(form.target_temp) || 0,
        active: true,
      });
      onSaved();
    } catch (e) { setSaving(false); }
  }

  return (
    <Card><CardContent className="p-4 space-y-3">
      <h3 className="font-medium">Nuevo túnel</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1"><Label className="text-xs">Nombre *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Túnel 1" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs">Capacidad (pallets)</Label><Input type="number" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} /></div>
          <div className="space-y-1"><Label className="text-xs">Posiciones</Label><Input type="number" value={form.positions} onChange={e => setForm(f => ({ ...f, positions: e.target.value }))} /></div>
          <div className="space-y-1"><Label className="text-xs">Setpoint (°C)</Label><Input type="number" step="0.1" value={form.setpoint_temp} onChange={e => setForm(f => ({ ...f, setpoint_temp: e.target.value }))} /></div>
          <div className="space-y-1"><Label className="text-xs">Temp. objetivo (°C)</Label><Input type="number" step="0.1" value={form.target_temp} onChange={e => setForm(f => ({ ...f, target_temp: e.target.value }))} /></div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? "Creando…" : "Crear"}</Button>
        </div>
      </form>
    </CardContent></Card>
  );
}