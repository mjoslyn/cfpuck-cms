// Payment providers for tickets: Stripe (Checkout Sessions) and Square (payment links), over their
// REST APIs. The buyer pays on the provider's own page and comes back to /api/tickets/return; the
// provider's webhook confirms the payment too, whichever arrives first (marking an order paid is
// idempotent, src/lib/tickets/orders.ts). Keys come from the environment:
//   Stripe: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//   Square: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_WEBHOOK_SIGNATURE_KEY,
//           SQUARE_ENVIRONMENT (sandbox | production, default production), SQUARE_WEBHOOK_URL (optional)
import { createHmac, timingSafeEqual } from 'node:crypto';

const env = (k: string) => (import.meta.env?.[k] as string | undefined) ?? process.env[k];

export type ProviderName = 'stripe' | 'square';

export interface CheckoutLine {
  name: string;
  /** Smallest currency unit. */
  price: number;
  quantity: number;
}

export interface CheckoutRequest {
  token: string;
  code: string;
  email: string;
  currency: string;
  lines: CheckoutLine[];
  /** Where the buyer comes back to (paid) and, for Stripe, where Cancel goes. */
  returnUrl: string;
  cancelUrl: string;
  /** When the checkout stops taking payment. */
  expiresAt: Date;
}

export interface Checkout {
  url: string;
  /** Stripe session id / Square payment link id. */
  ref: string;
  /** Square order id. */
  order?: string;
}

export interface PaymentState {
  paid: boolean;
  /** Stripe payment intent / Square payment id. */
  payment?: string;
  /** Amount refunded so far. */
  refunded?: number;
}

/** Whether a provider's keys are set. */
export function providerReady(name: ProviderName | undefined): boolean {
  if (name === 'stripe') return !!env('STRIPE_SECRET_KEY');
  if (name === 'square') return !!(env('SQUARE_ACCESS_TOKEN') && env('SQUARE_LOCATION_ID'));
  return false;
}

class ProviderError extends Error {}

// ---- Stripe ----------------------------------------------------------------------------------

async function stripe(path: string, params?: Record<string, string>, opts: { method?: string; idempotency?: string } = {}): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: opts.method ?? (params ? 'POST' : 'GET'),
    headers: {
      Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(opts.idempotency ? { 'Idempotency-Key': opts.idempotency } : {}),
    },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProviderError(`Stripe ${path}: ${body?.error?.message ?? res.status}`);
  return body;
}

