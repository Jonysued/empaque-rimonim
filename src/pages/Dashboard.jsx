import React, { useState, useEffect } from "react";
import rimonimLogo from "@/rimonim-logo.svg";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { fmtKg, fmtNum } from "@/lib/qr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PackageOpen, Repeat, Factory, Snowflake, Warehouse, Truck, AlertTriangle, ScanLine } from "lucide-react";

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    lotesRecibidos: 0, saldoSinVolcar: 0, volcadoHoy: 0,
    pendienteClasificar: 0, fresco: 0, arilos: 0, descarte: 0,
    palletsPrefrio: 0, tunelOcupacion: 0, camaraOcupacion: 0,
    despachosHoy: 0, alertas: []
  });

  useEffect(() => {
    (async () => {
      try {
        const [lots, dumps, runs, pallets, tunnels, chambers, shipments] = await Promise.all([
          base44.entities.ReceiptLot.list(),
          base44.entities.DumpingEvent.list(),
          base44.entities.ProductionRun.list(),
          base44.entities.Pallet.list(),
          base44.entities.Location.filter({ type: "tunel" }),
          base44.entities.Location.filter({ type: "camara" }),
          base44.entities.Shipment.list(),
        ]);

        const today = new Date().toDateString();
        const saldoSinVolcar = (lots || []).reduce((s, l) => s + (l.remaining_weight || 0), 0);
        const volcadoHoy = (dumps || []).filter(d => new Date(d.dump_date).toDateString() === today).reduce((s, d) => s + (d.net_weight || 0), 0);
        const pendienteClasificar = (runs || []).filter(r => r.status === "abierta").reduce((s, r) => s + (r.dumped_pending || 0), 0);
        const fresco = (runs || []).reduce((s, r) => s + (r.fresh_weight || 0), 0);
        const arilos = (runs || []).reduce((s, r) => s + (r.aril_weight || 0), 0);
        const descarte = (runs || []).reduce((s, r) => s + (r.discard_weight || 0), 0);
        const palletsPrefrio = (pallets || []).filter(p => p.status === "en_tunel").length;
        const tunelCap = (tunnels || []).reduce((s, t) => s + (t.capacity || 0), 0);
        const tunelOcc = (tunnels || []).reduce((s, t) => s + (t.occupied || 0), 0);
        const camaraCap = (chambers || []).reduce((s, c) => s + (c.capacity || 0), 0);
        const camaraOcc = (chambers || []).reduce((s, c) => s + (c.occupied || 0), 0);
        const despachosHoy = (shipments || []).filter(s => new Date(s.date).toDateString() === today).length;

        const alertas = [];
        (tunnels || []).forEach(t => {
          if ((t.occupied || 0) >= (t.capacity || 0)) alertas.push(`Túnel ${t.name} lleno`);
        });
        (chambers || []).forEach(c => {
          if ((c.occupied || 0) >= (c.capacity || 0)) alertas.push(`Cámara ${c.name} llena`);
        });
        (lots || []).forEach(l => {
          if (l.held) alertas.push(`Lote ${l.lot_code} retenido por calidad`);
        });

        setStats({
          lotesRecibidos: (lots || []).length, saldoSinVolcar, volcadoHoy,
          pendienteClasificar, fresco, arilos, descarte,
          palletsPrefrio, tunelOcupacion: tunelCap ? Math.round(tunelOcc / tunelCap * 100) : 0,
          camaraOcupacion: camaraCap ? Math.round(camaraOcc / camaraCap * 100) : 0,
          despachosHoy, alertas
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin" /></div>;
  }

  const cards = [
    { label: "Saldo sin volcar", value: fmtKg(stats.saldoSinVolcar), icon: PackageOpen, color: "text-blue-600", to: "/recepcion" },
    { label: "Volcado hoy", value: fmtKg(stats.volcadoHoy), icon: Repeat, color: "text-amber-600", to: "/vuelco" },
    { label: "Pendiente de clasificar", value: fmtKg(stats.pendienteClasificar), icon: Factory, color: "text-orange-600", to: "/produccion" },
    { label: "Fresco producido", value: fmtKg(stats.fresco), icon: Factory, color: "text-green-600", to: "/produccion" },
    { label: "Arilos producidos", value: fmtKg(stats.arilos), icon: Factory, color: "text-purple-600", to: "/produccion" },
    { label: "Descarte", value: fmtKg(stats.descarte), icon: Factory, color: "text-red-600", to: "/produccion" },
    { label: "Pallets en prefrío", value: fmtNum(stats.palletsPrefrio), icon: Snowflake, color: "text-cyan-600", to: "/prefrio" },
    { label: "Ocupación túneles", value: `${stats.tunelOcupacion}%`, icon: Snowflake, color: "text-cyan-600", to: "/prefrio" },
    { label: "Ocupación cámaras", value: `${stats.camaraOcupacion}%`, icon: Warehouse, color: "text-indigo-600", to: "/camaras" },
    { label: "Despachos hoy", value: fmtNum(stats.despachosHoy), icon: Truck, color: "text-emerald-600", to: "/despachos" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <img src={rimonimLogo} alt="Rimonim" className="w-56 max-w-full h-auto rounded-md mb-5" />
        <h1 className="text-2xl font-heading font-bold">Inicio del empaque</h1>
        <p className="text-muted-foreground">Visión general de la operación de empaque</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <Link key={i} to={c.to}>
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Icon className={`w-5 h-5 ${c.color}`} />
                  </div>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className="text-lg font-bold">{c.value}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {stats.alertas.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-800">
              <AlertTriangle className="w-4 h-4" /> Alertas ({stats.alertas.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1 text-sm text-amber-900">
              {stats.alertas.map((a, i) => <li key={i}>• {a}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><ScanLine className="w-4 h-4" /> Acceso rápido móvil</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Link to="/vuelco" className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 hover:border-red-400 hover:bg-red-50 transition-colors">
              <Repeat className="w-7 h-7 text-red-600" />
              <span className="text-sm font-medium text-center">Escanear para vuelco</span>
            </Link>
            <Link to="/prefrio" className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 hover:border-cyan-400 hover:bg-cyan-50 transition-colors">
              <Snowflake className="w-7 h-7 text-cyan-600" />
              <span className="text-sm font-medium text-center">Cargar túnel</span>
            </Link>
            <Link to="/camaras" className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
              <Warehouse className="w-7 h-7 text-indigo-600" />
              <span className="text-sm font-medium text-center">Ingresar a cámara</span>
            </Link>
            <Link to="/despachos" className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 hover:border-emerald-400 hover:bg-emerald-50 transition-colors">
              <Truck className="w-7 h-7 text-emerald-600" />
              <span className="text-sm font-medium text-center">Cargar contenedor</span>
            </Link>
            <Link to="/trazabilidad" className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 hover:border-slate-400 hover:bg-slate-50 transition-colors">
              <ScanLine className="w-7 h-7 text-slate-600" />
              <span className="text-sm font-medium text-center">Consultar trazabilidad</span>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
