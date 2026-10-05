import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { generateCode, fmtKg } from "@/lib/qr";
import QRImage from "@/components/QRImage";
import { loadAllCatalogs } from "@/lib/catalogs";
import { productTypeForCategory, updateNewPalletField } from "@/lib/palletPackageCount.mjs";
import StatusBadge from "@/components/StatusBadge";
import PrintRomaneo from "@/components/PrintRomaneo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Factory, Package } from "lucide-react";

const PALLET_STATUSES = [
  { value: "armado", label: "Terminado" },
  { value: "parcial", label: "Parcial" },
  { value: "cerrado", label: "Cerrado" },
  { value: "en_tunel", label: "En túnel" },
  { value: "prefrio_finalizado", label: "Prefrío finalizado" },
  { value: "en_camara", label: "En cámara" },
  { value: "reservado", label: "Reservado" },
  { value: "despachado", label: "Despachado" },
];

// Etiqueta de estación donde se encuentra el pallet
const STATION_ABBREV = {
  armado: "En producción",
  parcial: "En producción",
  cerrado: "En producción",
  en_tunel: "En túnel",
  prefrio_finalizado: "Prefrío finalizado",
  en_camara: "En cámara",
  reservado: "Para despacho",
  despachado: "Enviado",
};

export default function Produccion() {
  const [pallets, setPallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const request = useRef(0);
  const [formPallet, setFormPallet] = useState(null); // null | "new" | pallet a editar
  const [selectedPallet, setSelectedPallet] = useState(null);
  const [cats, setCats] = useState({});
  const [statusFilter, setStatusFilter] = useState("todos");
  const filteredPallets = statusFilter === "todos" ? pallets : pallets.filter(p => p.status === statusFilter);

  async function refresh() {
    const sequence = ++request.current;
    setLoading(true);
    try {
      const [p, allCats] = await Promise.all([
        base44.entities.Pallet.list("-created_date"),
        loadAllCatalogs(),
      ]);
      if (sequence !== request.current) return;
      setPallets(p || []);
      setSelectedPallet(previous => previous ? (p || []).find(item => item.id === previous.id) || null : null);
      setCats(allCats);
      setLoadError('');
    } catch (e) { if (sequence === request.current) setLoadError(e.message || 'No se pudieron cargar los pallets'); }
    finally { if (sequence === request.current) setLoading(false); }
  }

  useEffect(() => {
    refresh();
    window.addEventListener('rimonim-queue-change', refresh);
    window.addEventListener('focus', refresh);
    return () => { request.current++; window.removeEventListener('rimonim-queue-change', refresh); window.removeEventListener('focus', refresh); };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Factory className="w-6 h-6" /> Producción</h1>
          <p className="text-muted-foreground">Clasificación y pallets</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setFormPallet("new")}><Package className="w-4 h-4 mr-1" /> Nuevo pallet</Button>
        </div>
      </div>

      {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-6">
          {/* Pallets */}
          <Card>
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between space-y-0">
              <CardTitle className="text-base">Pallets / Romaneos</CardTitle>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los estados</SelectItem>
                  {PALLET_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {pallets.length === 0 ? <p className="text-sm text-muted-foreground">Sin pallets creados.</p> : filteredPallets.length === 0 ? <p className="text-sm text-muted-foreground">No hay pallets con este estado.</p> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Romaneo</TableHead>
                        <TableHead>Código</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead>Variedad</TableHead>
                        <TableHead>Productor</TableHead>
                        <TableHead className="text-right">Neto</TableHead>
                        <TableHead className="text-right">Bultos</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPallets.map(p => (
                        <TableRow key={p.id} className="cursor-pointer" onClick={() => setSelectedPallet(p)}>
                          <TableCell className="font-bold">{p.romaneo_number}</TableCell>
                          <TableCell className="text-xs font-mono">{p.pallet_code}</TableCell>
                          <TableCell>{p.product_type === "fresco" ? "Fresco" : "Arilos"}</TableCell>
                          <TableCell>{p.variety || "—"}</TableCell>
                          <TableCell>{p.producer || "—"}</TableCell>
                          <TableCell className="text-right">{fmtKg(p.net_weight)}</TableCell>
                          <TableCell className="text-right">{p.package_count || 0}</TableCell>
                          <TableCell><StatusBadge status={p.status} label={STATION_ABBREV[p.status] || p.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {formPallet && <PalletForm cats={cats} pallet={formPallet === "new" ? null : formPallet} onClose={() => setFormPallet(null)} onSaved={() => { setFormPallet(null); refresh(); }} />}
      {selectedPallet && <PalletDetail
        pallet={selectedPallet}
        onClose={() => setSelectedPallet(null)}
        onEdit={() => { const p = selectedPallet; setSelectedPallet(null); setFormPallet(p); }}
        onDelete={async () => {
          if (!window.confirm(`¿Eliminar el pallet ${selectedPallet.romaneo_number}?`)) return;
          try {
            await base44.entities.Pallet.delete(selectedPallet.id);
            setSelectedPallet(null);
            refresh();
          } catch (e) { alert(e.message || "No se pudo eliminar el pallet"); }
        }}
      />}
    </div>
  );
}

function PalletForm({ cats, onClose, onSaved, pallet }) {
  const [form, setForm] = useState(() => pallet ? {
    product_type: pallet.product_type || "fresco", variety: pallet.variety || "",
    producer: pallet.producer || "", category: pallet.category || "",
    calibre: pallet.calibre || "", brand: pallet.brand || "", package_type: pallet.package_type || "",
    package_count: pallet.package_count ?? "", gross_weight: pallet.gross_weight ?? "",
    tare_weight: pallet.tare_weight ?? "", net_weight: pallet.net_weight ?? "",
  } : {
    product_type: "fresco", variety: "", producer: "",
    category: "", calibre: "", brand: "", package_type: "", package_count: "",
    pallet_type: "Euro", gross_weight: "", tare_weight: "", net_weight: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(k, v) {
    setForm(f => pallet
      ? { ...f, [k]: v, ...(k === "category" ? { product_type: productTypeForCategory(v, f.product_type) } : {}) }
      : updateNewPalletField(f, k, v));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.category) return setError("Seleccione una categoría");
    if (!form.net_weight || Number(form.net_weight) <= 0) return setError("Ingrese peso neto");
    if (!Number.isFinite(Number(form.net_weight)) || !Number.isInteger(Number(form.package_count || 0)) || Number(form.package_count || 0) < 0 || Number(form.gross_weight || 0) < 0 || Number(form.tare_weight || 0) < 0) return setError('Ingresá pesos válidos y una cantidad entera de bultos sin valores negativos');
    setSaving(true);
    try {
      const net = Number(form.net_weight);
      const payload = {
        ...form,
        package_count: Number(form.package_count) || 0,
        gross_weight: Number(form.gross_weight) || 0,
        tare_weight: Number(form.tare_weight) || 0,
        net_weight: net,
        avg_box_weight: Number(form.package_count) > 0 ? Math.round(net / Number(form.package_count) * 100) / 100 : 0,
      };
      if (pallet) {
        await base44.entities.Pallet.update(pallet.id, payload);
      } else {
        const code = generateCode("PAL");
        // Postgres assigns the number atomically across operators.
        await base44.entities.Pallet.create({
          ...payload,
          pallet_code: code,
          pallet_type: "Euro",
          status: "armado",
          composition_estimated: true,
          origin_lots: [],
        });
      }
      onSaved();
    } catch (e) { setError(e.message || "Error"); setSaving(false); }
  }

  const opt = (arr) => (arr || []).map(i => ({ value: i.label, label: i.label }));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{pallet ? `Editar pallet ${pallet.romaneo_number}` : "Nuevo pallet / romaneo"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Categoría *</Label>
              <Select value={form.category} onValueChange={v => update("category", v)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar categoría" /></SelectTrigger>
                <SelectContent>{opt(cats.categoria).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Variedad</Label>
              <Select value={form.variety} onValueChange={v => update("variety", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{opt(cats.variedad).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Productor</Label>
              <Select value={form.producer} onValueChange={v => update("producer", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{opt(cats.productor).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {form.product_type === "fresco" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Envase/Caja</Label>
                  <Select value={form.package_type} onValueChange={v => update("package_type", v)}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{opt(cats.envase).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Calibre</Label>
                  <Select value={form.calibre} onValueChange={v => update("calibre", v)}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{opt(cats.calibre).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Marca</Label>
              <Select value={form.brand} onValueChange={v => update("brand", v)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar marca" /></SelectTrigger>
                <SelectContent>
                  {pallet?.brand && !opt(cats.marca).some(o => o.value === pallet.brand) && (
                    <SelectItem value={pallet.brand}>{pallet.brand}</SelectItem>
                  )}
                  {opt(cats.marca).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {opt(cats.marca).length === 0 && <p className="text-xs text-muted-foreground">Agregá las marcas desde Catálogos → Marcas.</p>}
            </div>
            <div className="space-y-1"><Label className="text-xs">Bultos</Label><Input type="number" value={form.package_count} onChange={e => update("package_count", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Peso bruto (kg)</Label><Input type="number" step="0.1" value={form.gross_weight} onChange={e => update("gross_weight", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Tara (kg)</Label><Input type="number" step="0.1" value={form.tare_weight} onChange={e => update("tare_weight", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Peso neto (kg) *</Label><Input type="number" step="0.1" value={form.net_weight} onChange={e => update("net_weight", e.target.value)} /></div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando…" : pallet ? "Guardar cambios" : "Crear pallet"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PalletDetail({ pallet, onClose, onEdit, onDelete }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Pallet {pallet.romaneo_number}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex justify-center">
            <QRImage code={pallet.pallet_code} size={180} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <Info label="Código" value={pallet.pallet_code} />
            <Info label="Producto" value={pallet.product_type === "fresco" ? "Fresco" : "Arilos"} />
            <Info label="Productor" value={pallet.producer || "—"} />
            <Info label="Variedad" value={pallet.variety || "—"} />
            <Info label="Categoría" value={pallet.category || "—"} />
            <Info label="Calibre" value={pallet.calibre || "—"} />
            <Info label="Envase" value={pallet.package_type || "—"} />
            <Info label="Bultos" value={String(pallet.package_count || 0)} />
            <Info label="Neto" value={fmtKg(pallet.net_weight)} />
            <Info label="Bruto" value={fmtKg(pallet.gross_weight)} />
            <Info label="Estado" value={pallet.status} />
          </div>
          <div className="flex flex-wrap gap-2">
            <PrintRomaneo pallet={pallet} />
            <Button variant="outline" className="flex-1" onClick={onEdit}>Editar</Button>
            <Button variant="destructive" onClick={onDelete}>Eliminar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }) {
  return <div className="min-w-0 flex justify-between gap-3 border-b pb-1"><span className="text-muted-foreground">{label}</span><span className="min-w-0 break-words font-medium text-right">{value}</span></div>;
}
