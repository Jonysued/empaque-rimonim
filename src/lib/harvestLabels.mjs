import QRCode from 'qrcode';

export const LABEL_FORMATS = {
  a4_18: { label: 'A4 · 18 etiquetas de 60 × 40 mm', columns: 3, rows: 6, width: 60, height: 40, gapX: 5, gapY: 5, qr: 24, pageWidth: 210, pageHeight: 297 },
  single: { label: 'Etiqueta individual · 60 × 40 mm', columns: 1, rows: 1, width: 60, height: 40, gapX: 0, gapY: 0, qr: 24, pageWidth: 60, pageHeight: 40 },
};

export async function generateHarvestLabels(quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) throw new Error('Ingresá una cantidad entre 1 y 200 etiquetas.');
  const codes = new Set();
  while (codes.size < quantity) codes.add(`BIN-${crypto.randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`);
  return Promise.all([...codes].map(async code => ({ code, image: await QRCode.toDataURL(code, { width: 500, margin: 4, errorCorrectionLevel: 'M' }) })));
}

export function labelPages(labels, format) {
  const size = format.columns * format.rows;
  return Array.from({ length: Math.ceil(labels.length / size) }, (_, i) => labels.slice(i * size, (i + 1) * size));
}

export async function harvestLabelsPdf(labels, format) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: [format.pageWidth, format.pageHeight], orientation: format.pageWidth > format.pageHeight ? 'landscape' : 'portrait' });
  const margin = format.columns === 1 ? 0 : 10;
  labelPages(labels, format).forEach((page, pageIndex) => {
    if (pageIndex) pdf.addPage();
    page.forEach((item, index) => {
      const x = margin + index % format.columns * (format.width + format.gapX);
      const y = margin + Math.floor(index / format.columns) * (format.height + format.gapY);
      const center = x + format.width / 2;
      pdf.setDrawColor(170); pdf.setLineWidth(0.15);
      pdf.rect(x + 0.3, y + 0.3, format.width - 0.6, format.height - 0.6);
      pdf.setTextColor(0); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
      pdf.text('RIMONIM', center, y + 5, { align: 'center' });
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
      pdf.text('BIN DE COSECHA', center, y + 9, { align: 'center' });
      pdf.addImage(item.image, 'PNG', center - format.qr / 2, y + 10, format.qr, format.qr);
      pdf.setFont('courier', 'bold'); pdf.setFontSize(8);
      pdf.text(item.code, center, y + 11 + format.qr + 3, { align: 'center' });
    });
  });
  return pdf;
}

export function harvestLabelsHtml(labels, format) {
  const margin = format.columns === 1 ? 0 : 10;
  return `<style>
    @page { size: ${format.pageWidth}mm ${format.pageHeight}mm; margin: 0; }
    body { padding: 0 !important; margin: 0; }
    .bin-sheet { width: ${format.pageWidth}mm; height: ${format.pageHeight}mm; box-sizing: border-box; padding: ${margin}mm;
      display: grid; grid-template-columns: repeat(${format.columns}, ${format.width}mm); grid-template-rows: repeat(${format.rows}, ${format.height}mm);
      column-gap: ${format.gapX}mm; row-gap: ${format.gapY}mm; break-after: page; page-break-after: always; }
    .bin-sheet:last-child { break-after: auto; page-break-after: auto; }
    .bin-sticker { box-sizing: border-box; border: 0.15mm solid #aaa; text-align: center; overflow: hidden; break-inside: avoid; padding-top: 2mm; }
    .bin-sticker strong { display: block; font-size: 11pt; line-height: 4mm; }
    .bin-sticker span { display: block; font-size: 8pt; line-height: 4mm; }
    .bin-sticker img { width: ${format.qr}mm; height: ${format.qr}mm; display: block; margin: 0 auto; }
    .bin-sticker b { display: block; font: bold 8pt monospace; line-height: 4mm; }
  </style>${labelPages(labels, format).map(page => `<section class="bin-sheet">${page.map(item => `<article class="bin-sticker"><strong>RIMONIM</strong><span>BIN DE COSECHA</span><img src="${item.image}" alt="QR ${item.code}" /><b>${item.code}</b></article>`).join('')}</section>`).join('')}`;
}
