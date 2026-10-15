// Stripe Checkout (https://docs.stripe.com/api/checkout/sessions): a session per submission, paid on
// Stripe's page. Env: STRIPE_SECRET_KEY (sk_test_... or sk_live_..., or a restricted key with
// Checkout Sessions write), STRIPE_WEBHOOK_SECRET (whsec_..., for /api/payments/stripe).
import { env, hmac, sameString, type CheckoutRequest, type CheckoutState, type Provider } from './common';

const API = 'https://api.stripe.com/v1';

async function call(method: 'GET' | 'POST', path: string, body?: URLSearchParams, idempotencyKey?: string) {
  const key = env('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Stripe is not set up (STRIPE_SECRET_KEY).');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data?.error?.message ?? res.statusText}`);
  return data;
}

async function create(req: CheckoutRequest) {
  const p = new URLSearchParams({
    mode: 'payment',
    success_url: req.returnUrl,
    cancel_url: req.returnUrl,
    client_reference_id: req.reference,
    'metadata[submission]': req.reference,
    'payment_intent_data[metadata][submission]': req.reference,
  });
  if (req.description) p.set('payment_intent_data[description]', req.description.slice(0, 1000));
  if (req.email) p.set('customer_email', req.email);
  req.items.forEach((it, i) => {
    p.set(`line_items[${i}][quantity]`, String(it.quantity));
    p.set(`line_items[${i}][price_data][currency]`, req.currency.toLowerCase());
    p.set(`line_items[${i}][price_data][unit_amount]`, String(it.unit));
    p.set(`line_items[${i}][price_data][product_data][name]`, it.name.slice(0, 250));
  });
  const s = await call('POST', '/checkout/sessions', p, req.idempotencyKey);
  return { ref: String(s.id), url: String(s.url) };
}

/** complete + paid is paid; complete + unpaid is a bank payment on its way; expired is cancelled. */
async function check(ref: string): Promise<CheckoutState> {
  const s = await call('GET', `/checkout/sessions/${encodeURIComponent(ref)}`);
  const paymentId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
  if (s.status === 'complete') return { status: s.payment_status === 'paid' ? 'paid' : 'processing', paymentId, amount: s.amount_total };
  return { status: s.status === 'expired' ? 'cancelled' : 'pending' };
}

export const provider: Provider = {
  label: 'Stripe',
  configured: () => !!env('STRIPE_SECRET_KEY'),
  sandbox: () => /^(sk|rk)_test_/.test(env('STRIPE_SECRET_KEY') ?? ''),
  create,
  check,
};

/**
 * A webhook's Stripe-Signature header ("t=<time>,v1=<hex>"): HMAC-SHA256 of "<time>.<body>" with the
 * endpoint's secret, at most five minutes old (https://docs.stripe.com/webhooks#verify-manually).
 */
export async function verifyStripeSignature(body: string, header: string, secret: string, now = Date.now()): Promise<boolean> {
  const parts = header.split(',').map((x) => x.trim().split('=', 2) as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const expected = await hmac(secret, `${t}.${body}`, 'hex');
  return sigs.some((s) => sameString(s, expected));
}
