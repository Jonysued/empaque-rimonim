// srcdoc inherits the parent URL for relative links. Fragment navigation must
// stay inside this isolated document rather than reload the parent's login URL.
export function installSectionNavigation() {
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    const href = link?.getAttribute('href');
    if (!href?.startsWith('#')) return;
    event.preventDefault();
    let id;
    try { id = decodeURIComponent(href.slice(1)); } catch { return; }
    const target = id ? document.getElementById(id) : document.documentElement;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (target.matches('section') && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    if (target.hasAttribute('tabindex')) target.focus({ preventScroll: true });
  }, true);
}

export function preparePrivateHtml(html) {
  const script = `<script>(${installSectionNavigation.toString()})();</script>`;
  return html.replace(/<\/body\s*>/i, `${script}</body>`);
}

export function accessWasDenied(error) {
  return error?.status === 401 || error?.status === 403;
}
