// Filters blocks (form.c-filters, src/render/c/filters.ts): chosen terms as removable chips, added from
// a dropdown (nested terms indented) or from the search suggestions (search.js fires "c-search:term");
// any change reloads the page's listing in place (fetching the page with the new query string and
// swapping in the listing, the count and Clear), keeping the address in step. Fires "c-filters:change"
// ({ taxonomy, ids }) on the document, which a Map block follows, and "c-filters:updated" after the
// listing is swapped. Without this script the form still filters by submitting.
(() => {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function enhance(form) {
    if (form.dataset.ready) return;
    form.dataset.ready = '1';
    const termBox = form.querySelector('.c-filters__terms');
    const select = form.querySelector('.c-filters__select');
    const termParam = form.dataset.termParam;
    const hidden = termParam ? form.querySelector(`input[type="hidden"][name="${termParam}"]`) : null;
    const tagsWrap = form.querySelector('.c-filters__tags');
    const input = form.querySelector('.c-filters__input');
    const terms = termBox ? JSON.parse(termBox.dataset.terms || '[]') : [];
    let active = termBox ? JSON.parse(termBox.dataset.active || '[]') : [];
    const taxonomy = form.dataset.taxonomy || '';
    const listing = () => document.querySelector(form.dataset.target ? `[data-collection="${form.dataset.target}"]` : '.c-collection');

    const children = (parent) => terms.filter((t) => t.parent === parent);
    const ordered = (parent, depth, out) => {
      for (const t of children(parent)) {
        out.push({ ...t, depth });
        ordered(t.id, depth + 1, out);
      }
      return out;
    };

    function rebuildSelect() {
      if (!select) return;
      const options = ordered(0, 0, []).filter((t) => !active.includes(t.id));
      select.innerHTML =
        `<option value="">${esc(active.length ? termBox.dataset.more : termBox.dataset.first)}</option>` +
        options.map((t) => `<option value="${t.id}">${'  '.repeat(t.depth)}${esc(t.name)}</option>`).join('');
    }

    function renderTags() {
      if (!tagsWrap) return;
      tagsWrap.innerHTML = active
        .map((id) => terms.find((t) => t.id === id))
        .filter(Boolean)
        .map((t) => `<span class="c-filters__tag">${esc(t.name)}<button type="button" class="c-filters__tag-remove" data-remove="${t.id}" aria-label="Remove ${esc(t.name)}">&times;</button></span>`)
        .join('');
    }

    function query() {
      const params = new URLSearchParams();
      if (input && input.value.trim()) params.set(input.name, input.value.trim());
      if (termParam && active.length) params.set(termParam, active.join(','));
      return params.toString();
    }

    async function apply() {
      const qs = query();
      const url = (form.getAttribute('action') || location.pathname) + (qs ? `?${qs}` : '');
      history.replaceState(null, '', url);
      const grid = listing();
      grid?.classList.add('is-loading');
      try {
        const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        // Not found or failed: the page itself shows what happened.
        if (!res.ok) throw new Error(String(res.status));
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const fresh = doc.querySelector(form.dataset.target ? `[data-collection="${form.dataset.target}"]` : '.c-collection');
        if (grid && fresh) grid.innerHTML = fresh.innerHTML;
        const freshForm = doc.querySelector('form.c-filters');
        const count = form.querySelector('.c-filters__count');
        const freshCount = freshForm?.querySelector('.c-filters__count');
        if (count && freshCount) count.textContent = freshCount.textContent;
        const clear = form.querySelector('.c-filters__clear');
        const freshClear = freshForm?.querySelector('.c-filters__clear');
        if (freshClear && !clear) form.querySelector('.c-filters__row').insertAdjacentHTML('beforeend', freshClear.outerHTML);
        else if (!freshClear && clear) clear.remove();
        document.dispatchEvent(new CustomEvent('c-filters:updated', { detail: { form } }));
      } catch {
        location.href = url;
        return;
      } finally {
        grid?.classList.remove('is-loading');
      }
    }

    function changed() {
      if (hidden) hidden.value = active.join(',');
      form.dataset.activeTerms = active.join(',');
      rebuildSelect();
      renderTags();
      apply();
      document.dispatchEvent(new CustomEvent('c-filters:change', { detail: { taxonomy, ids: active.slice() } }));
    }

    select?.addEventListener('change', () => {
      const id = parseInt(select.value, 10);
      if (id && !active.includes(id)) active.push(id);
      changed();
    });
    tagsWrap?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      active = active.filter((id) => id !== Number(btn.dataset.remove));
      changed();
    });
    // A term picked from the search suggestions becomes a filter instead of opening its page.
    form.addEventListener('c-search:term', (e) => {
      if (!termBox || !e.detail) return;
      e.preventDefault();
      // The words typed were for finding the term, not a search.
      if (input) input.value = '';
      if (!active.includes(e.detail.id)) active.push(e.detail.id);
      changed();
      input?.focus();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      apply();
    });
    form.addEventListener('click', (e) => {
      if (!e.target.closest('.c-filters__clear')) return;
      e.preventDefault();
      if (input) input.value = '';
      active = [];
      changed();
    });

    rebuildSelect();
    renderTags();
    // Tell a map on the page what is chosen to begin with.
    if (active.length) document.dispatchEvent(new CustomEvent('c-filters:change', { detail: { taxonomy, ids: active.slice() } }));
  }

  const init = () => document.querySelectorAll('form.c-filters').forEach(enhance);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
