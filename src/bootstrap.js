// The commercial domain opens its own entry without initializing app auth,
// operational queries, offline queues, or the app stylesheet.
if (window.location.pathname.replace(/\/$/, '') === '/web-privada' || window.location.hostname === 'empaco.com.ar' || window.location.hostname === 'www.empaco.com.ar') {
  document.title = 'Empaco — Web privada';
  import('../private-web/main.jsx');
} else {
  import('./main.jsx');
}
