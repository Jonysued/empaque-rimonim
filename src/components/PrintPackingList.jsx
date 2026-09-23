import React from "react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { qrImageUrl, fmtKg, fmtDate } from "@/lib/qr";
import { printHtml } from "@/lib/catalogs";

export default function PrintPackingList({ shipment, pallets }) {
  if (!shipment) return null;

  function print() {
    const list = pallets || [];
    const totalBultos = list.reduce((s, p) => s + (p.package_count || 0), 0);
    const totalNeto = list.reduce((s, p) => s + (p.net_weight || 0), 0);

    const info = [
      ["Carga", shipment.load_number],
      ["Fecha", fmtDate(shipment.date)],
      ["Cliente", shipment.client || "—"],
      ["Destino", shipment.destination || "—"],
      ["Producto", shipment.product_type === "fresco" ? "Fresco" : "Arilos"],
      ["Contenedor", shipment.container_number || "—"],
      ["Transportista", shipment.carrier || "—"],
      ["Remito", shipment.remito || "—"],
      ["Termógrafo", shipment.thermograph || "—"],
      ["Precinto", shipment.seal || "—"],
      ["Pallets", `${list.length}/${shipment.target_capacity || 21}`],
    ];
    const infoHtml = info
      .map(([k, v]) => `<div class="row"><span><b>${k}</b></span><span>${v}</span></div>`)
      .join("");

    const rows = list
      .map((p, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${p.romaneo_number || ""}</td>
          <td>${p.product_type === "fresco" ? "Fresco" : "Arilos"}</td>
          <td>${p.variety || ""}</td>
          <td>${p.category || ""}</td>
          <td>${p.calibre || ""}</td>
          <td>${p.package_type || ""}</td>
          <td class="num">${p.package_count ?? ""}</td>
          <td class="num">${p.net_weight ?? ""}</td>
        </tr>`)
      .join("");

    const html = `
      <style>
        .packing { width: 100%; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 32px; margin-bottom: 14px; }
        .row { display: flex; justify-content: space-between; font-size: 13px; border-bottom: 1px solid #eee; padding: 2px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #555; padding: 4px 6px; text-align: left; }
        th { background: #f0f0f0; }
        td.num, th.num { text-align: right; }
        .totals td { font-weight: bold; background: #fafafa; }
      </style>
      <div class="packing">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #000; padding-bottom:8px; margin-bottom:12px;">
          <div>
            <div style="font-size:22px; font-weight:bold;">PACKING LIST</div>
            <div style="font-size:16px; font-weight:bold;">${shipment.load_number}</div>
          </div>
          <img src="${qrImageUrl(shipment.shipment_code, 120)}" width="90" height="90" />
        </div>
        <div class="grid2">${infoHtml}</div>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Romaneo</th><th>Producto</th><th>Variedad</th><th>Categoría</th><th>Calibre</th><th>Envase</th><th class="num">Bultos</th><th class="num">Neto (kg)</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr class="totals">
              <td colspan="7">TOTALES · ${list.length} pallets</td>
              <td class="num">${totalBultos}</td>
              <td class="num">${totalNeto}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    printHtml(html);
  }

  return (
    <Button type="button" variant="outline" onClick={print} className="w-full">
      <Printer className="w-4 h-4 mr-2" /> Imprimir packing list
    </Button>
  );
}