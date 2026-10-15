import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { LABEL_FORMATS, generateHarvestLabels, labelPages, harvestLabelsPdf, harvestLabelsHtml } from '../src/lib/harvestLabels.mjs';
const labels = await generateHarvestLabels(17);
assert.equal(new Set(labels.map(label => label.code)).size,17);
for (const label of labels) {
  assert.match(label.code,/^BIN-[0-9A-F]{20}$/);
  const png = PNG.sync.read(Buffer.from(label.image.split(',')[1],'base64'));
  assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data,label.code);
}
for (const format of Object.values(LABEL_FORMATS)) {
  const pages = labelPages(labels,format);
  assert.equal(pages.flat().length,17);
  assert.equal(format.width,60); assert.equal(format.height,40);
  const pdf = await harvestLabelsPdf(labels,format);
  assert.equal(pdf.getNumberOfPages(),pages.length);
  assert.ok(Math.abs(pdf.internal.pageSize.getWidth()-format.pageWidth)<0.00001);
  assert.ok(Math.abs(pdf.internal.pageSize.getHeight()-format.pageHeight)<0.00001);
  const margin = format.columns === 1 ? 0 : 10;
  assert.ok(margin*2+format.columns*format.width+(format.columns-1)*format.gapX <= format.pageWidth);
  assert.ok(margin*2+format.rows*format.height+(format.rows-1)*format.gapY <= format.pageHeight);
  assert.ok(format.qr+16 <= format.height);
  const html = harvestLabelsHtml(labels,format);
  assert.equal((html.match(/<article /g)||[]).length,17);
  assert.equal((html.match(/<section /g)||[]).length,pages.length);
  assert.ok(!html.includes('api.qrserver.com'));
}
for (const count of [0,10001,1.5,NaN,Infinity]) await assert.rejects(generateHarvestLabels(count));
assert.equal((await generateHarvestLabels(201)).length,201);
// Exercise the upper boundary without retaining 10,000 raster images in CI.
const originalRenderer = QRCode.toDataURL;
let active = 0, peak = 0;
try {
  QRCode.toDataURL = async () => {
    active++; peak = Math.max(peak,active);
    await Promise.resolve();
    active--;
    return 'data:image/png;base64,test';
  };
  const large = await generateHarvestLabels(10000);
  assert.equal(large.length,10000);
  assert.equal(new Set(large.map(label => label.code)).size,10000);
  assert.equal(labelPages(large,LABEL_FORMATS.a4_18).length,556);
  assert.ok(peak <= 20);
} finally { QRCode.toDataURL = originalRenderer; }
console.log('PASS: QR decodificables y únicos, PDF paginado con medidas reales, etiquetas completas y límites de cantidad');
