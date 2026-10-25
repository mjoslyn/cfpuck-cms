import type { APIRoute } from 'astro';
import { redirectWith, setPasswordWithToken } from '../../../lib/auth';

/** Set a password from /admin/set-password/ (an invitation or a password link's token), then sign in. */
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const token = String(form.get('token') ?? '');
  const password = String(form.get('password') ?? '');
  const back = (msg: string) => redirect(`/admin/set-password/?${new URLSearchParams({ ...(token ? { token } : {}), error: msg })}`);
  if (password.length < 10) return back('Use at least 10 characters.');
  if (password !== String(form.get('confirm') ?? '')) return back('The two passwords don’t match.');
  const res = await setPasswordWithToken(token, password, request);
  if (!res.ok) return back(res.error);
  return redirectWith('/admin/', res.cookies, 302);
};
