// Set a member's password (the account page): from an invitation or password link's token, which signs
// them in, or the signed-in member changing it.
import type { APIRoute } from 'astro';
import { redirectWith, sessionUser, setPassword, setPasswordWithToken } from '../../../lib/auth';
import { accountUrl } from '../../../lib/members/account';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const token = String(form.get('token') ?? '');
  const password = String(form.get('password') ?? '');
  const back = (error: string) => redirect(accountUrl({ error, view: 'password', ...(token ? { token } : {}) }), 303);
  if (password.length < 10) return back('Use at least 10 characters.');
  if (password !== String(form.get('confirm') ?? '')) return back('The two passwords don’t match.');
  if (token) {
    const res = await setPasswordWithToken(token, password, request);
    return res.ok ? redirectWith(accountUrl({ m: 'password-saved' }), res.cookies) : back(res.error);
  }
  const user = await sessionUser(request);
  if (!user) return redirect(accountUrl({ error: 'That link has expired or was already used. Ask for a new one.' }), 303);
  await setPassword(user.id, password);
  return redirect(accountUrl({ m: 'password-saved' }), 303);
};
