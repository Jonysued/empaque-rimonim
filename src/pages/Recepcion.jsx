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
      const [data, producers, origins, vars, crews, htypes, species] = await Promise.all([
        base44.entities.ReceiptLot.list("-created_date", 50),
        loadCatalog("productor"), loadCatalog("cuadro"),
        loadCatalog("variedad"), loadCatalog("cuadrilla"), loadCatalog("tipo_cosecha"), loadCatalog("especie"),
      ]);
      setLots(data || []);
      setCats({ productor: producers, cuadro: origins, variedad: vars, cuadrilla: crews, tipo_cosecha: htypes, especie: species });
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
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const [form, setForm] = useState({
    producer: "", variety: "", origin: "", species: "Granada",
    harvest_type: "", crew: "", transport: "",
    bins_count: "", gross_weight: "", tare_weight: "",
    harvest_date: today(),
    quality_notes: ""
  });
  const [mixedCrews, setMixedCrews] = useState([{ crew: "", bins_count: "" }, { crew: "", bins_count: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function updateMixed(index, key, value) {
    setMixedCrews(items => items.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }
  const gross = Number(form.gross_weight);
  const tare = Number(form.tare_weight);
  const net = form.gross_weight !== "" && form.tare_weight !== "" && Number.isFinite(gross) && Number.isFinite(tare)
    ? Math.round((gross - tare) * 10) / 10 : null;
  const binCount = Number(form.bins_count);
  const binWeight = net > 0 && Number.isInteger(binCount) && binCount > 0 ? net / binCount : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.producer) return setError("Productor es obligatorio");
    if (form.origin && !cats.cuadro?.some(item => item.producer === form.producer && item.label === form.origin)) return setError("Seleccioná un cuadro del productor indicado");
    if (!form.variety) return setError("Variedad es obligatoria");
    if (!Number.isInteger(binCount) || binCount <= 0) return setError("La cantidad de BINs debe ser un número entero mayor a cero");
    if (form.gross_weight === "" || !Number.isFinite(gross) || gross <= 0) return setError("Ingresá un peso bruto mayor a cero");
    if (form.tare_weight === "" || !Number.isFinite(tare) || tare < 0 || tare >= gross) return setError("La tara debe ser menor que el peso bruto y no puede ser negativa");
    if (!form.harvest_date) return setError("Ingresá la fecha de cosecha");
    let crewBreakdown = [];
    if (form.crew === "MIXTO") {
      crewBreakdown = mixedCrews.map(item => ({ crew: item.crew, bins_count: Number(item.bins_count) }));
      if (crewBreakdown.some((item, index) => !item.crew || !cats.cuadrilla?.some(c => c.label === item.crew) || !Number.isInteger(item.bins_count) || item.bins_count <= 0 || mixedCrews[index].bins_count === "")) {
        return setError("Seleccioná las dos cuadrillas e ingresá sus cantidades de BINs");
      }
      if (crewBreakdown[0].crew === crewBreakdown[1].crew) return setError("Seleccioná dos cuadrillas distintas");
      if (crewBreakdown[0].bins_count + crewBreakdown[1].bins_count !== binCount) return setError("Los BINs de ambas cuadrillas deben sumar el total del lote");
    }
    setSaving(true);
    try {
      const code = generateCode("LOT");
      await base44.entities.ReceiptLot.create({
        ...form,
        crew_breakdown: crewBreakdown,
        bins_count: binCount,
        bins_dumped: 0,
        gross_weight: gross,
        tare_weight: tare,
        net_weight: net,
        remaining_weight: net,
        dumped_weight: 0,
        lot_code: code,
        receipt_date: new Date().toISOString(),
        harvest_date: form.harvest_date,
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
              <Select value={form.producer} onValueChange={v => setForm(f => ({ ...f, producer: v, origin: "" }))}>
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
            <Field label="Procedencia/Cuadro">
              <Select value={form.origin} disabled={!form.producer} onValueChange={v => update("origin", v)}>
                <SelectTrigger><SelectValue placeholder={form.producer ? "Seleccionar cuadro" : "Primero elegí un productor"} /></SelectTrigger>
                <SelectContent>{(cats.cuadro || []).filter(item => item.producer === form.producer).map(item => <SelectItem key={item.id} value={item.label}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Especie"><Select value={form.species} onValueChange={v => update("species", v)}><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent>{opt(cats.especie).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Tipo de cosecha">
              <Select value={form.harvest_type} onValueChange={v => update("harvest_type", v)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>{opt(cats.tipo_cosecha).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Cuadrilla"><Select value={form.crew} onValueChange={v => update("crew", v)}><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent>{opt(cats.cuadrilla).filter(o => o.value !== "MIXTO").map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}<SelectItem value="MIXTO">MIXTO</SelectItem></SelectContent></Select></Field>
            {form.crew === "MIXTO" && mixedCrews.map((item, index) => (
              <React.Fragment key={index}>
                <Field label={`Cuadrilla ${index + 1} *`}><Select value={item.crew} onValueChange={v => updateMixed(index, "crew", v)}><SelectTrigger><SelectValue placeholder="Seleccionar cuadrilla" /></SelectTrigger><SelectContent>{opt(cats.cuadrilla).filter(o => o.value !== "MIXTO").map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></Field>
                <Field label={`BINs cuadrilla ${index + 1} *`}><Input type="number" min="1" step="1" value={item.bins_count} onChange={e => updateMixed(index, "bins_count", e.target.value)} /></Field>
              </React.Fragment>
            ))}
            <Field label="Transporte"><Input value={form.transport} onChange={e => update("transport", e.target.value)} /></Field>
            <Field label="Fecha de cosecha"><Input type="date" required value={form.harvest_date} onChange={e => update("harvest_date", e.target.value)} /></Field>
            <Field label="Cantidad de BINs *"><Input type="number" min="1" step="1" value={form.bins_count} onChange={e => update("bins_count", e.target.value)} /></Field>
            <Field label="Peso bruto (kg) *"><Input type="number" min="0.1" step="0.1" required value={form.gross_weight} onChange={e => update("gross_weight", e.target.value)} /></Field>
            <Field label="Tara (kg) *"><Input type="number" min="0" step="0.1" required value={form.tare_weight} onChange={e => update("tare_weight", e.target.value)} /></Field>
            <div className="col-span-2 space-y-3">
              <Field label="Peso neto (kg)"><Input readOnly value={net !== null && net > 0 ? net.toFixed(1) : ""} placeholder="Bruto − tara" /></Field>
              <Field label="Peso teórico por BIN (kg)"><Input readOnly value={binWeight !== null ? binWeight.toFixed(1) : ""} placeholder="Neto ÷ cantidad de BINs" /></Field>
            </div>
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
            {lot.crew === "MIXTO" && Array.isArray(lot.crew_breakdown) && lot.crew_breakdown.map((item, index) => <Info key={index} label={item.crew || `Cuadrilla ${index + 1}`} value={`${item.bins_count || 0} BINs`} />)}
            <Info label="Turno" value={lot.shift || "—"} />
            <Info label="Peso bruto" value={fmtKg(lot.gross_weight)} />
            <Info label="Tara" value={fmtKg(lot.tare_weight)} />
            <Info label="Peso neto" value={fmtKg(lot.net_weight)} />
            <Info label="Peso teórico por BIN" value={lot.bins_count > 0 ? fmtKg(lot.net_weight / lot.bins_count) : "—"} />
            <Info label="Saldo sin volcar" value={fmtKg(lot.remaining_weight)} />
            <Info label="Volcado acumulado" value={fmtKg(lot.dumped_weight)} />
            <Info label="BINs declarados" value={String(lot.bins_count || 0)} />
            <Info label="BINs volcados" value={String(lot.bins_dumped ?? (lot.status === "volcado" ? lot.bins_count || 0 : 0))} />
            <Info label="BINs pendientes" value={String(Math.max(0, (Number(lot.bins_count) || 0) - (Number(lot.bins_dumped ?? (lot.status === "volcado" ? lot.bins_count : 0)) || 0)))} />
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
