import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { generateCode, fmtKg, fmtDate } from "@/lib/qr";
import { loadCatalog } from "@/lib/catalogs";
import StatusBadge from "@/components/StatusBadge";
import QRLabel from "@/components/QRLabel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PackageOpen, Plus, Layers } from "lucide-react";

export default function Recepcion() {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedLot, setSelectedLot] = useState(null);
  const [cats, setCats] = useState({});

  async function refresh() {
    setLoading(true);
    try {
      const [data, prods, vars, farms, origins, crews, htypes, species] = await Promise.all([
        base44.entities.ReceiptLot.list("-created_date", 50),
        loadCatalog("productor"), loadCatalog("variedad"), loadCatalog("finca"),
        loadCatalog("cuadro"), loadCatalog("cuadrilla"), loadCatalog("tipo_cosecha"), loadCatalog("especie"),
      ]);
      setLots(data || []);
      setCats({ productor: prods, variedad: vars, finca: farms, cuadro: origins, cuadrilla: crews, tipo_cosecha: htypes, especie: species });
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2"><PackageOpen className="w-6 h-6" /> Recepción</h1>
          <p className="text-muted-foreground">Lotes de ingreso y BINs</p>
        </div>
        <Button size="lg" onClick={() => setShowForm(true)}>
          <Plus className="w-5 h-5 mr-1" /> Nuevo lote de ingreso
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin" /></div>
      ) : lots.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <PackageOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No hay lotes de ingreso registrados.</p>
          <p className="text-sm mt-1">Cree el primer lote con el botón «Nuevo lote de ingreso».</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {lots.map(lot => (
            <Card key={lot.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedLot(lot)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold">{lot.lot_code}</span>
                      <StatusBadge status={lot.status} />
                      {lot.held && <StatusBadge status="retenido" />}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {lot.producer} · {lot.variety} · {lot.bins_count || 0} BINs
                    </p>
                    <p className="text-xs text-muted-foreground">Recibido: {fmtDate(lot.receipt_date)}</p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-sm"><span className="text-muted-foreground">Neto:</span> <b>{fmtKg(lot.net_weight)}</b></p>
                    <p className="text-sm"><span className="text-muted-foreground">Sin volcar:</span> <b className="text-blue-600">{fmtKg(lot.remaining_weight)}</b></p>
                    <p className="text-sm"><span className="text-muted-foreground">Volcado:</span> <b className="text-amber-600">{fmtKg(lot.dumped_weight)}</b></p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm && <LotForm cats={cats} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refresh(); }} />}
      {selectedLot && <LotDetail lot={selectedLot} onClose={() => setSelectedLot(null)} />}
    </div>
  );
}

