// The shop's cart (src/render/c/shop.ts). The cart lives in this browser (localStorage), so pages stay
// cached and shared: Add to cart forms add to it, Cart links show how many items are in it, and the
// Cart block lists it with the server's prices (POST /api/shop/quote), which also says what is left.
// What's left of each variant on the page is asked again (GET /api/shop/availability), since a cached
// page can be a minute old.
(() => {
  const KEY = 'site.cart';
  const MAX = 99;

  const read = () => {
    try {
      const lines = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(lines) ? lines.filter((l) => l && l.product > 0 && typeof l.variant === 'string' && l.quantity > 0) : [];
    } catch {
      return [];
    }
  };
  const write = (lines) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {}
    document.dispatchEvent(new CustomEvent('c-cart:change', { detail: { lines } }));
  };
  const count = (lines) => lines.reduce((n, l) => n + l.quantity, 0);
  const money = (cents, currency) => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  };
  const el = (tag, props = {}, children = []) => {
    const e = Object.assign(document.createElement(tag), props);
    for (const c of [].concat(children)) if (c != null) e.append(c);
    return e;
  };

  // Cart links: the number of items, hidden when there are none.
  const showCount = () => {
    const n = count(read());
    for (const c of document.querySelectorAll('[data-cart-count]')) {
      c.textContent = String(n);
      c.hidden = n === 0;
      c.closest('[data-cart-link]')?.setAttribute('aria-label', `${c.closest('[data-cart-link]').querySelector('.c-cart-link__label')?.textContent || 'Cart'}: ${n} ${n === 1 ? 'item' : 'items'}`);
    }
  };

  // Add to cart.
  const forms = [...document.querySelectorAll('form[data-add-to-cart]')];
  const states = forms.map((form) => {
    let variants = [];
    try {
      variants = JSON.parse(form.dataset.variants || '[]');
    } catch {}
    const selects = [...form.querySelectorAll('select[name^="option-"]')];
    // Begin on the first variant left.
    for (const s of selects) if (s.dataset.value) s.value = s.dataset.value;
    const qty = form.querySelector('input[name="quantity"]');
    const button = form.querySelector('button[type="submit"]');
    const price = form.querySelector('.c-add-to-cart__price');
    const status = form.querySelector('.c-add-to-cart__status');
    const label = form.dataset.label || 'Add to cart';
    const currency = form.dataset.currency || 'USD';
    const product = Number(form.dataset.product);
    // The product's image on the page, swapped for a variant's own.
    const img = document.querySelector('.c-entry-image img');
    const original = img && { src: img.getAttribute('src'), srcset: img.getAttribute('srcset'), sources: [...(img.closest('picture')?.querySelectorAll('source') ?? [])] };
    const chosen = () => {
      const values = selects.map((s) => s.value);
      return variants.find((v) => v.values.every((x, i) => x === values[i]));
    };
    const inCart = (v) => read().find((l) => l.product === product && l.variant === v.id)?.quantity ?? 0;
    const refresh = () => {
      const v = chosen();
      // Mark the values that lead to nothing left, given the other choices.
      selects.forEach((s, i) => {
        for (const o of s.options) {
          const values = selects.map((x) => x.value);
          values[i] = o.value;
          const match = variants.find((v) => v.values.every((x, j) => x === values[j]));
          const base = o.dataset.label ?? (o.dataset.label = o.textContent);
          o.textContent = !match ? `${base} (not available)` : match.left <= 0 ? `${base} (sold out)` : base;
        }
      });
      if (!v) {
        button.disabled = true;
        button.textContent = 'Not available';
        return;
      }
      const room = Math.max(0, v.left - inCart(v));
      button.disabled = room <= 0;
      button.textContent = v.left <= 0 ? 'Sold out' : room <= 0 ? 'All in your cart' : label;
      if (qty && qty.type === 'number') {
        qty.max = String(Math.max(1, room));
        if (Number(qty.value) > room && room > 0) qty.value = String(room);
      }
      if (price) {
        price.innerHTML = '';
        if (v.compareAt && v.compareAt > v.price) price.append(el('s', { className: 'c-price__was', textContent: money(v.compareAt, currency) }), ' ');
        price.append(el('span', { className: 'c-price__now', textContent: money(v.price, currency) }));
      }
      if (img && original) {
        if (v.image) {
          img.src = v.image;
          img.removeAttribute('srcset');
          original.sources.forEach((s) => s.remove());
        } else if (img.getAttribute('src') !== original.src) {
          img.src = original.src;
          if (original.srcset) img.setAttribute('srcset', original.srcset);
          const pic = img.closest('picture');
          if (pic) original.sources.forEach((s) => pic.insertBefore(s, img));
        }
      }
    };
    selects.forEach((s) => s.addEventListener('change', refresh));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = chosen();
      if (!v) return;
      const room = Math.max(0, v.left - inCart(v));
      const n = Math.min(room, Math.max(1, Math.floor(Number(qty?.value) || 1)));
      if (n <= 0) return refresh();
      const lines = read();
      const line = lines.find((l) => l.product === product && l.variant === v.id);
      if (line) line.quantity = Math.min(MAX, line.quantity + n);
      else lines.push({ product, variant: v.id, quantity: n });
      write(lines);
      status.innerHTML = '';
      const what = [form.dataset.title, v.values.join(' / ')].filter(Boolean).join(', ');
      status.append(`Added ${n} × ${what} to your cart. `, el('a', { href: form.dataset.cartPath || '/cart/', textContent: 'View cart' }));
      refresh();
    });
    refresh();
    return { product, variants, refresh };
  });

  // What's left now (the page may be cached).
  if (states.length) {
    const ids = [...new Set(states.map((s) => s.product))];
    fetch(`/api/shop/availability?ids=${ids.join(',')}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((left) => {
        if (!left) return;
        for (const s of states) {
          const own = left[s.product];
          if (!own) continue;
          for (const v of s.variants) v.left = v.id in own ? (own[v.id] === null ? MAX : Math.min(MAX, own[v.id])) : 0;
          s.refresh();
        }
      })
      .catch(() => {});
  }

  // The cart.
  const carts = [...document.querySelectorAll('[data-cart]')];
  let quoting = 0;
  const renderCart = async () => {
    if (!carts.length) return;
    const lines = read();
    const ticket = ++quoting;
    let quote = null;
    if (lines.length) {
      try {
        const r = await fetch('/api/shop/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }), cache: 'no-store' });
        quote = r.ok ? await r.json() : null;
      } catch {}
      if (ticket !== quoting) return;
      if (!quote) {
        for (const c of carts) c.querySelector('.c-cart__body').textContent = 'Your cart couldn’t be loaded. Try again in a moment.';
        return;
      }
      // Keep what the server allows: lines no longer sold go, quantities fit what's left.
      const kept = quote.lines.filter((l) => l.problem !== 'gone' && l.quantity > 0).map((l) => ({ product: l.product, variant: l.variant, quantity: l.quantity }));
      if (JSON.stringify(kept) !== JSON.stringify(lines)) {
        try {
          localStorage.setItem(KEY, JSON.stringify(kept));
        } catch {}
        showCount();
      }
    }
    for (const c of carts) {
      const body = c.querySelector('.c-cart__body');
      body.innerHTML = '';
      const currency = quote?.currency || c.dataset.currency || 'USD';
      const shown = (quote?.lines ?? []).filter((l) => l.problem !== 'gone');
      const gone = (quote?.lines ?? []).filter((l) => l.problem === 'gone');
      if (gone.length) body.append(el('p', { className: 'c-cart__notice', textContent: `${gone.length === 1 ? 'An item' : `${gone.length} items`} in your cart ${gone.length === 1 ? 'is' : 'are'} no longer sold, and ${gone.length === 1 ? 'was' : 'were'} taken out.` }));
      if (!shown.length) {
        body.append(el('p', { className: 'c-cart__empty', textContent: c.dataset.empty || 'Your cart is empty.' }), el('p', {}, el('a', { className: 'c-shop-button', href: c.dataset.shop || '/', textContent: 'Keep shopping' })));
        continue;
      }
      const rows = shown.map((l) => {
        const input = el('input', { type: 'number', min: '0', max: String(l.max || 0), value: String(l.quantity), inputMode: 'numeric', className: 'c-cart__qty' });
        input.setAttribute('aria-label', `Quantity of ${l.title}${l.label ? `, ${l.label}` : ''}`);
        input.addEventListener('change', () => setQuantity(l, Math.floor(Number(input.value) || 0)));
        const remove = el('button', { type: 'button', className: 'c-cart__remove', textContent: 'Remove' });
        remove.addEventListener('click', () => setQuantity(l, 0));
        const note = l.problem === 'sold-out' ? 'Sold out' : l.problem === 'fewer' ? `Only ${l.max} left` : '';
        return el('tr', {}, [
          el('td', { className: 'c-cart__image' }, l.image ? el('img', { src: l.image, alt: '', width: 64, height: 64, loading: 'lazy' }) : null),
          el('td', { className: 'c-cart__item' }, [el('a', { href: l.url, textContent: l.title }), l.label ? el('small', { textContent: l.label }) : null, note ? el('small', { className: 'c-cart__problem', textContent: note }) : null]),
          el('td', { className: 'c-cart__unit', textContent: money(l.unit, currency) }),
          el('td', {}, l.problem === 'sold-out' ? null : input),
          el('td', { className: 'c-cart__total', textContent: l.total ? money(l.total, currency) : '' }),
          el('td', {}, remove),
        ]);
      });
      const head = el('thead', {}, el('tr', {}, ['', 'Item', 'Price', 'Quantity', 'Total', ''].map((t) => el('th', { scope: 'col', textContent: t }))));
      body.append(
        el('table', { className: 'c-cart__table' }, [head, el('tbody', {}, rows)]),
        el('p', { className: 'c-cart__subtotal' }, [el('span', { textContent: 'Subtotal' }), ' ', el('strong', { textContent: money(quote.subtotal, currency) })]),
        el('p', { className: 'c-cart__next', textContent: 'Shipping and tax are added at checkout. Checkout is coming soon.' }),
      );
    }
  };
  const setQuantity = (line, n) => {
    const lines = read()
      .map((l) => (l.product === line.product && l.variant === line.variant ? { ...l, quantity: Math.min(MAX, Math.max(0, n)) } : l))
      .filter((l) => l.quantity > 0);
    write(lines);
  };

  document.addEventListener('c-cart:change', () => {
    showCount();
    renderCart();
    states.forEach((s) => s.refresh());
  });
  // Another tab changed the cart.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    showCount();
    renderCart();
    states.forEach((s) => s.refresh());
  });
  showCount();
  renderCart();
})();
