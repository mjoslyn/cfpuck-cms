// Square payment links (https://developer.squareup.com/reference/square/checkout-api/create-payment-link):
// an order per checkout, paid on Square's page. Env: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID,
// SQUARE_ENVIRONMENT (sandbox or production, the default), SQUARE_WEBHOOK_SIGNATURE_KEY and
// SQUARE_WEBHOOK_URL (the address the webhook subscription posts to, which the signature covers, when the
// site sees another one).
import { ProviderError, env, hmac, sameString, type CheckoutRequest, type CheckoutState, type Provider } from './common';

const VERSION = '2025-09-24';
const sandbox = () => env('SQUARE_ENVIRONMENT') === 'sandbox';
const api = () => (sandbox() ? 'https://connect.squareupsandbox.com/v2' : 'https://connect.squareup.com/v2');

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
  const token = env('SQUARE_ACCESS_TOKEN');
  if (!token) throw new ProviderError('Square is not set up (SQUARE_ACCESS_TOKEN).');
  const res = await fetch(`${api()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Square-Version': VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errors: { detail?: string; code?: string; field?: string }[] = data?.errors ?? [];
    throw Object.assign(new ProviderError(`Square ${res.status}: ${errors.map((e) => e.detail || e.code).join('; ') || res.statusText}`), { fields: errors.map((e) => e.field) });
  }
  return data;
}

async function create(req: CheckoutRequest) {
  const location = env('SQUARE_LOCATION_ID');
  if (!location) throw new ProviderError('Square is not set up (SQUARE_LOCATION_ID).');
  const currency = req.currency.toUpperCase();
  const body = (email?: string) => ({
    idempotency_key: req.idempotencyKey.slice(0, 45),
    order: {
      location_id: location,
      reference_id: req.reference.slice(0, 40),
      line_items: req.items.map((it) => ({ name: it.name.slice(0, 500), quantity: String(it.quantity), base_price_money: { amount: it.unit, currency } })),
    },
    checkout_options: { redirect_url: req.returnUrl, ask_for_shipping_address: false },
    ...(email ? { pre_populated_data: { buyer_email: email } } : {}),
    ...(req.description ? { payment_note: req.description.slice(0, 500) } : {}),
  });
  let payment_link;
  try {
    ({ payment_link } = await call('POST', '/online-checkout/payment-links', body(req.email)));
  } catch (e) {
    // Square refuses addresses it judges invalid (example.org, some it can't verify); the buyer then
    // types one on its page.
    if (!req.email || !(e as { fields?: string[] }).fields?.includes('pre_populated_data.buyer_email')) throw e;
    ({ payment_link } = await call('POST', '/online-checkout/payment-links', { ...body(), idempotency_key: `${req.idempotencyKey.slice(0, 42)}-ne` }));
  }
  return { ref: String(payment_link.id), order: String(payment_link.order_id), url: String(payment_link.url) };
}

const payment = async (id: string) => (await call('GET', `/payments/${encodeURIComponent(id)}`)).payment ?? {};

/** Paid when a payment on the order has completed (Square leaves a payment link's order open). */
async function check({ order: orderId }: { order?: string | null }): Promise<CheckoutState> {
  if (!orderId) return { status: 'pending' };
  const { order } = await call('GET', `/orders/${encodeURIComponent(orderId)}`);
  if (order?.state === 'CANCELED') return { status: 'cancelled' };
  for (const tender of order?.tenders ?? []) {
    const p = await payment(tender.payment_id ?? tender.id);
    if (p.status === 'COMPLETED') return { status: 'paid', paymentId: p.id, amount: Number(p.amount_money?.amount ?? order?.total_money?.amount ?? 0), refunded: Number(p.refunded_money?.amount ?? 0) };
  }
  return { status: 'pending' };
}

async function close(ref: string) {
  await call('DELETE', `/online-checkout/payment-links/${encodeURIComponent(ref)}`);
}

async function refund(paymentId: string, amount: number, currency: string, key: string) {
  await call('POST', '/refunds', { idempotency_key: `refund-${key}`.slice(0, 45), payment_id: paymentId, amount_money: { amount, currency: currency.toUpperCase() } });
}

/**
 * A webhook's x-square-hmacsha256-signature: base64 HMAC-SHA256 of the subscription's URL followed by
 * the body, with its signature key (https://developer.squareup.com/docs/webhooks/step3validate).
 */
export async function verifySquareSignature(body: string, header: string, url: string, key: string): Promise<boolean> {
  if (!header) return false;
  return sameString(header, await hmac(key, `${url}${body}`, 'base64'));
}

export const provider: Provider = {
  label: 'Square',
  keys: ['SQUARE_ACCESS_TOKEN', 'SQUARE_LOCATION_ID'],
  configured: () => !!(env('SQUARE_ACCESS_TOKEN') && env('SQUARE_LOCATION_ID')),
  sandbox,
  create,
  check,
  close,
  refund,
  refunded: async (id) => Number((await payment(id)).refunded_money?.amount ?? 0),
  async webhookEvent(body, headers, url) {
    const key = env('SQUARE_WEBHOOK_SIGNATURE_KEY');
    return key && (await verifySquareSignature(body, headers.get('x-square-hmacsha256-signature') ?? '', env('SQUARE_WEBHOOK_URL') || url, key)) ? JSON.parse(body) : null;
  },
};
