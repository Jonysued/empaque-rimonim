export const STORAGE_LAYOUTS = {
  camara_flexible: { label: '4 cargas de 20 o 21 · quinta opcional · hasta 101 pallets', capacity: 101, sections: [1, 2, 3, 4, 5] },
  cinco_cargas: { label: '4 cargas de 20 o 21 · quinta habilitada · hasta 101 pallets', capacity: 101, sections: [1, 2, 3, 4, 5] },
  cuatro_cargas: { label: '4 cargas de 20 o 21 · quinta opcional', capacity: 84, sections: [1, 2, 3, 4] },
  tunel_18: { label: 'Túnel · 18 posiciones', capacity: 18, sections: [0] },
};
export const fifthLoadEnabled = location => location?.fifth_load_enabled ?? location?.storage_layout === 'cinco_cargas';
export const storageSections = location => location?.type === 'tunel' ? [0] : fifthLoadEnabled(location) ? [1, 2, 3, 4, 5] : [1, 2, 3, 4];
export function sectionCapacity(layout, section, pallets = []) {
  if (layout === 'tunel_18') return section === 0 ? 18 : 0;
  if (!['cinco_cargas', 'cuatro_cargas', 'camara_flexible'].includes(layout)) return 0;
  if (section >= 1 && section <= 4) return 21;
  return section === 5 ? 21 - pallets.filter(p => Number(p.storage_section) >= 1 && Number(p.storage_section) <= 4 && Number(p.storage_position) === 21).length : 0;
}
// Rows preserve the numbering and orientation of the supplied physical plans.
export function positionRows(layout, section, pallets = []) {
  if (layout === 'tunel_18') return [Array.from({ length: 9 }, (_, i) => i + 10), Array.from({ length: 9 }, (_, i) => i + 1)];
  if (!sectionCapacity(layout, section)) return [];
  if (section === 5) {
    const capacity = sectionCapacity(layout, section, pallets);
    return Array.from({ length: Math.ceil(capacity / 3) }, (_, r) => [1, 2, 3].map(c => r * 3 + c <= capacity ? r * 3 + c : null));
  }
  const rows = Array.from({ length: 4 }, (_, r) => Array.from({ length: 5 }, (_, c) => {
    const col = section >= 3 ? 4 - c : c;
    return col * 4 + ([1, 4].includes(section) ? 4 - r : r + 1);
  }));
  if (section >= 1 && section <= 4) {
    // The extra position sits at the inner corner of each load.
    const innerLeft = section >= 3;
    const extraTop = [2, 3].includes(section);
    rows.forEach((row, r) => innerLeft ? row.unshift(r === (extraTop ? 0 : 3) ? 21 : null) : row.push(r === (extraTop ? 0 : 3) ? 21 : null));
  }
  return rows;
}
export const positionLabel = pallet => pallet.storage_position == null ? 'Pendiente de ubicar' : `${Number(pallet.storage_section) ? `Carga ${pallet.storage_section} · ` : ''}Posición ${pallet.storage_position}`;
export function coolingTimes(pallet, now = Date.now()) {
  const entered = Date.parse(pallet.cooling_entered_at || pallet.storage_entered_at), started = Date.parse(pallet.cooling_started_at), ended = Date.parse(pallet.cooling_finished_at);
  return {
    waiting: Number.isFinite(entered) ? Math.max(0, (Number.isFinite(started) ? started : now) - entered) : null,
    cooling: Number.isFinite(started) ? Math.max(0, (Number.isFinite(ended) ? ended : now) - started) : null,
  };
}
