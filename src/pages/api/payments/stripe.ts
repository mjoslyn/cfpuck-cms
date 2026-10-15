// Stripe's webhook for form payments (src/lib/forms/checkout.ts). In the Stripe dashboard, an endpoint
// at <site>/api/payments/stripe for checkout.session.completed, checkout.session.async_payment_succeeded,
// checkout.session.async_payment_failed and checkout.session.expired; its signing secret is
// STRIPE_WEBHOOK_SECRET. An event only says which checkout to look at: its state is asked of Stripe.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/supabase';
import { confirmPayment, markPaymentFailed, submissionByRef } from '../../../lib/forms/checkout';
import { verifyStripeSignature } from '../../../lib/payments/stripe';
import { env } from '../../../lib/payments/common';

export const POST: APIRoute = async ({ request }) => {
  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (!secret) return new Response('Stripe webhooks are not set up (STRIPE_WEBHOOK_SECRET).', { status: 503 });
  const body = await request.text();
  if (!(await verifyStripeSignature(body, request.headers.get('stripe-signature') ?? '', secret))) return new Response('Bad signature', { status: 400 });
  const event = JSON.parse(body);
  const session = event?.data?.object;
  if (!String(event?.type ?? '').startsWith('checkout.session.') || session?.object !== 'checkout.session') return Response.json({ ignored: true });
  const db = serviceClient();
  const sub = await submissionByRef(db, String(session.id));
  // Another site's (or a deleted) submission: nothing to do, and no retries wanted.
  if (!sub) return Response.json({ ignored: true });
  if (event.type === 'checkout.session.async_payment_failed') await markPaymentFailed(db, sub);
  else await confirmPayment(db, sub);
  return Response.json({ ok: true });
};
