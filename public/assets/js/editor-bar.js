// Editor bar: for signed-in editors and admins, a bar above the page with links to the dashboard and to
// edit what the page shows (body data-edit-entry / data-edit-template, set by the renderer). Pages are
// cached and shared, so this runs in the browser: only visitors with a sign-in cookie ask who they are.
(() => {
  // site.signed_in: set beside the session's own cookie, which scripts can't read (src/lib/auth).
  if (!document.cookie.split('; ').some((c) => c.startsWith('site.signed_in='))) return;
  const body = document.body;
  const entry = body.dataset.editEntry;
  const template = body.dataset.editTemplate;

  fetch('/api/admin/me', { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (!me) return;
      const link = (href, text, primary) => `<a href="${href}"${primary ? ' class="is-primary"' : ''}>${text}</a>`;
      const links = [link('/admin/', 'Dashboard')];
      if (entry) links.push(link(`/admin/edit/${encodeURIComponent(entry)}/`, 'Edit page', true));
      if (template && me.role === 'admin') links.push(link(`/admin/templates/template/${encodeURIComponent(template)}/`, 'Edit template', !entry));
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

      const style = document.createElement('style');
      style.textContent = `
        .c-editor-bar { position: relative; z-index: 1000; display: flex; align-items: center; gap: 4px; min-height: 40px; padding: 0 12px;
          background: #0f0f1c; color: #fff; font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .c-editor-bar a, .c-editor-bar button { display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border: 0; border-radius: 4px;
          background: none; color: #fff; font: inherit; text-decoration: none; cursor: pointer; }
        .c-editor-bar a:hover, .c-editor-bar button:hover { background: rgba(255,255,255,.12); }
        .c-editor-bar a.is-primary { background: #c87d37; color: #0f0f1c; font-weight: 600; }
        .c-editor-bar a.is-primary:hover { background: #e0a66b; }
        .c-editor-bar a:focus-visible, .c-editor-bar button:focus-visible { outline: 2px solid #e0a66b; outline-offset: 2px; }
        .c-editor-bar__who { margin-left: auto; color: #b8c0cc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .c-editor-bar form { margin: 0; }
        @media (max-width: 599px) { .c-editor-bar__who { display: none; } .c-editor-bar form { margin-left: auto; } }`;
      document.head.appendChild(style);

      const bar = document.createElement('nav');
      bar.className = 'c-editor-bar';
      bar.setAttribute('aria-label', 'Editor');
      bar.innerHTML =
        links.join('') +
        `<span class="c-editor-bar__who">Signed in as ${esc(me.name)}</span>` +
        '<form method="post" action="/api/auth/logout"><button type="submit">Sign out</button></form>';
      // After the skip link, which stays the first thing to tab to.
      const skip = body.querySelector(':scope > .c-skip-link');
      if (skip) skip.after(bar);
      else body.prepend(bar);
    })
    .catch(() => {});
})();
