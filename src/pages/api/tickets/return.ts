// The buyer back from the payment provider: GET /api/tickets/return?order=<token>[&cancel=1]. The
// payment is checked with the provider (the webhook may not have come yet), then the event page shows
// the order (?order=<token>).
import type { APIRoute } from 'astro';
import { returnFromCheckout } from '../../../lib/tickets/orders';

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('order') ?? '';
  const next = token.length >= 24 ? await returnFromCheckout(token, url.searchParams.has('cancel')) : null;
  if (!next) return new Response('Order not found', { status: 404 });
  return new Response(null, { status: 303, headers: { Location: new URL(next, url).toString(), 'Cache-Control': 'no-store' } });
};
