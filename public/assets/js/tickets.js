// Ticket forms (src/render/c/tickets.ts): the running total, the address asked only when the order
// costs something, the submit button's wording, and what's left now (the page can be a minute old:
// /api/tickets/availability). A buyer waiting on a payment's confirmation sees the page update itself.
// Without this script the form still works; the server checks everything.
(() => {
  const money = (cents, currency) => (cents ? new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100) : 'Free');

  for (const form of document.querySelectorAll('form[data-tickets]')) {
    const selects = [...form.querySelectorAll('select[name^="q["]')];
    const total = form.querySelector('[data-tickets-total]');
    const button = form.querySelector('button[type="submit"]');
    const address = form.querySelector('[data-tickets-paid-only]');
    const currency = form.dataset.currency || 'usd';
    const max = Number(form.dataset.max) || 10;

    const update = () => {
      const count = selects.reduce((n, s) => n + Number(s.value), 0);
      const cents = selects.reduce((n, s) => n + Number(s.value) * Number(s.dataset.price), 0);
      if (total) {
        total.hidden = count === 0;
        total.textContent = `${count} ticket${count === 1 ? '' : 's'}: ${money(cents, currency)}`;
      }
      if (button) button.textContent = cents > 0 ? button.dataset.labelPaid : button.dataset.labelFree;
      if (address) {
        address.hidden = cents === 0;
        for (const input of address.querySelectorAll('[data-required]')) input.required = cents > 0;
      }
    };
    for (const s of selects) s.addEventListener('change', update);
    update();

    form.addEventListener('submit', (e) => {
      const count = selects.reduce((n, s) => n + Number(s.value), 0);
      if (count === 0 || count > max) {
        e.preventDefault();
        if (total) {
          total.hidden = false;
          total.textContent = count === 0 ? 'Choose at least one ticket.' : `At most ${max} tickets in one order.`;
          total.setAttribute('role', 'alert');
        }
        selects[0]?.focus();
        return;
      }
      // One order per click.
      if (form.dataset.sent) e.preventDefault();
      form.dataset.sent = '1';
      setTimeout(() => delete form.dataset.sent, 8000);
    });

    // What's left now: fewer choices where there are fewer tickets, and "Sold out" where none.
    const params = new URLSearchParams({ event: form.dataset.event });
    if (form.dataset.date) params.set('date', form.dataset.date);
    fetch(`/api/tickets/availability?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        for (const s of selects) {
          const type = s.name.slice(2, -1);
          const left = data.types[type];
          if (left == null) continue;
          if (left === 0) {
            const note = document.createElement('span');
            note.className = 'c-tickets__state';
            note.textContent = 'Sold out';
            s.previousElementSibling?.remove();
            s.replaceWith(note);
            selects.splice(selects.indexOf(s), 1);
            continue;
          }
          for (const o of [...s.options]) if (Number(o.value) > left) o.remove();
        }
        update();
      })
      .catch(() => {});
  }

  // Waiting on a payment's confirmation (the provider's webhook): look again in a few seconds, a few times.
  const pending = document.querySelector('[data-tickets-pending]');
  try {
    if (pending) {
      const tries = Number(sessionStorage.getItem('tickets-pending') || 0);
      if (tries < 6) {
        sessionStorage.setItem('tickets-pending', String(tries + 1));
        setTimeout(() => location.reload(), 4000);
      }
    } else sessionStorage.removeItem('tickets-pending');
  } catch {
    // Storage blocked: no automatic refresh.
  }

  // Messages and confirmations take focus, so screen readers announce them.
  const focus = document.querySelector('.c-tickets [data-focus]');
  if (focus && location.hash === '#tickets') focus.focus();
})();
