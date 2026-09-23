import React from "react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { qrImageUrl } from "@/lib/qr";
import { printHtml } from "@/lib/catalogs";

export default function QRLabel({ code, title, subtitle, size = 160 }) {
  function print() {
    const html = `
      <div class="label center">
        <div style="font-weight:bold;font-size:16px;">${title || "Empaque Rimonim"}</div>
        ${subtitle ? `<div style="font-size:13px;margin-bottom:6px;">${subtitle}</div>` : ""}
        <img src="${qrImageUrl(code, 240)}" width="220" height="220" />
        <div class="big">${code}</div>
      </div>
    `;
    printHtml(html);
  }

  return (
    <div className="flex flex-col items-center gap-2 p-3 border rounded-lg bg-white">
      <img src={qrImageUrl(code, size)} width={size} height={size} alt={`QR ${code}`} />
      <div className="text-center">
        <p className="font-mono text-sm font-bold">{code}</p>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={print}>
        <Printer className="w-4 h-4 mr-1" /> Imprimir etiqueta
      </Button>
    </div>
  );
}