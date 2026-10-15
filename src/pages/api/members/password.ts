// Set the signed-in member's password (the account page: after an invitation or reset link, or to change it).
import type { APIRoute } from 'astro';
import { serverClient } from '../../../lib/supabase';
import { accountUrl } from '../../../lib/members/account';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  const back = (error: string) => redirect(accountUrl({ error, view: 'password' }), 303);
  if (password.length < 10) return back('Use at least 10 characters.');
  if (password !== String(form.get('confirm') ?? '')) return back('The two passwords don’t match.');
  const db = serverClient(request, cookies);
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return redirect(accountUrl({ error: 'That link has expired or was already used. Ask for a new one.' }), 303);
  const { error } = await db.auth.updateUser({ password });
  return error ? back(error.message) : redirect(accountUrl({ m: 'password-saved' }), 303);
};
