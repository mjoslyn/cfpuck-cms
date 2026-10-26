// Set a member's password (the account page): from an invitation or password link's token, which signs
// them in, or the signed-in member changing it (with their current password; their other sessions end).
import type { APIRoute } from 'astro';
import { changePassword, redirectWith, setPasswordWithToken } from '../../../lib/auth';
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
  const res = await changePassword(request, String(form.get('current') ?? ''), password);
  return res.ok ? redirect(accountUrl({ m: 'password-saved' }), 303) : back(res.error);
};
