import { base44 } from "@/api/base44Client";

export async function loadCatalog(type) {
  const items = await base44.entities.Catalog.filter({ type, active: true });
  return (items || []).sort((a, b) => (a.label || "").localeCompare(b.label || ""));
}

export async function loadAllCatalogs() {
  const types = [
    "productor", "variedad", "categoria", "calibre", "envase"
  ];
  const entries = await Promise.all(types.map(t => loadCatalog(t).then(v => [t, v])));
  return Object.fromEntries(entries);
}

export function catalogLabels(items) {
  return (items || []).map(i => i.label);
}

export function printHtml(htmlContent) {
  const w = window.open("", "_blank", "width=800,height=600");
  if (!w) return;
  w.document.write(`
    <html><head><title>Imprimir</title>
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
    </head><body>${htmlContent}
    <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); }</script>
    </body></html>
  `);
  w.document.close();
}
