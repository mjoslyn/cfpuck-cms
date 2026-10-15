// A member signs in (the Member account block): back to the page they came from, or the account page.
import type { APIRoute } from 'astro';
import { serverClient, siteDb } from '../../../lib/supabase';
import { accountUrl, loadMemberSettings, safeNext } from '../../../lib/members/account';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const next = safeNext(form.get('next'));
  if (!(await loadMemberSettings(siteDb())).enabled) return redirect(accountUrl(), 303);
  const { error } = await serverClient(request, cookies).auth.signInWithPassword({ email: String(form.get('email') ?? '').trim(), password: String(form.get('password') ?? '') });
  if (error) return redirect(accountUrl({ error: error.message === 'Invalid login credentials' ? 'That email and password don’t match an account.' : error.message, next }), 303);
  return redirect(next || accountUrl(), 303);
};
