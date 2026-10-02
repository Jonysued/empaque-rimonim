import React from "react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { qrImageUrl } from "@/lib/qr";
import { printHtml } from "@/lib/catalogs";
import ChangePrinter from "@/components/ChangePrinter";
import QRImage from "@/components/QRImage";
import { escapeHtml } from "@/lib/qr";

export default function QRLabel({ code, title, subtitle, size = 160, onPrint = undefined, printButtonText = "Imprimir etiqueta" }) {
  function print() {
    const html = `
      <div class="label center">
        <div style="font-weight:bold;font-size:16px;">${escapeHtml(title || "Empaco")}</div>
        ${subtitle ? `<div style="font-size:13px;margin-bottom:6px;">${escapeHtml(subtitle)}</div>` : ""}
        <img src="${qrImageUrl(code, 240)}" width="220" height="220" />
        <div class="big">${escapeHtml(code)}</div>
      </div>
    `;
    printHtml(html, `Etiqueta ${code}`);
  }

  return (
    <div className="flex flex-col items-center gap-2 p-3 border rounded-lg bg-white">
      <QRImage code={code} size={size} />
      <div className="text-center">
        <p className="break-all font-mono text-sm font-bold">{code}</p>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onPrint || print}>
        <Printer className="w-4 h-4 mr-1" /> {printButtonText}
      </Button>
      <ChangePrinter />
    </div>
  );
}
