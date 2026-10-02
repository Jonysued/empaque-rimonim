import { base44 } from "@/api/base44Client";
import { Capacitor } from "@capacitor/core";
import { Printer } from "@dimer47/capacitor-plugin-printer";
import QRCode from "qrcode";
import { toast } from "sonner";
import { escapeHtml } from "@/lib/qr";

const printerKey = "rimonim.selectedPrinter.ios";

export async function loadCatalog(type) {
  const items = await base44.entities.Catalog.filter({ type, active: true });
  return (items || []).sort((a, b) => (a.label || "").localeCompare(b.label || ""));
}

export async function loadAllCatalogs() {
  const types = [
    "productor", "variedad", "categoria", "calibre", "envase"
  ];
  const items = await base44.entities.Catalog.list();
  return Object.fromEntries(types.map(type => [type, items.filter(item => item.type === type && item.active === true)
    .sort((a, b) => (a.label || '').localeCompare(b.label || ''))]));
}

export function catalogLabels(items) {
  return (items || []).map(i => i.label);
}

export const canChoosePrinter = () => Capacitor.getPlatform() === "ios";

export async function choosePrinter() {
  if (!canChoosePrinter()) return false;
  try {
    const { url } = await Printer.pick();
    if (!url) return false;
    localStorage.setItem(printerKey, url);
    toast.success("Impresora seleccionada");
    return true;
  } catch (error) {
    toast.error(`No se pudo seleccionar la impresora: ${error.message || error}`);
    return false;
  }
}

async function embedQrImages(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const images = Array.from(doc.querySelectorAll("img"));
  await Promise.all(images.map(async img => {
    const url = new URL(img.getAttribute("src"), window.location.href);
    if (url.hostname !== "api.qrserver.com" || url.pathname !== "/v1/create-qr-code/") return;
    const code = url.searchParams.get("data");
    if (!code) return;
    img.src = await QRCode.toDataURL(code, { width: Number(img.width) || 220, margin: 2 });
  }));
  return Array.from(doc.head.querySelectorAll("style")).map(style => style.outerHTML).join("") + doc.body.innerHTML;
}

export async function printHtml(htmlContent, name = "Rimonim") {
  try {
    const content = await embedQrImages(htmlContent);
    const html = `
    <html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 16px; }
      .label { width: 380px; padding: 16px; border: 2px solid #000; box-sizing: border-box; }
      .romaneo { width: 420px; padding: 20px; border: 3px solid #000; box-sizing: border-box; }
      .row { display: flex; justify-content: space-between; margin: 2px 0; font-size: 13px; }
      .big { font-size: 28px; font-weight: bold; }
      .center { text-align: center; }
      img { display: block; margin: 0 auto; }
      @media print { body { padding: 0; } }
    </style>
    </head><body>${content}</body></html>`;

    if (Capacitor.isNativePlatform()) {
      let printer;
      if (canChoosePrinter()) {
        printer = localStorage.getItem(printerKey);
        if (!printer) {
          const { url } = await Printer.pick();
          if (!url) return;
          printer = url;
          localStorage.setItem(printerKey, url);
        }
      }
      const result = await Printer.printHtml({ html, name, ...(printer ? { printer } : {}) });
      if (!result.success && printer) {
        localStorage.removeItem(printerKey);
        toast.error("No se pudo imprimir. Volvé a elegir la impresora e intentá de nuevo.");
      } else if (!result.success && Capacitor.getPlatform() === "android") {
        toast.error("No se completó la impresión. Revisá la impresora seleccionada.");
      }
      return;
    }

    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) throw new Error("El navegador bloqueó la ventana de impresión");
    w.document.write(html);
    w.document.write("<script>window.onload = () => setTimeout(() => window.print(), 300)</script>");
    w.document.close();
  } catch (error) {
    toast.error(`No se pudo imprimir: ${error.message || error}`);
  }
}
