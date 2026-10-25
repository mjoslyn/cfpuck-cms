import type { APIRoute } from 'astro';
import { authClient } from '../../../lib/supabase';
import { passwordSet } from '../../../lib/admin/invite';

/** Set the signed-in user's password (from /admin/set-password/, after an invitation or reset link). */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  const back = (msg: string) => redirect(`/admin/set-password/?error=${encodeURIComponent(msg)}`);
  if (password.length < 10) return back('Use at least 10 characters.');
  if (password !== String(form.get('confirm') ?? '')) return back('The two passwords don’t match.');
  const db = authClient(request, cookies);
  const { data: { user } } = await db.auth.getUser();
  if (!user) return back('That link has expired or was already used. Ask for a new one.');
  const { error } = await db.auth.updateUser({ password });
  if (error) return back(error.message);
  await passwordSet(user);
  return redirect('/admin/');
};
