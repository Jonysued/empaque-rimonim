import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { generateCode } from "@/lib/qr";
import { loadCatalog } from "@/lib/catalogs";
import { useFieldLots, fieldOperation } from "@/lib/fieldLots";
import LotDetail, { LotSummary } from "@/components/LotDetail";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PackageOpen, Plus } from "lucide-react";

export default function Recepcion() {
  const { lots, bins, loading, error, refresh } = useFieldLots();
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [cats, setCats] = useState(null);
  const [catalogError, setCatalogError] = useState("");
  useEffect(() => {
    const names = ["productor", "cuadro", "variedad", "cuadrilla", "tipo_cosecha", "especie"];
    Promise.all(names.map(name => loadCatalog(name))).then(values => setCats(Object.fromEntries(names.map((name, i) => [name, values[i]]))))
      .catch(e => setCatalogError(e.message));
  }, []);
  const selectedLot = lots.find(lot => lot.id === selectedId);
  return <div className="space-y-6">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div><h1 className="text-2xl font-heading font-bold flex items-center gap-2"><PackageOpen className="w-6 h-6" /> Recepción Campo</h1>
        <p className="text-muted-foreground">Crear el lote, escanear sus bines y cerrar la carga en campo</p></div>
      <Button size="lg" disabled={!cats} onClick={() => setShowForm(true)}><Plus className="w-5 h-5 mr-1" /> Nuevo lote de ingreso</Button>
    </div>
    {(error || catalogError) && <p role="alert" className="text-sm text-destructive">{error || catalogError}</p>}
    {loading ? <p className="text-muted-foreground">Cargando lotes…</p> : !lots.length ?
      <Card><CardContent className="py-12 text-center text-muted-foreground">No hay lotes registrados. Creá el primero con «Nuevo lote de ingreso».</CardContent></Card> :
      <div className="grid gap-3">{lots.map(lot => <button key={lot.id} type="button" className="text-left" onClick={() => setSelectedId(lot.id)}><LotSummary lot={lot} /></button>)}</div>}
    {showForm && <LotForm cats={cats} onClose={() => setShowForm(false)} onSaved={async (id, pending) => {
      setShowForm(false); setSelectedId(id);
      if (pending) toast.warning("Lote guardado en este dispositivo; pendiente de sincronizar");
      await refresh();
    }} />}
    {selectedLot && <LotDetail lot={selectedLot} bins={bins.filter(bin => bin.receipt_lot_id === selectedLot.id)}
      onClose={() => setSelectedId(null)} onUpdated={refresh} />}
  </div>;
}

export function LotForm({ cats, onClose, onSaved }) {
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const [form, setForm] = useState({
    producer: "", variety: "", origin: "", species: "Granada",
    harvest_type: "", crew: "", transport: "",
    bins_count: "",
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
  const binCount = Number(form.bins_count);
  const [lotId] = useState(() => crypto.randomUUID());
  const [operationId] = useState(() => crypto.randomUUID());
  const [lotCode] = useState(() => generateCode("LOT"));

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.producer) return setError("Productor es obligatorio");
    if (form.origin && !cats.cuadro?.some(item => item.producer === form.producer && item.label === form.origin)) return setError("Seleccioná un cuadro del productor indicado");
    if (!form.variety) return setError("Variedad es obligatoria");
    if (!Number.isInteger(binCount) || binCount <= 0) return setError("La cantidad de BINs debe ser un número entero mayor a cero");
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
      const record = { ...form, bins_count: undefined, expected_bins_count: binCount,
        crew_breakdown: crewBreakdown, lot_code: lotCode };
      delete record.bins_count;
      const result = await fieldOperation(lotId, "create", { p_record: record }, operationId);
      await onSaved(lotId, result.pending);
    } catch (e) {
      setError(e.message || "Error al guardar");
      setSaving(false);
    }
  }

  const opt = (arr) => (arr || []).map(i => ({ value: i.label, label: i.label }));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Nuevo lote de Recepción Campo</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <Field label="Cantidad de BINs a escanear *"><Input type="number" min="1" step="1" value={form.bins_count} onChange={e => update("bins_count", e.target.value)} /></Field>

          </div>
          <Field label="Notas de calidad"><Textarea rows={2} value={form.quality_notes} onChange={e => update("quality_notes", e.target.value)} /></Field>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Crear lote y cargar bines"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}
