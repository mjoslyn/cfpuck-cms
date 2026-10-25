// An invitation's link (src/lib/admin/invite.ts): makes a one-time password token for the invited account
// and goes on to the page where they set a password. A link that has expired, was replaced or was used
// goes there with an error.
import type { APIRoute } from 'astro';
import { passwordToken } from '../../../lib/auth';
import { openInvite, passwordPage } from '../../../lib/admin/invite';

export const GET: APIRoute = async ({ url, redirect }) => {
  const res = await openInvite(url.searchParams.get('t'));
  if ('error' in res) {
    const to = new URL(passwordPage(res.to), url);
    to.searchParams.set('error', res.error);
    return redirect(to.pathname + to.search, 303);
  }
  return new Response(null, { status: 303, headers: { Location: passwordPage(res.to, await passwordToken(res.user.id)), 'Cache-Control': 'no-store' } });
};
