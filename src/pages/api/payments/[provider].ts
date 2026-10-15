// The payment providers' webhooks, for forms and tickets alike: one endpoint per provider, so one
// signing secret each. Stripe: Developers > Webhooks, <site>/api/payments/stripe, events
// checkout.session.completed, .async_payment_succeeded, .async_payment_failed, .expired and
// charge.refunded; its signing secret is STRIPE_WEBHOOK_SECRET. Square: Developer Console > Webhooks,
// <site>/api/payments/square, events payment.created, payment.updated, refund.created and
// refund.updated; its signature key is SQUARE_WEBHOOK_SIGNATURE_KEY (and SQUARE_WEBHOOK_URL the address
// given to Square, when the site sees another). Each handler ignores checkouts that aren't its own.
import type { APIRoute } from 'astro';
import { providerOf, type PaymentProvider } from '../../../lib/payments';
import { env } from '../../../lib/payments/common';
import { formsWebhook } from '../../../lib/forms/checkout';
import { ticketsWebhook } from '../../../lib/tickets/orders';

const SECRET: Record<PaymentProvider, string> = { stripe: 'STRIPE_WEBHOOK_SECRET', square: 'SQUARE_WEBHOOK_SIGNATURE_KEY' };

export const POST: APIRoute = async ({ params, request, url }) => {
  const name = params.provider as PaymentProvider;
  const provider = providerOf(name);
  if (!provider) return new Response('Not found', { status: 404 });
  const secret = SECRET[name];
  if (!env(secret)) return new Response(`${provider.label} webhooks are not set up (${secret}).`, { status: 503 });
  const body = await request.text();
  const event = await provider.webhookEvent(body, request.headers, `${url.origin}${url.pathname}`);
  if (!event) return new Response('Bad signature', { status: 400 });
  try {
    await formsWebhook(name, event);
    await ticketsWebhook(name, event);
  } catch (e) {
    // A failure answers 500, so the provider tries again later.
    console.error(`${name} webhook ${event?.type}: ${(e as Error).message}`);
    return new Response('Failed', { status: 500 });
  }
  return Response.json({ ok: true });
};
