import React from "react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { qrImageUrl } from "@/lib/qr";
import { printHtml } from "@/lib/catalogs";
import { fmtDay } from "@/lib/qr";

export default function PrintRomaneo({ pallet }) {
  if (!pallet) return null;

  function print() {
    const fields = [
      ["Producto", pallet.product_type === "fresco" ? "Fresco" : "Arilos"],
      ["Productor", pallet.producer || "—"],
      ["Variedad", pallet.variety || "—"],
      ["Categoría", pallet.category || "—"],
      ["Calibre", pallet.calibre || "—"],
      ["Envase", pallet.package_type || "—"],
      ["Bultos", String(pallet.package_count ?? "—")],
      ["Neto (kg)", String(pallet.net_weight ?? "—")],
      ["Bruto (kg)", String(pallet.gross_weight ?? "—")],
      ["Tara (kg)", String(pallet.tare_weight ?? "—")],
      ["Corrida", pallet.production_run_code || "—"],
      ["Estado", pallet.status || "—"],
      ["Fecha", fmtDay(new Date().toISOString())],
    ];
    const rows = fields.map(([k, v]) => `<div class="row"><span><b>${k}</b></span><span>${v}</span></div>`).join("");
    const html = `
      <div class="romaneo">
        <div class="center" style="border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:10px;">
          <div style="font-size:20px;font-weight:bold;">ROMANEO DE EMPAQUE</div>
          <div class="big">${pallet.romaneo_number}</div>
        </div>
        <div class="center"><img src="${qrImageUrl(pallet.pallet_code, 200)}" width="180" height="180" /></div>
        <div class="center" style="font-size:12px;margin:6px 0;">${pallet.pallet_code}</div>
        <div style="border-top:1px solid #ccc;padding-top:8px;">${rows}</div>
      </div>
    `;
    printHtml(html);
  }

  return (
    <Button type="button" onClick={print} className="w-full">
      <Printer className="w-4 h-4 mr-2" /> Imprimir romaneo
    </Button>
  );
}