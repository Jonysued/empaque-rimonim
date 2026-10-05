import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { accessWasDenied, preparePrivateHtml } from '../private-web/navigation.mjs';

const sections = ['top', 'como-funciona', 'trazabilidad', 'metricas', 'flujo', 'precios', 'contacto'];
const documentHtml = `<html><body>${sections.map(id => `<section id="${id}"></section>`).join('')}</body></html>`;
const preview = preparePrivateHtml(documentHtml);
const script = /<script>([\s\S]*?)<\/script>/.exec(preview)[1];
let handler, scrolled, focused;
const elements = new Map(sections.map(id => [id, {
  scrollIntoView() { scrolled = id; },
  matches: name => name === 'section',
  hasAttribute: () => true,
  focus() { focused = id; },
}]));
vm.runInNewContext(script, { document: {
  addEventListener(type, callback, capture) { assert.equal(type, 'click'); assert.equal(capture, true); handler = callback; },
  getElementById: id => elements.get(id),
  documentElement: { scrollIntoView() { scrolled = 'top'; }, matches: () => false, hasAttribute: () => false },
} });
for (const id of sections) {
  let prevented = false;
  handler({ target: { closest: () => ({ getAttribute: () => `#${id}` }) }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true, `${id} must not navigate the iframe to the login URL`);
  assert.equal(scrolled, id); assert.equal(focused, id);
}
let prevented = false;
handler({ target: { closest: () => ({ getAttribute: () => '#missing' }) }, preventDefault() { prevented = true; } });
assert.equal(prevented, true, 'Unknown fragments must also stay inside the existing preview');
assert.equal(accessWasDenied({ status: 401 }), true);
assert.equal(accessWasDenied({ status: 403 }), true);
assert.equal(accessWasDenied({ status: 503 }), false);
assert.equal(accessWasDenied(new TypeError('Failed to fetch')), false);

// This is the original srcdoc resolution bug: native relative navigation would
// load the parent login page rather than scroll within the isolated document.
assert.equal(new URL('#metricas', 'https://www.empaco.com.ar/').href, 'https://www.empaco.com.ar/#metricas');
const source = await readFile('private-web/main.jsx', 'utf8');
assert.match(source, /if \(accessWasDenied\(e\)\) \{ setHtml\(''\)/);
assert.match(source, /sandbox="allow-scripts"/);
console.log('PASS: all menu sections stay in the private iframe; no parent navigation; temporary network failures retain the view; revoked/invalid access still clears it; iframe isolation preserved.');
