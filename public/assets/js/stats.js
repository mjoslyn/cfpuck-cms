// Site statistics (src/lib/stats.ts): reports this page's view, and each link followed from it, to
// /api/stats. No cookies or storage; pages stay cached for everyone.
(() => {
  const send = (hit) => {
    const body = new Blob([JSON.stringify({ p: location.pathname, ...hit })], { type: 'text/plain' });
    if (!navigator.sendBeacon?.('/api/stats', body)) fetch('/api/stats', { method: 'POST', body, keepalive: true }).catch(() => {});
  };
  send({ t: 'view', r: document.referrer });
  // A link clicked (or middle-clicked into a new tab); links within the page (#...) and scripts aren't.
  const clicked = (e) => {
    if (e.type === 'auxclick' && e.button !== 1) return;
    const a = e.target instanceof Element && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#') || /^javascript:/i.test(href)) return;
    send({ t: 'click', h: a.href });
  };
  addEventListener('click', clicked, { capture: true, passive: true });
  addEventListener('auxclick', clicked, { capture: true, passive: true });
})();
