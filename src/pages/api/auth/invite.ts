// An invitation's link (src/lib/admin/invite.ts): signs the invited account in with a fresh password-reset
// token, made and used here, and goes on to the page where they set a password. A link that has expired,
// was replaced or was used goes there with an error.
import type { APIRoute } from 'astro';
import { serverClient, serviceClient } from '../../../lib/supabase';
import { invitePath, openInvite } from '../../../lib/admin/invite';

export const GET: APIRoute = async ({ request, cookies, url, redirect }) => {
  const res = await openInvite(url.searchParams.get('t'));
  const fail = (msg: string) => {
    const to = new URL(invitePath(res.to), url);
    to.searchParams.set('error', msg);
    return redirect(to.pathname + to.search, 303);
  };
  if ('error' in res) return fail(res.error);
  const { data, error } = await serviceClient().auth.admin.generateLink({ type: 'recovery', email: res.user.email! });
  if (error) return fail(error.message);
  const { error: e2 } = await serverClient(request, cookies).auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'recovery' });
  if (e2) return fail(e2.message);
  return new Response(null, { status: 303, headers: { Location: invitePath(res.to), 'Cache-Control': 'no-store' } });
};
