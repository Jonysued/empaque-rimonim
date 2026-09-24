import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { generateCode, fmtKg, fmtDate, fmtNum } from "@/lib/qr";
import { loadCatalog } from "@/lib/catalogs";
import { loadPalletsIntoShipment, unloadPalletFromShipment, reopenShipmentForCorrection, AVAILABLE_FOR_SHIPMENT } from "@/lib/shipments";
import { Checkbox } from "@/components/ui/checkbox";
import QRLabel from "@/components/QRLabel";
import PrintPackingList from "@/components/PrintPackingList";
import StatusBadge from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Truck, Plus, Package, CheckCircle2, ClipboardList, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Despachos() {
  const [shipments, setShipments] = useState([]);
  const [pallets, setPallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
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
      setSelected(previous => previous ? (s || []).find(item => item.id === previous.id) || null : null);
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
      {editing && <ShipmentForm key={editing.id} shipment={editing} cats={cats} pallets={pallets} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {selected && !editing && <ShipmentDetail shipment={selected} pallets={pallets} onClose={() => setSelected(null)} onEdit={() => setEditing(selected)} onChanged={refresh} />}
    </div>
  );
}

function ShipmentForm({ shipment = null, cats, pallets, onClose, onSaved }) {
  const [form, setForm] = useState({
    load_number: shipment?.load_number || "", client: shipment?.client || "", destination: shipment?.destination || "",
    product_type: shipment?.product_type || "fresco", target_capacity: String(shipment?.target_capacity || 21), carrier: shipment?.carrier || "",
    container_number: shipment?.container_number || "", remito: shipment?.remito || "", thermograph: shipment?.thermograph || "", seal: shipment?.seal || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());

  const capacity = Number(form.target_capacity);
  const loadedCount = shipment?.loaded_pallet_ids?.length || 0;
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
    if (!form.load_number.trim()) return setError("Número de carga obligatorio");
    if (!Number.isInteger(capacity) || capacity < 1) return setError("La capacidad debe ser un número entero mayor a cero");
    if (capacity < loadedCount) return setError(`La capacidad no puede ser menor a los ${loadedCount} pallets ya cargados`);
    if (shipment && loadedCount > 0 && form.product_type !== shipment.product_type) return setError("No se puede cambiar el producto de una carga con pallets");
    setSaving(true);
    let created;
    try {
      if (shipment) {
        const latest = await base44.entities.Shipment.get(shipment.id);
        const currentCount = latest.loaded_pallet_ids?.length || 0;
        if (capacity < currentCount) throw new Error(`La carga ahora tiene ${currentCount} pallets. Actualizá la capacidad.`);
        if (currentCount > 0 && form.product_type !== latest.product_type) throw new Error("La carga ya tiene pallets y no permite cambiar el producto");
        await base44.entities.Shipment.update(shipment.id, {
          load_number: form.load_number.trim(), client: form.client, destination: form.destination.trim(),
          product_type: form.product_type, target_capacity: capacity, carrier: form.carrier.trim(),
          container_number: form.container_number.trim(), remito: form.remito.trim(),
          thermograph: form.thermograph.trim(), seal: form.seal.trim(),
        });
        toast.success("Carga actualizada");
        onSaved();
        return;
      }
      created = await base44.entities.Shipment.create({
        ...form, load_number: form.load_number.trim(), destination: form.destination.trim(), carrier: form.carrier.trim(),
        shipment_code: generateCode("DSP"),
        date: new Date().toISOString(),
        target_capacity: capacity,
        status: "borrador",
        reserved_pallet_ids: [], loaded_pallet_ids: [],
        total_weight: 0, total_packages: 0,
      });
      const selected = available.filter(p => selectedIds.has(p.id)).slice(0, capacity);
      const results = selected.length > 0 ? await loadPalletsIntoShipment(created, selected) : [];
      if (results.some(result => result.pending)) toast.warning("Carga creada; algunos pallets están pendientes de sincronizar");
      onSaved();
    } catch (e) {
      if (created) {
        toast.error(`Se creó la carga ${created.load_number}, pero no se completaron todos los pallets. Revisala en Despachos: ${e.message || "error de carga"}`);
        onSaved();
      } else {
        setError(e.message || "Error");
        setSaving(false);
      }
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{shipment ? `Editar carga ${shipment.load_number}` : "Nueva carga / despacho"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>}
          <div className="space-y-1"><Label className="text-xs">Número de carga *</Label><Input value={form.load_number} onChange={e => setForm(f => ({ ...f, load_number: e.target.value }))} placeholder="Carga-001" /></div>
          <div className="space-y-1">
            <Label className="text-xs">Cliente</Label>
            <Select value={form.client} onValueChange={v => setForm(f => ({ ...f, client: v }))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
              <SelectContent>{form.client && !(cats.cliente || []).some(o => o.label === form.client) && <SelectItem value={form.client}>{form.client}</SelectItem>}{(cats.cliente || []).map(o => <SelectItem key={o.label} value={o.label}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Destino</Label><Input value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Producto</Label>
              <Select value={form.product_type} disabled={loadedCount > 0} onValueChange={v => { setForm(f => ({ ...f, product_type: v })); setSelectedIds(new Set()); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="fresco">Fresco</SelectItem><SelectItem value="arilos">Arilos</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Capacidad objetivo</Label><Input type="number" min={Math.max(1, loadedCount)} step="1" value={form.target_capacity} onChange={e => setForm(f => ({ ...f, target_capacity: e.target.value }))} /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Transportista</Label><Input value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))} /></div>
          {shipment && <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Contenedor</Label><Input value={form.container_number} onChange={e => setForm(f => ({ ...f, container_number: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Remito</Label><Input value={form.remito} onChange={e => setForm(f => ({ ...f, remito: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Termógrafo</Label><Input value={form.thermograph} onChange={e => setForm(f => ({ ...f, thermograph: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Precinto</Label><Input value={form.seal} onChange={e => setForm(f => ({ ...f, seal: e.target.value }))} /></div>
          </div>}
          {shipment && ["borrador", "reservado", "cargado"].includes(shipment.status) && (
            <ShipmentPalletEditor shipment={shipment} pallets={pallets} onSaved={onSaved} />
          )}
          {!shipment && <div className="space-y-2">
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
          </div>}
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando…" : shipment ? "Guardar cambios" : "Crear carga"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShipmentPalletEditor({ shipment, pallets, onSaved }) {
  const [palletToRemove, setPalletToRemove] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loadedIds = shipment.loaded_pallet_ids || [];
  const loaded = loadedIds.map(id => pallets.find(p => p.id === id) || { id, romaneo_number: "Pallet sin datos locales" });
  const available = pallets.filter(p => AVAILABLE_FOR_SHIPMENT.includes(p.status) && p.product_type === shipment.product_type);

  async function changePallet(pallet, remove = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = remove
        ? await unloadPalletFromShipment(shipment.id, pallet.id)
        : (await loadPalletsIntoShipment(shipment, [pallet]))[0];
      if (result?.pending) toast.warning("Cambio guardado en este dispositivo; pendiente de sincronizar");
      else toast.success(remove ? "Pallet retirado de la carga" : "Pallet agregado a la carga");
      onSaved();
    } catch (e) {
      setError(e.message || "No se pudo modificar el pallet");
      setBusy(false);
    }
  }

  return <div className="border-t pt-3 space-y-2">
    <Label>Pallets cargados ({loaded.length}/{shipment.target_capacity || 21})</Label>
    <p className="text-xs text-muted-foreground">Los pallets se actualizan al agregarlos o retirarlos. Guardá los cambios en los datos de la carga por separado.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loaded.length === 0 && <p className="text-sm text-muted-foreground">Sin pallets cargados.</p>}
    <div className="max-h-40 overflow-y-auto divide-y border rounded-md">
      {loaded.map(p => <div key={p.id} className="flex items-center justify-between gap-2 p-2 text-sm">
        <span className="font-mono">{p.romaneo_number}</span>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPalletToRemove(p)}>Retirar</Button>
      </div>)}
    </div>
    {palletToRemove && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm">
      <p>¿Retirar el pallet {palletToRemove.romaneo_number} de la carga {shipment.load_number}?</p>
      <p>Volverá a estar disponible y se recalcularán el peso y los bultos.</p>
      <div className="flex gap-2 justify-end">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPalletToRemove(null)}>Cancelar</Button>
        <Button type="button" size="sm" disabled={busy} onClick={() => changePallet(palletToRemove, true)}>{busy ? "Retirando…" : "Confirmar retiro"}</Button>
      </div>
    </div>}
    <Label>Pallets disponibles ({available.length})</Label>
    {available.length === 0 && <p className="text-sm text-muted-foreground">No hay pallets disponibles para este producto.</p>}
    <div className="max-h-40 overflow-y-auto divide-y border rounded-md">
      {available.map(p => <div key={p.id} className="flex items-center justify-between gap-2 p-2 text-sm">
        <span className="font-mono">{p.romaneo_number}</span>
        <Button type="button" size="sm" variant="outline" disabled={busy || loaded.length >= (shipment.target_capacity || 21)} onClick={() => changePallet(p)}>Agregar</Button>
      </div>)}
    </div>
  </div>;
}

function ShipmentDetail({ shipment, pallets, onClose, onEdit, onChanged }) {
  const [error, setError] = useState("");
  const [palletToRemove, setPalletToRemove] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenOperationId] = useState(() => crypto.randomUUID());
  const [extra, setExtra] = useState({ container_number: "", remito: "", thermograph: "", seal: "" });

  useEffect(() => {
    setExtra({
      container_number: shipment.container_number || "",
      remito: shipment.remito || "",
      thermograph: shipment.thermograph || "",
      seal: shipment.seal || "",
    });
  }, [shipment.id]);

  async function saveExtra() {
    try {
      await base44.entities.Shipment.update(shipment.id, extra);
      onChanged();
    } catch (e) { setError(e.message); }
  }

  async function removePallet() {
    if (!palletToRemove || removing) return;
    setRemoving(true);
    setError("");
    try {
      const result = await unloadPalletFromShipment(shipment.id, palletToRemove.id);
      setPalletToRemove(null);
      if (result.pending) toast.warning("Retiro guardado en este dispositivo; pendiente de sincronizar");
      else { toast.success("Pallet retirado de la carga"); onChanged(); }
    } catch (e) { setError(e.message || "No se pudo retirar el pallet"); }
    finally { setRemoving(false); }
  }

  async function reopenShipment() {
    if (reopening) return;
    setReopening(true);
    setError("");
    try {
      await reopenShipmentForCorrection(shipment.id, reopenOperationId);
      setConfirmReopen(false);
      toast.success("Carga reabierta. Ya podés corregir los pallets.");
      onChanged();
    } catch (e) { setError(e.message || "No se pudo reabrir la carga"); }
    finally { setReopening(false); }
  }

  async function closeShipment() {
    try {
      await base44.entities.Shipment.update(shipment.id, { status: "enviado", ...extra });
      onChanged();
    } catch (e) { setError(e.message); }
  }

  const loadedPallets = (shipment.loaded_pallet_ids || []).map(id => pallets.find(p => p.id === id)).filter(Boolean);
  const canChangePallets = ["borrador", "reservado", "cargado"].includes(shipment.status);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Carga {shipment.load_number}</DialogTitle></DialogHeader>
          <Button size="sm" variant="outline" className="self-start" onClick={onEdit}><Pencil className="w-4 h-4 mr-1" /> Editar carga</Button>
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
            {shipment.status === "enviado" && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm">
              <p>Esta carga está enviada. Reabrila para corregir los pallets y volvé a cerrarla al terminar.</p>
              {!confirmReopen ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setConfirmReopen(true)}>Reabrir para corregir pallets</Button>
              ) : <div className="space-y-2">
                <p className="font-medium">¿Confirmás la reapertura de la carga {shipment.load_number}?</p>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" disabled={reopening} onClick={() => setConfirmReopen(false)}>Cancelar</Button>
                  <Button size="sm" disabled={reopening} onClick={reopenShipment}>{reopening ? "Reabriendo…" : "Confirmar reapertura"}</Button>
                </div>
              </div>}
            </div>}
            <h4 className="font-medium flex items-center gap-2"><Package className="w-4 h-4" /> Pallets cargados ({loadedPallets.length})</h4>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {loadedPallets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin pallets cargados.</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {loadedPallets.map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-sm border rounded p-2">
                    <span className="font-mono">{p.romaneo_number}</span>
                    <span className="ml-auto">{fmtKg(p.net_weight)} · {p.package_count || 0} bultos</span>
                    {canChangePallets && <Button type="button" size="sm" variant="outline" aria-label={`Retirar pallet ${p.romaneo_number}`} onClick={() => setPalletToRemove(p)}><Trash2 className="w-4 h-4 mr-1" /> Retirar</Button>}
                  </div>
                ))}
              </div>
            )}
            {palletToRemove && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm" role="group" aria-label="Confirmar retiro de pallet">
              <p className="font-medium">¿Retirar el pallet {palletToRemove.romaneo_number} de la carga {shipment.load_number}?</p>
              <p>Volverá a estar disponible para despacho. Se recalcularán el peso y los bultos, y el movimiento quedará registrado.</p>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" disabled={removing} onClick={() => setPalletToRemove(null)}>Cancelar</Button>
                <Button size="sm" disabled={removing} onClick={removePallet}>{removing ? "Retirando…" : "Confirmar retiro"}</Button>
              </div>
            </div>}
          </div>

          {canChangePallets && loadedPallets.length > 0 && (
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
