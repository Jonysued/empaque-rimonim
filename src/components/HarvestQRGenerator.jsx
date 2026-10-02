import React, { useState } from 'react';
import { QrCode, Download, Printer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LABEL_FORMATS, generateHarvestLabels, labelPages, harvestLabelsPdf, harvestLabelsHtml } from '@/lib/harvestLabels.mjs';
import { printHtml } from '@/lib/catalogs';

export default function HarvestQRGenerator() {
  const [quantity, setQuantity] = useState('18');
  const [formatKey, setFormatKey] = useState('a4_18');
  const [labels, setLabels] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const format = LABEL_FORMATS[formatKey];
  const pages = labelPages(labels, format);

  async function generate(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try { setLabels(await generateHarvestLabels(Number(quantity))); }
    catch (e) { setError(e.message || 'No se pudieron generar las etiquetas'); }
    finally { setBusy(false); }
  }
  async function download() {
    setError(''); setBusy(true);
    try {
      const pdf = await harvestLabelsPdf(labels, format);
      pdf.save(`Empaco-QR-bines-${labels[0].code.slice(-8)}.pdf`);
    } catch (e) { setError(e.message || 'No se pudo descargar el PDF'); }
    finally { setBusy(false); }
  }
  async function print() {
    setBusy(true);
    try { await printHtml(harvestLabelsHtml(labels, format), 'Empaco · QR bines de cosecha'); }
    finally { setBusy(false); }
  }
  return <Card>
    <CardHeader><CardTitle className="text-base flex items-center gap-2"><QrCode className="w-5 h-5" /> Generador de QR para bines de cosecha</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm text-muted-foreground">Generá etiquetas de 60 × 40 mm, pegalas en los bines y escanealas en Cosecha para cargar la información de cada uno.</p>
      <form onSubmit={generate} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="bin-qr-count">Cantidad de etiquetas</Label><Input id="bin-qr-count" className="w-36" type="number" min="1" max="200" step="1" required disabled={busy} value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
        <div className="space-y-1 w-full min-w-0 sm:flex-1 sm:min-w-60"><Label htmlFor="bin-qr-format">Formato de impresión</Label><select id="bin-qr-format" className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" disabled={busy} value={formatKey} onChange={e => setFormatKey(e.target.value)}>{Object.entries(LABEL_FORMATS).map(([key,item]) => <option key={key} value={key}>{item.label}</option>)}</select></div>
        <Button type="submit" disabled={busy}><QrCode className="w-4 h-4 mr-2" />{busy ? 'Preparando…' : labels.length ? 'Generar nuevos QR' : 'Generar QR'}</Button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {labels.length > 0 && <>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm" role="status">{labels.length} etiquetas únicas · {pages.length} {pages.length === 1 ? 'hoja' : 'hojas'}</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={download}><Download className="w-4 h-4 mr-2" /> Descargar PDF</Button><Button disabled={busy} onClick={print}><Printer className="w-4 h-4 mr-2" /> Imprimir etiquetas</Button></div></div>
        <p className="text-sm text-muted-foreground">Imprimí al 100 % o «Tamaño real», sin ajustar a la página y sin encabezados ni pies. Cada QR corresponde a un bin. Guardá el PDF para volver a imprimir estos mismos códigos; «Generar nuevos QR» crea otros distintos.</p>
        <div className="rounded-lg border bg-muted/30 p-3 space-y-3"><h3 className="text-sm font-medium">Vista previa · primera hoja</h3><div className={`grid gap-3 ${format.columns === 1 ? 'grid-cols-1 max-w-xs mx-auto' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>{pages[0].map(item => <div key={item.code} className="rounded border bg-white text-black p-3 flex flex-col items-center"><b className="text-base">RIMONIM</b><span className="text-xs">BIN DE COSECHA</span><img src={item.image} alt={`QR del bin ${item.code}`} width={160} height={160} className="w-32 h-32" /><b className="font-mono text-xs break-all text-center">{item.code}</b></div>)}</div></div>
      </>}
      <p className="text-xs text-muted-foreground">Las etiquetas no crean lotes ni bines registrados. El alta se realiza al guardar la ficha en Cosecha.</p>
    </CardContent>
  </Card>;
}
