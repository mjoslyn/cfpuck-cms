// Site statistics (src/lib/stats.ts): reports this page's view (with its utm_ campaign, if any), and each
// link followed from it, to /api/stats. Pages stay cached for everyone. With Settings > Stats' cookie on
// (data-cookie), a random visitor id is kept in a first-party cookie (site_vid) so returning visitors are
// recognised; while a cookie consent banner is on (data-consent), only once the visitor accepts.
(() => {
  const me = document.currentScript;
  const cookieOn = me?.dataset.cookie === '1';
  const needsConsent = me?.dataset.consent === '1';
  const read = (name) => document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
  const allowed = () => cookieOn && (!needsConsent || read('site_consent') === 'all');
  const visitor = () => {
    if (!allowed()) return undefined;
    let id = read('site_vid');
    if (!/^[A-Za-z0-9_-]{22}$/.test(id || '')) {
      const b = crypto.getRandomValues(new Uint8Array(16));
      id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 22);
    }
    // Renewed on each visit: 13 months from the last.
    document.cookie = `site_vid=${id}; Max-Age=${60 * 60 * 24 * 395}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    return id;
  };
  const send = (hit) => {
    const body = new Blob([JSON.stringify({ p: location.pathname, ...hit })], { type: 'text/plain' });
    if (!navigator.sendBeacon?.('/api/stats', body)) fetch('/api/stats', { method: 'POST', body, keepalive: true }).catch(() => {});
  };
  const q = new URLSearchParams(location.search);
  const u = { c: q.get('utm_campaign') || undefined, s: q.get('utm_source') || undefined, m: q.get('utm_medium') || undefined };
  send({ t: 'view', r: document.referrer, v: visitor(), ...(u.c || u.s ? { u } : {}) });
  // Accepting cookies on this page starts the visitor cookie (counted from the next page).
  addEventListener('c-consent', () => visitor());
  // Removed on rejecting them.
  addEventListener('c-consent-reject', () => (document.cookie = 'site_vid=; Max-Age=0; Path=/'));
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