const stripeProvider = {
  async create(r: CheckoutRequest): Promise<Checkout> {
    const p: Record<string, string> = {
      mode: 'payment',
      success_url: `${r.returnUrl}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: r.cancelUrl,
      customer_email: r.email,
      client_reference_id: r.code,
      'metadata[order_code]': r.code,
      'payment_intent_data[metadata][order_code]': r.code,
      // Stripe takes 30 minutes to 24 hours.
      expires_at: String(Math.floor(Math.max(r.expiresAt.getTime(), Date.now() + 30 * 60_000 + 5_000) / 1000)),
    };
    r.lines.forEach((l, i) => {
      p[`line_items[${i}][quantity]`] = String(l.quantity);
      p[`line_items[${i}][price_data][currency]`] = r.currency;
      p[`line_items[${i}][price_data][unit_amount]`] = String(l.price);
      p[`line_items[${i}][price_data][product_data][name]`] = l.name.slice(0, 250);
    });
    const s = await stripe('checkout/sessions', p, { idempotency: `checkout-${r.token}` });
    return { url: s.url, ref: s.id };
  },
  async state(ref: string): Promise<PaymentState> {
    const s = await stripe(`checkout/sessions/${encodeURIComponent(ref)}?expand[]=payment_intent.latest_charge`);
    const charge = s.payment_intent?.latest_charge;
    return { paid: s.payment_status === 'paid', payment: s.payment_intent?.id ?? s.payment_intent ?? undefined, refunded: charge?.amount_refunded ?? 0 };
  },
  async cancel(ref: string) {
    const s = await stripe(`checkout/sessions/${encodeURIComponent(ref)}`);
    if (s.status === 'open') await stripe(`checkout/sessions/${encodeURIComponent(ref)}/expire`, {});
  },
  async refund(payment: string, amount: number, key: string) {
    await stripe('refunds', { payment_intent: payment, amount: String(amount) }, { idempotency: `refund-${key}` });
  },
};

/** A Stripe webhook's event, if its Stripe-Signature header is valid (signed within five minutes). */
export function stripeEvent(raw: string, header: string | null): any | null {
  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (!secret || !header) return null;
  const parts = header.split(',').map((p) => p.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return null;
  const expected = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  if (!sigs.some((s) => safeEqual(s, expected))) return null;
  return JSON.parse(raw);
}

// ---- Square ----------------------------------------------------------------------------------

const SQUARE_VERSION = '2025-09-24';
const squareBase = () => (env('SQUARE_ENVIRONMENT') === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com');

async function square(path: string, body?: unknown, method?: string): Promise<any> {
  const res = await fetch(`${squareBase()}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${env('SQUARE_ACCESS_TOKEN')}`, 'Square-Version': SQUARE_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProviderError(`Square ${path}: ${out?.errors?.[0]?.detail ?? res.status}`);
  return out;
}

const squareProvider = {
  async create(r: CheckoutRequest): Promise<Checkout> {
    const currency = r.currency.toUpperCase();
    const { payment_link } = await square('/v2/online-checkout/payment-links', {
      idempotency_key: `checkout-${r.token}`.slice(0, 45),
      order: {
        location_id: env('SQUARE_LOCATION_ID'),
        reference_id: r.code,
        line_items: r.lines.map((l) => ({ name: l.name.slice(0, 500), quantity: String(l.quantity), base_price_money: { amount: l.price, currency } })),
      },
      checkout_options: { redirect_url: r.returnUrl, ask_for_shipping_address: false },
      pre_populated_data: { buyer_email: r.email },
    });
    return { url: payment_link.url, ref: payment_link.id, order: payment_link.order_id };
  },
  /** Paid when a payment on the order has completed (Square leaves the order itself open). */
  async state(order: string): Promise<PaymentState> {
    const { order: o } = await square(`/v2/orders/${encodeURIComponent(order)}`);
    for (const tender of o?.tenders ?? []) {
      const id = tender.payment_id ?? tender.id;
      const { payment } = await square(`/v2/payments/${encodeURIComponent(id)}`);
      if (payment?.status === 'COMPLETED') return { paid: true, payment: payment.id, refunded: payment.refunded_money?.amount ?? 0 };
    }
    return { paid: false };
  },
  async cancel(ref: string) {
    await square(`/v2/online-checkout/payment-links/${encodeURIComponent(ref)}`, undefined, 'DELETE');
  },
  async refund(payment: string, amount: number, key: string, currency: string) {
    await square('/v2/refunds', { idempotency_key: `refund-${key}`.slice(0, 45), payment_id: payment, amount_money: { amount, currency: currency.toUpperCase() }, reason: 'Ticket order cancelled' });
  },
  async payment(id: string): Promise<{ status: string; order?: string; refunded: number }> {
    const { payment } = await square(`/v2/payments/${encodeURIComponent(id)}`);
    return { status: payment?.status ?? '', order: payment?.order_id, refunded: payment?.refunded_money?.amount ?? 0 };
  },
};

/** A Square webhook's event, if its signature is valid: HMAC-SHA256 of the notification URL and the body. */
export function squareEvent(raw: string, header: string | null, url: string): any | null {
  const key = env('SQUARE_WEBHOOK_SIGNATURE_KEY');
  if (!key || !header) return null;
  const expected = createHmac('sha256', key).update(`${env('SQUARE_WEBHOOK_URL') || url}${raw}`).digest('base64');
  return safeEqual(header, expected) ? JSON.parse(raw) : null;
}

export const squarePayment = (id: string) => squareProvider.payment(id);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---- Either ----------------------------------------------------------------------------------

export async function createCheckout(name: ProviderName, r: CheckoutRequest): Promise<Checkout> {
  return name === 'stripe' ? stripeProvider.create(r) : squareProvider.create(r);
}

/** Where an order's payment stands at the provider. */
export async function paymentState(o: { provider: string; provider_ref: string | null; provider_order: string | null }): Promise<PaymentState> {
  if (o.provider === 'stripe' && o.provider_ref) return stripeProvider.state(o.provider_ref);
  if (o.provider === 'square' && o.provider_order) return squareProvider.state(o.provider_order);
  return { paid: false };
}

/** Stop an unpaid checkout taking payment (best effort: it may already be closed). */
export async function cancelCheckout(o: { provider: string; provider_ref: string | null }) {
  if (!o.provider_ref) return;
  try {
    if (o.provider === 'stripe') await stripeProvider.cancel(o.provider_ref);
    else if (o.provider === 'square') await squareProvider.cancel(o.provider_ref);
  } catch (e) {
    console.warn(`tickets: closing checkout ${o.provider_ref}: ${(e as Error).message}`);
  }
}

/** Give back `amount` of a paid order (at most what's left of it); `key` makes a retried refund count once. */
export async function refundPayment(o: { provider: string; provider_payment: string | null; amount: number; refunded_amount: number; currency: string }, amount: number, key: string) {
  const left = o.amount - (o.refunded_amount ?? 0);
  if (amount <= 0 || amount > left) throw new ProviderError(`Refund between 0.01 and what is left of the order.`);
  if (!o.provider_payment) throw new ProviderError('This order has no payment recorded at the provider; refund it from its dashboard.');
  if (o.provider === 'stripe') await stripeProvider.refund(o.provider_payment, amount, key);
  else if (o.provider === 'square') await squareProvider.refund(o.provider_payment, amount, key, o.currency);
  else throw new ProviderError('Free orders have nothing to refund.');
}

export { ProviderError };
