import type { APIRoute } from 'astro';
import { redirectWith, signIn } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const next = String(form.get('next') || '/admin/');
  const res = await signIn(String(form.get('email') ?? ''), String(form.get('password') ?? ''), request);
  if (!res.ok) return redirect(`/admin/login/?error=${encodeURIComponent(res.error)}&next=${encodeURIComponent(next)}`);
  return redirectWith(next.startsWith('/admin') ? next : '/admin/', res.cookies, 302);
};
