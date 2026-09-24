import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { generateCode, fmtKg, fmtDate, fmtNum } from "@/lib/qr";
import { loadCatalog } from "@/lib/catalogs";
import { loadPalletsIntoShipment, AVAILABLE_FOR_SHIPMENT } from "@/lib/shipments";
import { Checkbox } from "@/components/ui/checkbox";
import QRScanner from "@/components/QRScanner";
import QRLabel from "@/components/QRLabel";
import PrintPackingList from "@/components/PrintPackingList";
import StatusBadge from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Truck, Plus, Package, CheckCircle2, ClipboardList } from "lucide-react";

export default function Despachos() {
  const [shipments, setShipments] = useState([]);
  const [pallets, setPallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [cats, setCats] = useState({});

  async function refresh() {
    setLoading(true);
    try {
      const [s, p, clients] = await Promise.all([
        base44.entities.Shipment.list("-created_date", 50),
        base44.entities.Pallet.list(),
        loadCatalog("cliente"),
      ]);
      setShipments(s || []);
      setPallets(p || []);
      setSelected(previous => previous ? (s || []).find(item => item.id === previous.id) || previous : null);
      setCats({ cliente: clients });
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Truck className="w-6 h-6" /> Despachos</h1>
          <p className="text-muted-foreground">Cargas y contenedores</p>
        </div>
        <Button size="lg" onClick={() => setShowForm(true)}><Plus className="w-5 h-5 mr-1" /> Nueva carga</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin" /></div>
      ) : shipments.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Truck className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No hay despachos registrados.</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {shipments.map(s => (
            <Card key={s.id} className="cursor-pointer hover:shadow-md" onClick={() => setSelected(s)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold">{s.load_number}</span>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">{s.client || "Sin cliente"} · {s.destination || "—"}</p>
                    <p className="text-xs text-muted-foreground">{s.product_type === "fresco" ? "Fresco" : "Arilos"} · {fmtDate(s.date)}</p>
                    {s.container_number && <p className="text-xs font-mono">Contenedor: {s.container_number}</p>}
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-sm"><b>{(s.loaded_pallet_ids || []).length}</b> / {s.target_capacity || 21} pallets</p>
                    <p className="text-sm">{fmtKg(s.total_weight)}</p>
                    <p className="text-xs text-muted-foreground">{fmtNum(s.total_packages)} bultos</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm && <ShipmentForm cats={cats} pallets={pallets} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refresh(); }} />}
      {selected && <ShipmentDetail shipment={selected} pallets={pallets} onClose={() => setSelected(null)} onChanged={refresh} />}
    </div>
  );
}

function ShipmentForm({ cats, pallets, onClose, onSaved }) {
  const [form, setForm] = useState({ load_number: "", client: "", destination: "", product_type: "fresco", target_capacity: "21", carrier: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());

  const capacity = Number(form.target_capacity) || 21;
  const available = (pallets || []).filter(p => AVAILABLE_FOR_SHIPMENT.includes(p.status) && p.product_type === form.product_type);

  function togglePallet(id, checked) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) { if (next.size >= capacity) return prev; next.add(id); } else { next.delete(id); }
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.load_number) return setError("Número de carga obligatorio");
    setSaving(true);
    try {
      const created = await base44.entities.Shipment.create({
        ...form,
        shipment_code: generateCode("DSP"),
        date: new Date().toISOString(),
        target_capacity: Number(form.target_capacity) || 21,
        status: "borrador",
        reserved_pallet_ids: [], loaded_pallet_ids: [],
        total_weight: 0, total_packages: 0,
      });
      const selected = available.filter(p => selectedIds.has(p.id)).slice(0, capacity);
      if (selected.length > 0) await loadPalletsIntoShipment(created, selected);
      onSaved();
    } catch (e) { setError(e.message || "Error"); setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Nueva carga / despacho</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>}
          <div className="space-y-1"><Label className="text-xs">Número de carga *</Label><Input value={form.load_number} onChange={e => setForm(f => ({ ...f, load_number: e.target.value }))} placeholder="Carga-001" /></div>
          <div className="space-y-1">
            <Label className="text-xs">Cliente</Label>
            <Select value={form.client} onValueChange={v => setForm(f => ({ ...f, client: v }))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
              <SelectContent>{(cats.cliente || []).map(o => <SelectItem key={o.label} value={o.label}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Destino</Label><Input value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Producto</Label>
              <Select value={form.product_type} onValueChange={v => { setForm(f => ({ ...f, product_type: v })); setSelectedIds(new Set()); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="fresco">Fresco</SelectItem><SelectItem value="arilos">Arilos</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Capacidad objetivo</Label><Input type="number" value={form.target_capacity} onChange={e => setForm(f => ({ ...f, target_capacity: e.target.value }))} /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Transportista</Label><Input value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))} /></div>
          <div className="space-y-2">
            <Label className="text-xs">Pallets disponibles ({available.length})</Label>
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay pallets liberados del prefrio o cámaras para este producto.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
                {available.map(p => (
                  <label key={p.id} className="flex items-center gap-3 p-2 text-sm cursor-pointer hover:bg-accent">
                    <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={v => togglePallet(p.id, v)} />
                    <span className="font-mono font-medium">{p.romaneo_number}</span>
                    <StatusBadge status={p.status} />
                    <span className="ml-auto text-muted-foreground">{fmtKg(p.net_weight)} · {p.package_count || 0} bultos</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Selección: {selectedIds.size}/{capacity} pallets.</p>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Creando…" : "Crear carga"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShipmentDetail({ shipment, pallets, onClose, onChanged }) {
  const [scanMode, setScanMode] = useState(false);
  const [error, setError] = useState("");
  const [extra, setExtra] = useState({ container_number: "", remito: "", thermograph: "", seal: "" });

  useEffect(() => {
    setExtra({
      container_number: shipment.container_number || "",
      remito: shipment.remito || "",
      thermograph: shipment.thermograph || "",
      seal: shipment.seal || "",
    });
  }, [shipment.id]);

  async function handleScan(code) {
    setError("");
    const pallet = pallets.find(p => p.pallet_code === code || p.romaneo_number === code);
    if (!pallet) { setError(`Pallet no encontrado: ${code}`); return; }
    if (pallet.product_type !== shipment.product_type) { setError(`El pallet es ${pallet.product_type}, la carga es ${shipment.product_type}`); return; }
    if (!AVAILABLE_FOR_SHIPMENT.includes(pallet.status)) { setError("El pallet debe estar liberado de prefrío o cámara antes de cargarlo"); return; }
    if ((shipment.loaded_pallet_ids || []).includes(pallet.id)) { setError("El pallet ya está cargado"); return; }
    if ((shipment.loaded_pallet_ids || []).length >= (shipment.target_capacity || 21)) { setError("Capacidad de carga alcanzada"); return; }
    try {
      await loadPalletsIntoShipment(shipment, [pallet]);
      onChanged();
    } catch (e) { setError(e.message || "Error"); }
  }

  async function saveExtra() {
    try {
      await base44.entities.Shipment.update(shipment.id, extra);
      onChanged();
    } catch (e) { setError(e.message); }
  }

  async function closeShipment() {
    try {
      await base44.entities.Shipment.update(shipment.id, { status: "enviado", ...extra });
      onChanged();
    } catch (e) { setError(e.message); }
  }

  const loadedPallets = (shipment.loaded_pallet_ids || []).map(id => pallets.find(p => p.id === id)).filter(Boolean);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Carga {shipment.load_number}</DialogTitle></DialogHeader>
          <PrintPackingList shipment={{ ...shipment, ...Object.fromEntries(Object.entries(extra).filter(entry => entry[1])) }} pallets={loadedPallets} />
        <div className="space-y-4">
          <div className="flex justify-center"><QRLabel code={shipment.shipment_code} title="Despacho" subtitle={shipment.load_number} /></div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Info label="Cliente" value={shipment.client || "—"} />
            <Info label="Destino" value={shipment.destination || "—"} />
            <Info label="Producto" value={shipment.product_type === "fresco" ? "Fresco" : "Arilos"} />
            <Info label="Estado" value={shipment.status} />
            <Info label="Pallets cargados" value={`${loadedPallets.length}/${shipment.target_capacity || 21}`} />
            <Info label="Peso total" value={fmtKg(shipment.total_weight)} />
          </div>

          {/* Datos de carga */}
          <div className="border-t pt-3 space-y-2">
            <h4 className="font-medium flex items-center gap-2"><ClipboardList className="w-4 h-4" /> Datos de carga</h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-xs">Contenedor</Label><Input value={extra.container_number} onChange={e => setExtra(f => ({ ...f, container_number: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Remito</Label><Input value={extra.remito} onChange={e => setExtra(f => ({ ...f, remito: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Termógrafo</Label><Input value={extra.thermograph} onChange={e => setExtra(f => ({ ...f, thermograph: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Precinto</Label><Input value={extra.seal} onChange={e => setExtra(f => ({ ...f, seal: e.target.value }))} /></div>
            </div>
            <Button size="sm" variant="outline" onClick={saveExtra}>Guardar datos</Button>
          </div>

          {/* Carga de pallets */}
          <div className="border-t pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-medium flex items-center gap-2"><Package className="w-4 h-4" /> Pallets cargados ({loadedPallets.length})</h4>
              <Button size="sm" onClick={() => setScanMode(!scanMode)}>{scanMode ? "Salir" : "Cargar pallet"}</Button>
            </div>
            {scanMode && (
              <div className="bg-muted/50 p-3 rounded-lg space-y-2">
                <p className="text-sm">Escanee el QR del pallet para cargarlo en esta carga</p>
                <QRScanner label="Escanear QR del pallet" onScan={handleScan} />
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            )}
            {loadedPallets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin pallets cargados.</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {loadedPallets.map(p => (
                  <div key={p.id} className="flex justify-between text-sm border rounded p-2">
                    <span className="font-mono">{p.romaneo_number}</span>
                    <span>{fmtKg(p.net_weight)} · {p.package_count || 0} bultos</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {shipment.status !== "enviado" && loadedPallets.length > 0 && (
            <Button onClick={closeShipment} className="w-full"><CheckCircle2 className="w-4 h-4 mr-2" /> Cerrar y enviar despacho</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }) {
  return <div className="flex justify-between border-b pb-1"><span className="text-muted-foreground">{label}</span><span className="font-medium text-right">{value}</span></div>;
}
