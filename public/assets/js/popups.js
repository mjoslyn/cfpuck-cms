// Popups and the cookie consent banner (src/lib/popups.ts). Each .c-popup carries its settings in
// data-popup: shown on load, after a delay, at a depth of scrolling or as the visitor goes to leave, as
// often as set (remembered in this browser's storage). The consent banner shows until the visitor
// chooses; the choice is the site_consent cookie (all or necessary, six months), and links to
// #cookie-settings open it again. Accepting runs the code snippets kept for it (<template
// data-consent-snippet>) and fires `c-consent` (Stats' visitor cookie listens); rejecting fires
// `c-consent-reject`. Links to #accept-cookies, #reject-cookies and #close-popup work inside any popup.
(() => {
  const read = (name) => document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
  const store = (kind) => {
    try {
      return kind === 'session' ? sessionStorage : localStorage;
    } catch {
      return null;
    }
  };
  const get = (kind, key) => {
    try {
      return store(kind)?.getItem(key);
    } catch {
      return null;
    }
  };
  const put = (kind, key, value) => {
    try {
      store(kind)?.setItem(key, value);
    } catch {}
  };

  // Snippets kept for consent: their markup put in place, scripts made afresh so they run, in order.
  const runSnippets = () => {
    for (const tpl of document.querySelectorAll('template[data-consent-snippet]')) {
      const frag = tpl.content.cloneNode(true);
      for (const old of frag.querySelectorAll('script')) {
        const s = document.createElement('script');
        for (const a of old.attributes) s.setAttribute(a.name, a.value);
        if (!old.hasAttribute('async')) s.async = false;
        s.text = old.text;
        old.replaceWith(s);
      }
      tpl.replaceWith(frag);
    }
  };
  if (read('site_consent') === 'all') runSnippets();

  const popups = [...document.querySelectorAll('.c-popup[data-popup]')].map((el) => ({ el, o: JSON.parse(el.dataset.popup || '{}') }));
  const queue = [];
  let open = null; // the open dialog (modal), if any
  let returnTo = null;

  const due = ({ o }) => {
    if (o.consent) return !read('site_consent');
    if (o.frequency === 'session') return !get('session', `popup:${o.id}`);
    if (o.frequency === 'days') {
      const at = Number(get('local', `popup:${o.id}`));
      return !at || Date.now() - at > (o.days || 7) * 86400000;
    }
    return true;
  };

  const show = (p, force) => {
    if (!force && !due(p)) return;
    if (!p.el.hidden) return;
    const modal = p.el.classList.contains('is-modal');
    if (modal && open) return void queue.push(p);
    p.el.hidden = false;
    requestAnimationFrame(() => p.el.classList.add('is-open'));
    if (modal) {
      open = p;
      returnTo = document.activeElement;
      document.documentElement.classList.add('has-popup');
      (p.el.querySelector('.c-popup__box') || p.el).focus({ preventScroll: true });
    }
  };

  const close = (p, remember = true) => {
    if (p.el.hidden) return;
    p.el.classList.remove('is-open');
    p.el.hidden = true;
    if (remember && !p.o.consent) {
      if (p.o.frequency === 'session') put('session', `popup:${p.o.id}`, '1');
      if (p.o.frequency === 'days') put('local', `popup:${p.o.id}`, String(Date.now()));
    }
    if (open === p) {
      open = null;
      document.documentElement.classList.remove('has-popup');
      returnTo?.focus?.({ preventScroll: true });
      const next = queue.shift();
      if (next) show(next);
    }
  };

  const choose = (value) => {
    document.cookie = `site_consent=${value}; Max-Age=${60 * 60 * 24 * 182}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    if (banner) close(banner);
    if (value === 'all') {
      runSnippets();
      dispatchEvent(new CustomEvent('c-consent', { detail: { all: true } }));
    } else dispatchEvent(new CustomEvent('c-consent-reject'));
  };

  // Triggers. While the consent banner waits for an answer it is the only popup: the others start once
  // the visitor has chosen, so nothing covers it or holds the keyboard away from it.
  const banner = popups.find((p) => p.o.consent);
  let started = false;
  const start = (list) => {
    if (started) return;
    started = true;
    list.forEach(arm);
  };
  if (banner && due(banner)) {
    show(banner);
    addEventListener('c-consent', () => start(popups.filter((p) => p !== banner)), { once: true });
    addEventListener('c-consent-reject', () => start(popups.filter((p) => p !== banner)), { once: true });
  } else start(popups.filter((p) => p !== banner));

  function arm(p) {
    const t = p.o.trigger;
    if (t === 'delay') setTimeout(() => show(p), (p.o.delay ?? 5) * 1000);
    else if (t === 'scroll') {
      const check = () => {
        const max = document.documentElement.scrollHeight - innerHeight;
        if (max <= 0 || (scrollY / max) * 100 >= (p.o.scroll ?? 50)) {
          removeEventListener('scroll', check);
          show(p);
        }
      };
      addEventListener('scroll', check, { passive: true });
    } else if (t === 'exit') {
      const leave = (e) => {
        if (e.relatedTarget || e.clientY > 0) return;
        document.removeEventListener('mouseout', leave);
        show(p);
      };
      document.addEventListener('mouseout', leave);
    } else show(p);
  }

  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const choice = t.closest('[data-consent-choice]');
    if (choice) return void choose(choice.getAttribute('data-consent-choice'));
    const a = t.closest('a[href]');
    const hash = a?.getAttribute('href');
    const p = popups.find((x) => x.el.contains(t));
    if (hash === '#cookie-settings') {
      if (banner) {
        e.preventDefault();
        show(banner, true);
      }
    } else if (hash === '#accept-cookies' || hash === '#reject-cookies') {
      e.preventDefault();
      choose(hash === '#accept-cookies' ? 'all' : 'necessary');
    } else if (p && (hash === '#close-popup' || t.closest('[data-popup-close]'))) {
      e.preventDefault();
      if (!p.o.consent) close(p);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape' && !open.o.consent) return void close(open);
    // Keep focus inside an open dialog.
    if (e.key !== 'Tab') return;
    const items = [...open.el.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!items.length) return;
    const [first, last] = [items[0], items[items.length - 1]];
    if (e.shiftKey && (document.activeElement === first || !open.el.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
})();
