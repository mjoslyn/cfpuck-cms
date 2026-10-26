// Member link (src/render/c/members.ts): "Sign in" for everyone, switched to its signed-in label for
// visitors with an account. Pages with it are cached and shared, so this runs in the browser, and only
// visitors with a sign-in cookie ask who they are.
(() => {
  // site.signed_in: set beside the session's own cookie, which scripts can't read (src/lib/auth).
  if (!document.cookie.split('; ').some((c) => c.startsWith('site.signed_in='))) return;
  fetch('/api/members/me', { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (!me?.signedIn) return;
      for (const a of document.querySelectorAll('a[data-member-link]')) {
        a.textContent = a.dataset.signedIn || 'My account';
        a.classList.add('is-signed-in');
      }
    })
    .catch(() => {});
})();
