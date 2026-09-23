import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Edit2 } from "lucide-react";

export default function LocationConfig({ type }) {
  const isTunnel = type === "tunel";
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    base44.entities.Location.filter({ type })
      .then((data) => setItems((data || []).sort((a, b) => (a.name || "").localeCompare(b.name || ""))))
      .catch(() => setItems([]));
  };

  useEffect(() => {
    setItems(null);
    load();
  }, [type]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{isTunnel ? "Túneles de prefrío" : "Cámaras de frío"}</CardTitle>
        <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Agregar
        </Button>
      </CardHeader>
      <CardContent>
        {items === null ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Sin registros.</p>
        ) : (
          <div className="space-y-1">
            {items.map((loc) => (
              <div key={loc.id} className="flex items-center justify-between border rounded-lg p-2">
                <div>
                  <p className="font-medium text-sm">
                    {loc.name}{" "}
                    {!loc.active && <span className="text-xs text-destructive">(inactivo)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">{loc.location_code}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex gap-3 text-xs text-muted-foreground">
                    <span>Capacidad: {loc.capacity ?? "—"}</span>
                    <span>Ocupados: {loc.occupied ?? 0}</span>
                    {isTunnel && <span>Posiciones: {loc.positions ?? "—"}</span>}
                    <span>Setpoint: {loc.setpoint_temp ?? "—"} °C</span>
                    {!isTunnel && loc.humidity != null && <span>Humedad: {loc.humidity}%</span>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(loc); setShowForm(true); }}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {showForm && (
        <LocationForm
          type={type}
          item={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
    </Card>
  );
}

function LocationForm({ type, item, onClose, onSaved }) {
  const isTunnel = type === "tunel";
  const [form, setForm] = useState({
    location_code: item?.location_code || "",
    name: item?.name || "",
    capacity: item?.capacity ?? "",
    positions: item?.positions ?? "",
    setpoint_temp: item?.setpoint_temp ?? "",
    target_temp: item?.target_temp ?? "",
    humidity: item?.humidity ?? "",
    product_type_filter: item?.product_type_filter || "",
    active: item?.active ?? true,
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v) => (v === "" || v === null || v === undefined ? undefined : Number(v));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name || (!item && !form.location_code)) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        capacity: num(form.capacity),
        positions: isTunnel ? num(form.positions) : undefined,
        setpoint_temp: num(form.setpoint_temp),
        target_temp: num(form.target_temp),
        humidity: !isTunnel ? num(form.humidity) : undefined,
        product_type_filter: !isTunnel ? form.product_type_filter || "" : undefined,
        active: form.active,
      };
      if (item) {
        await base44.entities.Location.update(item.id, payload);
      } else {
        await base44.entities.Location.create({ ...payload, location_code: form.location_code, type, occupied: 0 });
      }
      onSaved();
    } catch (err) {
      console.error(err);
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? "Editar" : "Agregar"} {isTunnel ? "túnel" : "cámara"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Código QR *</Label>
            <Input
              value={form.location_code}
              onChange={(e) => set("location_code", e.target.value)}
              placeholder={isTunnel ? "TUN-TUN05" : "CAM-CAM03"}
              disabled={!!item}
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Nombre *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Capacidad (pallets)</Label>
              <Input type="number" value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
            </div>
            {isTunnel && (
              <div className="space-y-1">
                <Label className="text-xs">Posiciones internas</Label>
                <Input type="number" value={form.positions} onChange={(e) => set("positions", e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Setpoint temperatura (°C)</Label>
              <Input type="number" step="0.1" value={form.setpoint_temp} onChange={(e) => set("setpoint_temp", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Temperatura objetivo (°C)</Label>
              <Input type="number" step="0.1" value={form.target_temp} onChange={(e) => set("target_temp", e.target.value)} />
            </div>
            {!isTunnel && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Humedad (%)</Label>
                  <Input type="number" value={form.humidity} onChange={(e) => set("humidity", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Filtro de producto</Label>
                  <Select value={form.product_type_filter || "todos"} onValueChange={(v) => set("product_type_filter", v === "todos" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="fresco">Fresco</SelectItem>
                      <SelectItem value="arilos">Arilos</SelectItem>
                      <SelectItem value="sin_procesar">Sin procesar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Estado</Label>
              <Select value={form.active ? "activo" : "inactivo"} onValueChange={(v) => set("active", v === "activo")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="activo">Activo</SelectItem>
                  <SelectItem value="inactivo">Inactivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}