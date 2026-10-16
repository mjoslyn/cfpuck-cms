// Email a member a link to set a new password (to the account page). The answer is the same whether or
// not the address has an account. Sent with the service key, so the link carries its session in the
// address's fragment (as an invitation's does) and works in any browser, not only the one that asked.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/supabase';
import { accountUrl } from '../../../lib/members/account';

export const POST: APIRoute = async ({ request, redirect, url }) => {
  const email = String((await request.formData()).get('email') ?? '').trim();
  if (email) await serviceClient().auth.resetPasswordForEmail(email, { redirectTo: `${url.origin}${accountUrl({ view: 'password' })}` });
  return redirect(accountUrl({ m: 'sent' }), 303);
};
