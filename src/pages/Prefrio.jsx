import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { generateCode } from "@/lib/qr";
import StoragePage from "@/components/cold-storage/StoragePage";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Prefrio() { return <StoragePage type="tunel" AddForm={TunnelForm} />; }

function TunnelForm({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", capacity: "18", positions: "18", setpoint_temp: "0", target_temp: "0" });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    try {
      await base44.entities.Location.create({
        location_code: generateCode("TUN"),
        name: form.name, type: "tunel",
        capacity: 18,
        positions: 18,
        occupied: 0,
        setpoint_temp: Number(form.setpoint_temp) || 0,
        target_temp: Number(form.target_temp) || 0,
        active: true,
      });
      onSaved();
    } catch { setSaving(false); }
  }

  return (
    <Card><CardContent className="p-4 space-y-3">
      <h3 className="font-medium">Nuevo túnel</h3>
      <p className="text-sm text-muted-foreground">La distribución se elige en el plano antes de ingresar pallets.</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1"><Label className="text-xs">Nombre *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Túnel 1" /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Setpoint (°C)</Label><Input type="number" step="0.1" value={form.setpoint_temp} onChange={e => setForm(f => ({ ...f, setpoint_temp: e.target.value }))} /></div>
          <div className="space-y-1"><Label className="text-xs">Temp. objetivo (°C)</Label><Input type="number" step="0.1" value={form.target_temp} onChange={e => setForm(f => ({ ...f, target_temp: e.target.value }))} /></div>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? "Creando…" : "Crear"}</Button>
        </div>
      </form>
    </CardContent></Card>
  );
}
