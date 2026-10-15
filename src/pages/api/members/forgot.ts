// Email a member a link to set a new password (to the account page). The answer is the same whether or
// not the address has an account.
import type { APIRoute } from 'astro';
import { serverClient } from '../../../lib/supabase';
import { accountUrl } from '../../../lib/members/account';

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const email = String((await request.formData()).get('email') ?? '').trim();
  if (email) await serverClient(request, cookies).auth.resetPasswordForEmail(email, { redirectTo: `${url.origin}${accountUrl({ view: 'password' })}` });
  return redirect(accountUrl({ m: 'sent' }), 303);
};
