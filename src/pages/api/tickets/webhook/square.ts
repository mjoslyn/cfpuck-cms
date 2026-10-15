// Square's webhook (Developer Console > Webhooks > Subscriptions, this address; events
// payment.created, payment.updated, refund.created and refund.updated), signed with
// SQUARE_WEBHOOK_SIGNATURE_KEY over the subscription's URL (SQUARE_WEBHOOK_URL when the site sees
// another address than the one Square was given) and the body.
import type { APIRoute } from 'astro';
import { squareEvent } from '../../../../lib/tickets/providers';
import { squareWebhook } from '../../../../lib/tickets/orders';

export const POST: APIRoute = async ({ request, url }) => {
  const raw = await request.text();
  const event = squareEvent(raw, request.headers.get('x-square-hmacsha256-signature'), `${url.origin}${url.pathname}`);
  if (!event) return new Response('Bad signature', { status: 400 });
  try {
    await squareWebhook(event);
  } catch (e) {
    console.error(`square webhook ${event.type}: ${(e as Error).message}`);
    return new Response('Failed', { status: 500 });
  }
  return new Response('ok');
};
