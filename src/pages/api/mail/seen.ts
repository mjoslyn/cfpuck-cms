// A tracked link's visitor interacted with the page it led to (public/assets/js/mail-seen.js): that
// click was a person's. The body is the click's signed id.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/supabase';
import { confirmSeen } from '../../../lib/mailing/tracking';

export const POST: APIRoute = async ({ request }) => {
  const token = (await request.text()).trim().slice(0, 100);
  await confirmSeen(serviceClient(), token).catch((e) => console.error(`mailing: seen failed: ${e.message}`));
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
};
