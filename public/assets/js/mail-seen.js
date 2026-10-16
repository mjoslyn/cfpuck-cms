// A visit from a tracked link in one of the site's emails (#mc=<click> in the address): on the visitor's
// first real interaction (a pointer move, touch, key or scroll) the click is reported as a person's
// (POST /api/mail/seen). The fragment is removed at once; the server never sees it, so cached pages stay shared.
(() => {
  const m = location.hash.match(/^#mc=([0-9]+\.[A-Za-z0-9_-]{22})$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  const events = ['pointermove', 'touchstart', 'keydown', 'scroll'];
  const send = () => {
    events.forEach((e) => removeEventListener(e, send, true));
    navigator.sendBeacon('/api/mail/seen', new Blob([m[1]], { type: 'text/plain' }));
  };
  events.forEach((e) => addEventListener(e, send, { capture: true, passive: true }));
})();
