import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { fmtKg, fmtDate } from "@/lib/qr";
import QRScanner from "@/components/QRScanner";
import StatusBadge from "@/components/StatusBadge";
import MovementTimeline from "@/components/MovementTimeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ArrowDownRight, ArrowUpRight, Package, Layers, Repeat, Truck } from "lucide-react";

export default function Trazabilidad() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [allData, setAllData] = useState({ lots: [], bins: [], dumps: [], runs: [], pallets: [], shipments: [], movements: [] });

  useEffect(() => {
    (async () => {
      try {
        const [lots, bins, dumps, runs, pallets, shipments, movements] = await Promise.all([
          base44.entities.ReceiptLot.list(),
          base44.entities.Bin.list(),
          base44.entities.DumpingEvent.list(),
          base44.entities.ProductionRun.list(),
          base44.entities.Pallet.list(),
          base44.entities.Shipment.list(),
          base44.entities.MovementEvent.list(),
        ]);
        setAllData({ lots, bins, dumps, runs, pallets, shipments, movements });
      } catch (e) { console.error(e); }
    })();
  }, []);

  async function search(code) {
    setError(""); setResult(null);
    if (!code) return;
    setLoading(true);
    try {
      // Buscar en todas las entidades
      const lot = allData.lots.find(l => l.lot_code === code);
      if (lot) { setResult({ type: "lote", entity: lot }); setLoading(false); return; }
      const bin = allData.bins.find(b => b.bin_code === code);
      if (bin) { setResult({ type: "bin", entity: bin }); setLoading(false); return; }
      const pallet = allData.pallets.find(p => p.pallet_code === code || p.romaneo_number === code);
      if (pallet) { setResult({ type: "pallet", entity: pallet }); setLoading(false); return; }
      const shipment = allData.shipments.find(s => s.shipment_code === code || s.load_number === code);
      if (shipment) { setResult({ type: "despacho", entity: shipment }); setLoading(false); return; }
      setError(`No se encontró ningún registro con código: ${code}`);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  function handleScan(code) { setQuery(code); search(code); }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Search className="w-6 h-6" /> Trazabilidad</h1>
        <p className="text-muted-foreground">Consultar historia de un lote, pallet o despacho</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <QRScanner label="Escanear QR a consultar" onScan={handleScan} />
          <div className="flex gap-2">
            <Input placeholder="O ingrese el código…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search(query)} />
            <Button onClick={() => search(query)}><Search className="w-4 h-4 mr-1" /> Buscar</Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {loading && <div className="flex justify-center py-10"><div className="w-8 h-8 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin" /></div>}

      {result && <TraceResult result={result} allData={allData} />}
    </div>
  );
}

