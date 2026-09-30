import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useFieldLots, harvestOperation } from "@/lib/fieldLots";
import { normalizeBinCode } from "@/lib/fieldWorkflow.mjs";
import { fmtDate } from "@/lib/qr";
import BinInfo from "@/components/BinInfo";
import QRLabel from "@/components/QRLabel";
import QRScanner from "@/components/QRScanner";
import StatusBadge from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sprout } from "lucide-react";

export default function Recepcion() {
  const { lots, bins, loading, error, refresh } = useFieldLots();
  const [code, setCode] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [cats, setCats] = useState(null);
  const [initial, setInitial] = useState({});
  const [scanError, setScanError] = useState("");
  useEffect(() => {
    const names = ["productor", "cuadro", "variedad", "cuadrilla", "tipo_cosecha", "especie"];
    base44.entities.Catalog.list().then(items => setCats(Object.fromEntries(names.map(name => [name,
      items.filter(item => item.active && item.type === name).sort((a,b) => a.label.localeCompare(b.label))])))).catch(e => setScanError(e.message));
  }, []);
  function scan(raw) {
    const next = normalizeBinCode(raw); setScanError("");
    if (!next || /^(LOT|ROM|PAL)-/.test(next)) return setScanError("Escaneá el QR de un BIN.");
    const active = bins.find(bin => normalizeBinCode(bin.bin_code) === next &&
      (!bin.receipt_lot_id || !['volcado','anulado'].includes(lots.find(lot => lot.id === bin.receipt_lot_id)?.status)));
    if (active) return setScanError(`El BIN ${next} ya está registrado y pendiente de procesar.`);
    setCode(next);
  }
  const selected = bins.find(bin => bin.id === selectedId);
  const harvests = bins.filter(bin => Number(bin.harvest_workflow) === 3);
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Sprout className="w-6 h-6" /> Cosecha</h1>
      <p className="text-muted-foreground">Pegar el QR en el bin, escanearlo y registrar su información de cosecha</p></div>
    {(error || scanError) && <p role="alert" className="text-sm text-destructive">{error || scanError}</p>}
    <Card><CardContent className="p-4 space-y-3">{cats ? <QRScanner label="Escanear QR del BIN para registrar cosecha" onScan={scan} /> : <p>Cargando catálogos…</p>}</CardContent></Card>
    <div className="space-y-3"><h2 className="font-semibold">BINs registrados ({harvests.length})</h2>
      {loading ? <p>Cargando…</p> : !harvests.length ? <p className="text-sm text-muted-foreground">Escaneá el primer BIN para registrar su cosecha.</p> : harvests.map(bin =>
        <button key={bin.id} type="button" className="block w-full text-left" onClick={() => setSelectedId(bin.id)}><Card><CardContent className="p-4 space-y-1">
          <div className="flex items-center gap-2 flex-wrap"><b className="font-mono break-all">{bin.bin_code}</b><StatusBadge status={bin.receipt_lot_id ? 'consolidado' : 'cosechado'} /></div>
          <p className="text-sm">{bin.producer} · {bin.variety} · {bin.origin || 'Sin cuadro'} · {bin.crew || 'Sin cuadrilla'}</p>
          <p className="text-xs text-muted-foreground">Registrado: {fmtDate(bin.scanned_at || bin.created_date)}{bin.receipt_lot_code ? ` · Lote ${bin.receipt_lot_code}` : ''}</p>
          {bin.pendingStatus && <p className="text-xs text-amber-800">{bin.pendingStatus === 'conflict' ? 'Requiere revisión' : 'Pendiente de sincronizar'}</p>}
        </CardContent></Card></button>)}</div>
    {code && cats && <HarvestForm key={code} code={code} cats={cats} initial={initial} onClose={() => setCode(null)} onSaved={async (record, pending) => {
      setCode(null); setInitial({ ...record, crew: record.crew === 'MIXTO' ? '' : record.crew });
      toast[pending ? 'warning' : 'success'](pending ? 'Cosecha guardada en este dispositivo; pendiente de sincronizar' : 'BIN registrado. Ya puede incorporarse a un consolidado.'); await refresh();
    }} />}
    {selected && <Dialog open onOpenChange={() => setSelectedId(null)}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Cosecha del BIN {selected.bin_code}</DialogTitle></DialogHeader>
      <QRLabel code={selected.bin_code} title="BIN" subtitle={`${selected.producer} · ${selected.variety}`} /><BinInfo bin={selected} />
      {selected.receipt_lot_code && <p className="text-sm">Lote: <b>{selected.receipt_lot_code}</b></p>}
    </DialogContent></Dialog>}
  </div>;
}

function HarvestForm({ code, cats, initial, onClose, onSaved }) {
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const [form, setForm] = useState({
    producer: "", variety: "", origin: "", species: "Granada",
    harvest_type: "", crew: "",
    harvest_date: today(),
    quality_notes: "", ...initial
  });
  const [mixedCrews, setMixedCrews] = useState([{ crew: "" }, { crew: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function updateMixed(index, key, value) {
    setMixedCrews(items => items.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }
  const [binId] = useState(() => crypto.randomUUID());
  const [operationId] = useState(() => crypto.randomUUID());

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.producer) return setError("Productor es obligatorio");
    if (form.origin && !cats.cuadro?.some(item => item.producer === form.producer && item.label === form.origin)) return setError("Seleccioná un cuadro del productor indicado");
    if (!form.variety) return setError("Variedad es obligatoria");
    if (!form.harvest_date) return setError("Ingresá la fecha de cosecha");
    let crewBreakdown = [];
    if (form.crew === "MIXTO") {
      crewBreakdown = mixedCrews.map(item => ({ crew: item.crew }));
      if (crewBreakdown.some(item => !item.crew || !cats.cuadrilla?.some(c => c.label === item.crew)) || crewBreakdown[0].crew === crewBreakdown[1].crew) {
        return setError("Seleccioná las dos cuadrillas distintas de este BIN");
      }
    }
    setSaving(true);
    try {
      const record = { ...form, bin_code: code, crew_breakdown: crewBreakdown };
      const result = await harvestOperation(binId, record, operationId);
      await onSaved(form, result.pending);
    } catch (e) {
      setError(e.message || "Error al guardar");
      setSaving(false);
    }
  }

  const opt = (arr) => (arr || []).map(i => ({ value: i.label, label: i.label }));

  return (
    <Dialog open onOpenChange={() => { if (!saving) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Registrar cosecha del BIN</DialogTitle></DialogHeader>
        <p className="font-mono font-semibold break-all">QR: {code}</p>
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

              </React.Fragment>
            ))}
            <Field label="Fecha de cosecha"><Input type="date" required value={form.harvest_date} onChange={e => update("harvest_date", e.target.value)} /></Field>

          </div>
          <Field label="Notas de calidad"><Textarea rows={2} value={form.quality_notes} onChange={e => update("quality_notes", e.target.value)} /></Field>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar cosecha del BIN"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}
