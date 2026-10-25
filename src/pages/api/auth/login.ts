import type { APIRoute } from 'astro';
import { authClient } from '../../../lib/supabase';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const next = String(form.get('next') || '/admin/');
  const db = authClient(request, cookies);
  const { error } = await db.auth.signInWithPassword({ email: String(form.get('email') ?? ''), password: String(form.get('password') ?? '') });
  if (error) return redirect(`/admin/login/?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`);
  return redirect(next.startsWith('/admin') ? next : '/admin/');
};
