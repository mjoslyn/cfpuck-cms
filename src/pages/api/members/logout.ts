import type { APIRoute } from 'astro';
import { serverClient } from '../../../lib/supabase';
import { accountUrl } from '../../../lib/members/account';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  await serverClient(request, cookies).auth.signOut();
  return redirect(accountUrl({ m: 'signed-out' }), 303);
};
