import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/supabase';

/**
 * Email a password-reset link to /admin/set-password/. The answer is the same whether or not the
 * address has an account. Sent with the service key, so the link carries its session in the address's
 * fragment (as an invitation's does) and works in any browser, not only the one that asked.
 */
export const POST: APIRoute = async ({ request, redirect, url }) => {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim();
  if (email) await serviceClient().auth.resetPasswordForEmail(email, { redirectTo: `${url.origin}/admin/set-password/` });
  return redirect('/admin/login/?sent=1');
};