function LotForm({ cats, onClose, onSaved }) {
  const [form, setForm] = useState({
    producer: "", variety: "", farm: "", origin: "", species: "Granada",
    harvest_type: "", crew: "", shift: "Mañana", transport: "",
    bins_count: "", gross_weight: "", tare_weight: "", net_weight: "",
    weighing_method: "camion", harvest_lot_code: "", harvest_date: "", location: "Playa de espera",
    quality_notes: ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const net = Number(form.net_weight);
    if (!form.producer) return setError("Productor es obligatorio");
    if (!form.variety) return setError("Variedad es obligatoria");
    if (!net || net <= 0) return setError("Peso neto debe ser mayor a 0");
    setSaving(true);
    try {
      const code = generateCode("LOT");
      await base44.entities.ReceiptLot.create({
        ...form,
        bins_count: Number(form.bins_count) || 0,
        gross_weight: Number(form.gross_weight) || 0,
        tare_weight: Number(form.tare_weight) || 0,
        net_weight: net,
        remaining_weight: net,
        dumped_weight: 0,
        lot_code: code,
        receipt_date: new Date().toISOString(),
        harvest_date: form.harvest_date || new Date().toISOString(),
        status: "recibido",
        held: false,
      });
      onSaved();
    } catch (e) {
      setError(e.message || "Error al guardar");
      setSaving(false);
    }
  }

  const opt = (arr) => (arr || []).map(i => ({ value: i.label, label: i.label }));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Nuevo lote de ingreso</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Productor *">
              <Select value={form.producer} onValueChange={v => update("producer", v)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>{opt(cats.productor).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Variedad *">
              <Select value={form.variety} onValueChange={v => update("variety", v)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>{opt(cats.variedad).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Finca"><Input value={form.farm} onChange={e => update("farm", e.target.value)} /></Field>
            <Field label="Procedencia/Cuadro"><Input value={form.origin} onChange={e => update("origin", e.target.value)} /></Field>
            <Field label="Especie"><Input value={form.species} onChange={e => update("species", e.target.value)} /></Field>
            <Field label="Tipo de cosecha">
              <Select value={form.harvest_type} onValueChange={v => update("harvest_type", v)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>{opt(cats.tipo_cosecha).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Cuadrilla"><Input value={form.crew} onChange={e => update("crew", e.target.value)} /></Field>
            <Field label="Turno">
              <Select value={form.shift} onValueChange={v => update("shift", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Mañana">Mañana</SelectItem>
                  <SelectItem value="Tarde">Tarde</SelectItem>
                  <SelectItem value="Noche">Noche</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Transporte"><Input value={form.transport} onChange={e => update("transport", e.target.value)} /></Field>
            <Field label="Lote de cosecha (ref.)"><Input value={form.harvest_lot_code} onChange={e => update("harvest_lot_code", e.target.value)} /></Field>
            <Field label="Fecha de cosecha"><Input type="date" value={form.harvest_date} onChange={e => update("harvest_date", e.target.value)} /></Field>
            <Field label="Cantidad de BINs"><Input type="number" value={form.bins_count} onChange={e => update("bins_count", e.target.value)} /></Field>
            <Field label="Método de pesada">
              <Select value={form.weighing_method} onValueChange={v => update("weighing_method", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="camion">Camión</SelectItem>
                  <SelectItem value="partida">Partida</SelectItem>
                  <SelectItem value="lote">Lote</SelectItem>
                  <SelectItem value="balanza_individual">Balanza individual</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Ubicación inicial">
              <Select value={form.location} onValueChange={v => update("location", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Playa de espera">Playa de espera</SelectItem>
                  <SelectItem value="Cámara sin procesar">Cámara sin procesar</SelectItem>
                  <SelectItem value="Playa de recepción">Playa de recepción</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Peso bruto (kg)"><Input type="number" step="0.1" value={form.gross_weight} onChange={e => update("gross_weight", e.target.value)} /></Field>
            <Field label="Tara (kg)"><Input type="number" step="0.1" value={form.tare_weight} onChange={e => update("tare_weight", e.target.value)} /></Field>
            <Field label="Peso neto (kg) *"><Input type="number" step="0.1" value={form.net_weight} onChange={e => update("net_weight", e.target.value)} /></Field>
          </div>
          <Field label="Notas de calidad"><Textarea rows={2} value={form.quality_notes} onChange={e => update("quality_notes", e.target.value)} /></Field>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar lote"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function LotDetail({ lot, onClose }) {
  const [bins, setBins] = useState([]);
  const [showBins, setShowBins] = useState(false);

  async function loadBins() {
    try {
      const data = await base44.entities.Bin.filter({ receipt_lot_id: lot.id });
      setBins(data || []);
    } catch (e) { console.error(e); }
  }

  useEffect(() => { loadBins(); }, []);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Ficha del lote {lot.lot_code}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex justify-center"><QRLabel code={lot.lot_code} title="Lote de recepción" subtitle={`${lot.producer} · ${lot.variety}`} /></div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Info label="Productor" value={lot.producer} />
            <Info label="Variedad" value={lot.variety} />
            <Info label="Finca" value={lot.farm || "—"} />
            <Info label="Procedencia" value={lot.origin || "—"} />
            <Info label="Cuadrilla" value={lot.crew || "—"} />
            <Info label="Turno" value={lot.shift || "—"} />
            <Info label="Peso bruto" value={fmtKg(lot.gross_weight)} />
            <Info label="Tara" value={fmtKg(lot.tare_weight)} />
            <Info label="Peso neto" value={fmtKg(lot.net_weight)} />
            <Info label="Saldo sin volcar" value={fmtKg(lot.remaining_weight)} />
            <Info label="Volcado acumulado" value={fmtKg(lot.dumped_weight)} />
            <Info label="BINs declarados" value={String(lot.bins_count || 0)} />
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={lot.status} />
            {lot.held && <StatusBadge status="retenido" />}
          </div>

          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium flex items-center gap-2"><Layers className="w-4 h-4" /> BINs del lote ({bins.length})</h4>
              <Button size="sm" variant="outline" onClick={() => setShowBins(true)}><Plus className="w-4 h-4 mr-1" /> Crear BINs</Button>
            </div>
            {bins.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin BINs individualizados. El lote opera como unidad.</p>
            ) : (
              <div className="space-y-2">
                {bins.map(b => (
                  <div key={b.id} className="flex items-center justify-between border rounded-lg p-2 text-sm">
                    <span className="font-mono">{b.bin_code}</span>
                    <span>N° {b.visible_number || "—"} · {fmtKg(b.net_weight)} {b.measured ? "" : "(est.)"}</span>
                    <StatusBadge status={b.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {showBins && <BinForm lot={lot} onClose={() => setShowBins(false)} onSaved={() => { setShowBins(false); loadBins(); }} />}
      </DialogContent>
    </Dialog>
  );
}

function BinForm({ lot, onClose, onSaved }) {
  const [count, setCount] = useState("1");
  const [tare, setTare] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const n = Number(count) || 1;
      const tareVal = Number(tare) || 0;
      const estNet = n > 0 ? (lot.remaining_weight || lot.net_weight || 0) / (n + (0)) : 0;
      const records = [];
      for (let i = 0; i < n; i++) {
        records.push({
          bin_code: generateCode("BIN"),
          receipt_lot_id: lot.id,
          visible_number: String(i + 1),
          bin_type: "Estándar",
          tare: tareVal,
          gross_weight: 0,
          net_weight: Math.round(estNet * 10) / 10,
          measured: false,
          status: "disponible",
        });
      }
      await base44.entities.Bin.bulkCreate(records);
      onSaved();
    } catch { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Crear BINs para {lot.lot_code}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-sm text-muted-foreground">El peso se reparte como <b>estimado/no medido</b>. El total medido del lote se conserva.</p>
          <Field label="Cantidad de BINs"><Input type="number" min="1" value={count} onChange={e => setCount(e.target.value)} /></Field>
          <Field label="Tara por BIN (kg)"><Input type="number" step="0.1" value={tare} onChange={e => setTare(e.target.value)} /></Field>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Creando…" : "Crear BINs"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }) {
  return (
    <div className="flex justify-between border-b pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
