// Stripe's webhook (Developers > Webhooks, this address; events checkout.session.completed,
// checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
// checkout.session.expired and charge.refunded), signed with STRIPE_WEBHOOK_SECRET.
import type { APIRoute } from 'astro';
import { stripeEvent } from '../../../../lib/tickets/providers';
import { stripeWebhook } from '../../../../lib/tickets/orders';

export const POST: APIRoute = async ({ request }) => {
  const raw = await request.text();
  const event = stripeEvent(raw, request.headers.get('stripe-signature'));
  if (!event) return new Response('Bad signature', { status: 400 });
  try {
    await stripeWebhook(event);
  } catch (e) {
    // A failure answers 500, so Stripe tries again later.
    console.error(`stripe webhook ${event.type}: ${(e as Error).message}`);
    return new Response('Failed', { status: 500 });
  }
  return new Response('ok');
};
