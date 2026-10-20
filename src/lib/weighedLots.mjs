// Keep completed weighings visible after reception/dumping. A net weight alone
// is not proof of weighing (legacy/imported lots may have an estimated weight).
export function getWeighedLots(lots, search = '') {
  const query = search.trim().toLocaleLowerCase('es');
  return lots.filter(lot => lot.weighed_at && (!query ||
    [lot.lot_code, lot.transport, lot.producer, lot.variety].some(value =>
      String(value || '').toLocaleLowerCase('es').includes(query))))
    .sort((a, b) => (Date.parse(b.weighed_at) || 0) - (Date.parse(a.weighed_at) || 0) ||
      String(a.id).localeCompare(String(b.id)));
}
