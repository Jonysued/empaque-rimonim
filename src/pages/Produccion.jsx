import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { generateCode, generateRomaneoNumber, fmtKg } from "@/lib/qr";
import { loadCatalog, loadAllCatalogs } from "@/lib/catalogs";
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
  { value: "en_camara", label: "En cámara" },
  { value: "reservado", label: "Reservado" },
  { value: "despachado", label: "Despachado" },
  { value: "retenido", label: "Retenido" },
  { value: "liberado", label: "Liberado" },
];

export default function Produccion() {
  const [pallets, setPallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPallet, setShowPallet] = useState(false);
  const [selectedPallet, setSelectedPallet] = useState(null);
  const [cats, setCats] = useState({});
  const [statusFilter, setStatusFilter] = useState("todos");
  const filteredPallets = statusFilter === "todos" ? pallets : pallets.filter(p => p.status === statusFilter);

  async function refresh() {
    setLoading(true);
    try {
      const [p, allCats] = await Promise.all([
        base44.entities.Pallet.list("-created_date", 50),
        loadAllCatalogs(),
      ]);
      setPallets(p || []);
      setCats(allCats);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Factory className="w-6 h-6" /> Producción</h1>
          <p className="text-muted-foreground">Clasificación y pallets</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowPallet(true)}><Package className="w-4 h-4 mr-1" /> Nuevo pallet</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-6">
          {/* Pallets */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Pallets / Romaneos</CardTitle>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
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
                          <TableCell><StatusBadge status={p.status} /></TableCell>
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

      {showPallet && <PalletForm cats={cats} onClose={() => setShowPallet(false)} onSaved={() => { setShowPallet(false); refresh(); }} />}
      {selectedPallet && <PalletDetail pallet={selectedPallet} onClose={() => setSelectedPallet(null)} />}
    </div>
  );
}

function PalletForm({ cats, onClose, onSaved }) {
  const [form, setForm] = useState({
    product_type: "fresco", variety: "", producer: "",
    category: "", calibre: "", brand: "", package_type: "", package_count: "",
    pallet_type: "Euro", gross_weight: "", tare_weight: "", net_weight: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.net_weight || Number(form.net_weight) <= 0) return setError("Ingrese peso neto");
    setSaving(true);
    try {
      const code = generateCode("PAL");
      // Romaneo: contar pallets existentes + 1
      const existing = await base44.entities.Pallet.list();
      const romaneo = generateRomaneoNumber((existing || []).length + 1);
      const net = Number(form.net_weight);
      await base44.entities.Pallet.create({
        ...form,
        pallet_code: code,
        romaneo_number: romaneo,
        package_count: Number(form.package_count) || 0,
        gross_weight: Number(form.gross_weight) || 0,
        tare_weight: Number(form.tare_weight) || 0,
        net_weight: net,
        avg_box_weight: Number(form.package_count) > 0 ? Math.round(net / Number(form.package_count) * 100) / 100 : 0,
        status: "armado",
        composition_estimated: true,
        origin_lots: [],
      });
      onSaved();
    } catch (e) { setError(e.message || "Error"); setSaving(false); }
  }

  const opt = (arr) => (arr || []).map(i => ({ value: i.label, label: i.label }));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Nuevo pallet / romaneo</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Producto *</Label>
              <Select value={form.product_type} onValueChange={v => update("product_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fresco">Fresco</SelectItem>
                  <SelectItem value="arilos">Arilos</SelectItem>
                </SelectContent>
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
            <div className="space-y-1">
              <Label className="text-xs">Categoría</Label>
              <Select value={form.category} onValueChange={v => update("category", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{opt(cats.categoria).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {form.product_type === "fresco" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Calibre</Label>
                  <Select value={form.calibre} onValueChange={v => update("calibre", v)}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{opt(cats.calibre).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Envase/Caja</Label>
                  <Select value={form.package_type} onValueChange={v => update("package_type", v)}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{opt(cats.envase).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="space-y-1"><Label className="text-xs">Marca</Label><Input value={form.brand} onChange={e => update("brand", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Bultos</Label><Input type="number" value={form.package_count} onChange={e => update("package_count", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Peso bruto (kg)</Label><Input type="number" step="0.1" value={form.gross_weight} onChange={e => update("gross_weight", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Tara (kg)</Label><Input type="number" step="0.1" value={form.tare_weight} onChange={e => update("tare_weight", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Peso neto (kg) *</Label><Input type="number" step="0.1" value={form.net_weight} onChange={e => update("net_weight", e.target.value)} /></div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Creando…" : "Crear pallet"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PalletDetail({ pallet, onClose }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Pallet {pallet.romaneo_number}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex justify-center">
            <img src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(pallet.pallet_code)}&size=180x180`} width={180} height={180} alt="QR" />
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
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
          <PrintRomaneo pallet={pallet} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }) {
  return <div className="flex justify-between border-b pb-1"><span className="text-muted-foreground">{label}</span><span className="font-medium text-right">{value}</span></div>;
}