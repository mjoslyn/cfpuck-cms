import type { APIRoute } from 'astro';
import { authClient } from '../../../lib/supabase';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  await authClient(request, cookies).auth.signOut();
  return redirect('/admin/login/');
};