function TraceResult({ result, allData }) {
  const { type, entity } = result;

  if (type === "lote") {
    // Hacia adelante: vuelcos → corridas → pallets → despachos
    const dumps = allData.dumps.filter(d => d.receipt_lot_id === entity.id);
    const runIds = [...new Set(dumps.map(d => d.production_run_id))];
    const runs = allData.runs.filter(r => runIds.includes(r.id));
    const pallets = allData.pallets.filter(p => runIds.includes(p.production_run_id));
    const shipmentIds = [...new Set(pallets.map(p => p.shipment_id).filter(Boolean))];
    const shipments = allData.shipments.filter(s => shipmentIds.includes(s.id));

    return (
      <div className="space-y-4">
        <Card className="border-blue-300">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ArrowUpRight className="w-4 h-4 text-blue-600" /> Trazabilidad hacia adelante</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <EntityBlock icon={Layers} title="Lote de recepción" code={entity.lot_code} data={[
              ["Productor", entity.producer], ["Variedad", entity.variety],
              ["Neto", fmtKg(entity.net_weight)], ["Saldo sin volcar", fmtKg(entity.remaining_weight)],
              ["Estado", entity.status], ["Recibido", fmtDate(entity.receipt_date)],
            ]} />
            <TraceSection icon={Repeat} title="Vuelcos" items={dumps} render={d => ({
              code: d.dump_code, rows: [
                ["Kilos", fmtKg(d.net_weight)], ["Turno", d.shift], ["Línea", d.line || "—"], ["Fecha", fmtDate(d.dump_date)]
              ]
            })} />
            <TraceSection icon={Package} title="Corridas" items={runs} render={r => ({
              code: r.run_code, rows: [
                ["Línea", r.line], ["Turno", r.shift], ["Pendiente", fmtKg(r.dumped_pending)],
                ["Fresco", fmtKg(r.fresh_weight)], ["Arilos", fmtKg(r.aril_weight)]
              ]
            })} />
            <TraceSection icon={Package} title="Pallets producidos" items={pallets} render={p => ({
              code: p.romaneo_number, rows: [
                ["Producto", p.product_type === "fresco" ? "Fresco" : "Arilos"], ["Neto", fmtKg(p.net_weight)],
                ["Bultos", String(p.package_count || 0)], ["Estado", p.status]
              ]
            })} />
            <TraceSection icon={Truck} title="Despachos" items={shipments} render={s => ({
              code: s.load_number, rows: [
                ["Cliente", s.client || "—"], ["Destino", s.destination || "—"],
                ["Pallets", String((s.loaded_pallet_ids || []).length)], ["Estado", s.status]
              ]
            })} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (type === "pallet") {
    // Hacia atrás: corrida → vuelcos → lotes
    const run = allData.runs.find(r => r.id === entity.production_run_id);
    const dumps = allData.dumps.filter(d => d.production_run_id === entity.production_run_id);
    const lotIds = [...new Set(dumps.map(d => d.receipt_lot_id))];
    const lots = allData.lots.filter(l => lotIds.includes(l.id));
    const shipment = allData.shipments.find(s => s.id === entity.shipment_id);

    return (
      <Card className="border-purple-300">
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ArrowDownRight className="w-4 h-4 text-purple-600" /> Trazabilidad hacia atrás</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <EntityBlock icon={Package} title="Pallet" code={entity.romaneo_number} data={[
            ["Código", entity.pallet_code], ["Producto", entity.product_type === "fresco" ? "Fresco" : "Arilos"],
            ["Neto", fmtKg(entity.net_weight)], ["Bultos", String(entity.package_count || 0)],
            ["Estado", entity.status], ["Ubicación", entity.location_name || "—"],
            ["Creado", entity.created_date ? new Date(entity.created_date).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—"],
          ]} />
          {run && <EntityBlock icon={Package} title="Corrida de producción" code={run.run_code} data={[
            ["Línea", run.line], ["Turno", run.shift], ["Fecha", fmtDate(run.date)]
          ]} />}
          <MovementTimeline movements={allData.movements.filter(m => m.unit_type === "pallet" && m.unit_id === entity.id)} />
          <TraceSection icon={Repeat} title="Vuelcos (lotes que alimentaron la corrida)" items={dumps} render={d => ({
            code: d.dump_code, rows: [
              ["Kilos", fmtKg(d.net_weight)], ["Lote", d.receipt_lot_code], ["Fecha", fmtDate(d.dump_date)]
            ]
          })} />
          <TraceSection icon={Layers} title="Lotes de recepción de origen" items={lots} render={l => ({
            code: l.lot_code, rows: [
              ["Productor", l.producer], ["Variedad", l.variety], ["Neto", fmtKg(l.net_weight)], ["Recibido", fmtDate(l.receipt_date)]
            ]
          })} />
          {shipment && <EntityBlock icon={Truck} title="Despacho" code={shipment.load_number} data={[
            ["Cliente", shipment.client || "—"], ["Destino", shipment.destination || "—"], ["Estado", shipment.status]
          ]} />}
        </CardContent>
      </Card>
    );
  }

  if (type === "despacho") {
    const loadedIds = entity.loaded_pallet_ids || [];
    const pallets = allData.pallets.filter(p => loadedIds.includes(p.id));
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Despacho {entity.load_number}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <EntityBlock icon={Truck} title="Carga" code={entity.shipment_code} data={[
            ["Cliente", entity.client || "—"], ["Destino", entity.destination || "—"],
            ["Producto", entity.product_type], ["Pallets", `${loadedIds.length}/${entity.target_capacity}`],
            ["Peso total", fmtKg(entity.total_weight)], ["Estado", entity.status],
          ]} />
          <TraceSection icon={Package} title="Pallets cargados" items={pallets} render={p => ({
            code: p.romaneo_number, rows: [
              ["Producto", p.product_type], ["Neto", fmtKg(p.net_weight)], ["Bultos", String(p.package_count || 0)]
            ]
          })} />
        </CardContent>
      </Card>
    );
  }

  if (type === "bin") {
    const lot = allData.lots.find(l => l.id === entity.receipt_lot_id);
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">BIN {entity.bin_code}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <EntityBlock icon={Layers} title="BIN" code={entity.bin_code} data={[
            ["N° visible", entity.visible_number || "—"], ["Neto", fmtKg(entity.net_weight)],
            ["Medido", entity.measured ? "Sí" : "Estimado"], ["Estado", entity.status],
          ]} />
          {lot && <EntityBlock icon={Layers} title="Lote de recepción" code={lot.lot_code} data={[
            ["Productor", lot.producer], ["Variedad", lot.variety], ["Neto total", fmtKg(lot.net_weight)]
          ]} />}
        </CardContent>
      </Card>
    );
  }

  return null;
}

function EntityBlock({ icon: Icon, title, code, data }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title}</span>
        <span className="font-mono text-xs text-muted-foreground ml-auto">{code}</span>
      </div>
      <div className="grid grid-cols-2 gap-1 text-sm">
        {data.map(([k, v], i) => <div key={i} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="font-medium text-right">{v}</span></div>)}
      </div>
    </div>
  );
}

function TraceSection({ icon: Icon, title, items, render }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium flex items-center gap-1 mb-1 text-muted-foreground"><Icon className="w-3.5 h-3.5" /> {title} ({items.length})</p>
      <div className="space-y-1 pl-1">
        {items.map(item => {
          const r = render(item);
          return (
            <div key={item.id} className="border-l-2 border-muted pl-2 py-1 text-sm">
              <p className="font-mono text-xs">{r.code}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {r.rows.map(([k, v], i) => <div key={i} className="text-xs"><span className="text-muted-foreground">{k}:</span> {v}</div>)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}