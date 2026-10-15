// An invitation link's session, from the address's fragment (public/assets/js/member-account.js):
// stored as the sign-in cookie, so the member can set their password.
import type { APIRoute } from 'astro';
import { serverClient } from '../../../lib/supabase';

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.json().catch(() => ({}));
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') return new Response('No session.', { status: 400 });
  const { error } = await serverClient(request, cookies).auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
  return error ? new Response(error.message, { status: 400 }) : new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
};
