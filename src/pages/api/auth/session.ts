// An invitation or password-reset link's session, from the address's fragment (the set-password page's
// script): stored as the sign-in cookie here, on the site's own server, so the browser doesn't need to
// reach Supabase Auth itself. Then the page's form sets the password (/api/auth/password).
import type { APIRoute } from 'astro';
import { serverClient } from '../../../lib/supabase';

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.json().catch(() => ({}));
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') return new Response('No session.', { status: 400 });
  const { error } = await serverClient(request, cookies).auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
  return error ? new Response(error.message, { status: 400 }) : new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
};
