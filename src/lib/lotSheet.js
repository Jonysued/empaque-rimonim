import { fmtKg, fmtDate, fmtDay, qrImageUrl } from './qr.js';

const escape = value => String(value ?? '—').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const weight = value => value != null ? fmtKg(value) : 'Sin pesar';
const day = value => value ? fmtDay(`${value}T12:00:00`) : '—';
const statuses = { en_campo:'En consolidado', cerrado_campo:'Cerrado · pendiente de pesado', pesado:'Pesado', recibido:'Recibido', parcialmente_volcado:'Parcialmente volcado', volcado:'Volcado', anulado:'Anulado' };
const crews = item => item.crew === 'MIXTO' ? `MIXTO: ${(item.crew_breakdown || []).map(crew => `${crew.crew}${crew.bins_count != null ? ` (${crew.bins_count} BINs)` : ''}`).join(' / ')}` : item.crew;
const row = (label,value) => `<div class="sheet-field"><span>${escape(label)}</span><b>${escape(value === '' ? '—' : value)}</b></div>`;

export function lotSheetHtml(lot, bins) {
  const fields = [
    ['Estado', statuses[lot.status] || lot.status], ['Retención por calidad',lot.held ? 'Retenido' : 'Sin retención'],
    ['Productor',lot.producer],['Variedad',lot.variety],['Procedencia / Cuadro',lot.origin],['Especie',lot.species],
    ['Tipo de cosecha',lot.harvest_type],['Cuadrilla',crews(lot)],['Transporte',lot.transport],['Fecha de cosecha',day(lot.harvest_date)],
    ['Cantidad de BINs',lot.bins_count ?? bins.length],['BINs declarados',lot.expected_bins_count ?? lot.bins_count ?? bins.length],
  ];
  const weights = [['Peso bruto',weight(lot.gross_weight)],['Tara',weight(lot.tare_weight)],['Peso neto',weight(lot.net_weight)],
    ['Peso teórico por BIN',lot.net_weight != null && lot.bins_count > 0 ? fmtKg(lot.net_weight / lot.bins_count) : 'Sin pesar'],
    ['Saldo sin volcar',lot.net_weight != null ? fmtKg(lot.remaining_weight) : 'Sin pesar'],['Volcado acumulado',lot.net_weight != null ? fmtKg(lot.dumped_weight) : 'Sin pesar'],
    ['BINs volcados',lot.bins_dumped ?? (lot.status === 'volcado' ? lot.bins_count : 0)]];
  const dates = [['Creación del lote',fmtDate(lot.field_created_at || lot.created_date)],['Cierre del consolidado',fmtDate(lot.field_closed_at)],
    ['Pesado',fmtDate(lot.weighed_at)],['Recepción Playa Empaque',fmtDate(lot.yard_received_at || lot.receipt_date)]];
  const sorted = [...bins].sort((a,b)=>String(a.bin_code).localeCompare(String(b.bin_code)));
  const half = Math.ceil(sorted.length / 2);
  const binTable = (items, offset = 0) => `<table class="sheet-bins"><thead><tr><th>N.º</th><th>Código del BIN</th><th>kg</th></tr></thead><tbody>${items.map((bin,index)=>`<tr><td>${offset+index+1}</td><td class="bin-code">${escape(bin.bin_code)}</td><td>${escape(bin.net_weight != null ? Number(bin.net_weight).toLocaleString('es-AR',{maximumFractionDigits:1}) : '—')}</td></tr>`).join('')}</tbody></table>`;
  return `<style>
    @page { size: A4 portrait; margin: 10mm; }
    body { margin: 0; padding: 0 !important; color: #111; font-family: Arial,sans-serif; font-size: 9pt; }
    .lot-sheet { max-width: 190mm; margin: 0 auto; }
    .sheet-header { display: flex; justify-content: space-between; gap: 4mm; align-items: center; border-bottom: 0.6mm solid #111; padding-bottom: 2mm; }
    .sheet-header h1 { font-size: 12pt; margin: 0 0 1mm; }
    .sheet-header h2 { font-size: 12pt; margin: 0 0 1mm; }
    .sheet-header p { margin: 1mm 0; overflow-wrap: anywhere; }
    .sheet-qr { width: 22mm; height: 22mm; margin: 0; }
    .sheet-section { margin-top: 2mm; }
    .sheet-section h3 { font-size: 9pt; margin: 0 0 2mm; padding: 1mm 0; border-bottom: 0.3mm solid #777; break-after: avoid; }
    .sheet-grid { display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 4mm; }
    .sheet-field { display: flex; flex-direction: column; border-bottom: 0.2mm solid #ddd; padding: 1mm 0; break-inside: avoid; }
    .sheet-field span { font-size: 7pt; color: #444; }
    .sheet-field b { font-size: 8pt; white-space: pre-wrap; overflow-wrap: anywhere; }
    .sheet-note { white-space: pre-wrap; overflow-wrap: anywhere; margin: 2mm 0; }
    .sheet-warning { border: 0.3mm solid #555; padding: 2mm; font-weight: bold; }
    .sheet-bins { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8pt; }
    .sheet-bins thead { display: table-header-group; }
    .sheet-bins th, .sheet-bins td { border: 0.2mm solid #bbb; padding: 0.6mm 1mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    .sheet-bins th { background: #eee; }
    .sheet-bins tr { break-inside: avoid; }
    .sheet-bin-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; align-items: start; }
    .sheet-bins th:first-child { width: 7%; }
    .sheet-bins th:last-child { width: 14%; }
    .sheet-bins .bin-code { font-family: monospace; font-size: 7.5pt; }
    .sheet-bins td { line-height: 3.2mm; }
    .sheet-weights { grid-template-columns: repeat(4, 1fr); }
    .sheet-dates { grid-template-columns: repeat(4, 1fr); }
    .sheet-dates b { font-size: 7.5pt; }
    .sheet-bin-note { font-size: 7pt; margin: 1mm 0 0; color: #555; }
    .sheet-footer { margin-top: 2mm; font-size: 8pt; color: #555; }
  </style><article class="lot-sheet">
    <header class="sheet-header"><div><h1>RIMONIM</h1><h2>Ficha de lote</h2><p><b>${escape(lot.lot_code)}</b></p><p>Operación de empaque</p></div><img class="sheet-qr" src="${qrImageUrl(lot.lot_code,300)}" width="300" height="300" alt="QR del lote" /></header>
    ${lot.pendingStatus ? `<p class="sheet-warning">${lot.pendingStatus === 'conflict' ? 'Requiere revisión de sincronización' : 'Datos de este dispositivo pendientes de sincronizar'}</p>` : ''}
    <section class="sheet-section"><h3>Datos del lote</h3><div class="sheet-grid">${fields.map(([label,value])=>row(label,value)).join('')}</div></section>
    <section class="sheet-section"><h3>Pesos y balance</h3><div class="sheet-grid sheet-weights">${weights.map(([label,value])=>row(label,value)).join('')}</div></section>
    <section class="sheet-section"><h3>Fechas del proceso</h3><div class="sheet-grid sheet-dates">${dates.map(([label,value])=>row(label,value)).join('')}</div></section>
    <section class="sheet-section"><h3>Notas de calidad del lote</h3><p class="sheet-note">${escape(lot.quality_notes || 'Sin observaciones')}</p></section>
    <section class="sheet-section"><h3>Detalle de BINs (${bins.length})</h3>${bins.length ? `<div class="sheet-bin-columns">${binTable(sorted.slice(0,half))}${binTable(sorted.slice(half),half)}</div><p class="sheet-bin-note">Información individual de cosecha y notas de cada bin disponibles en la aplicación.</p>` : '<p>Este lote no tiene BINs individualizados registrados.</p>'}</section>
    <p class="sheet-footer">Ficha emitida: ${escape(fmtDate(new Date().toISOString()))} · ${escape(lot.lot_code)}</p>
  </article>`;
}
