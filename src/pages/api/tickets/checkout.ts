// A ticket form posted from an event page (src/render/c/tickets.ts): a free order is confirmed at
// once, a paid one goes to the payment provider's checkout (src/lib/tickets/orders.ts startCheckout).
import type { APIRoute } from 'astro';
import { startCheckout } from '../../../lib/tickets/orders';

const FORM = /multipart\/form-data|application\/x-www-form-urlencoded/i;

export const POST: APIRoute = async ({ request, url }) => {
  if (!FORM.test(request.headers.get('content-type') ?? '')) return new Response('Not found', { status: 404 });
  const next = await startCheckout(await request.formData(), url.origin);
  if (!next) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 303, headers: { Location: new URL(next, url).toString(), 'Cache-Control': 'no-store' } });
};
