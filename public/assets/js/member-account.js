// Member account (src/render/c/members.ts): an invitation link brings the new member's session in the
// address's fragment, which the server never sees; hand it to /api/members/session, which signs them in,
// then show the form to set a password. Messages take focus, so screen readers announce them.
(() => {
  const hash = new URLSearchParams(location.hash.slice(1));
  const access = hash.get('access_token');
  const refresh = hash.get('refresh_token');
  if (access && refresh) {
    history.replaceState(null, '', location.pathname + location.search);
    fetch('/api/members/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: access, refresh_token: refresh }) })
      .then((r) => location.replace(r.ok ? '/account/?view=password' : `/account/?error=${encodeURIComponent('That link has expired or was already used. Ask for a new one.')}`));
    return;
  }
  if (hash.get('error_description')) location.replace(`/account/?error=${encodeURIComponent(hash.get('error_description'))}`);
  document.querySelector('.c-account [data-focus]')?.focus();
})();
