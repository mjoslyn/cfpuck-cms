// Square payment links (https://developer.squareup.com/reference/square/checkout-api/create-payment-link):
// an order per submission, paid on Square's page. Env: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID,
// SQUARE_ENVIRONMENT (sandbox or production, the default), SQUARE_WEBHOOK_SIGNATURE_KEY and
// SQUARE_WEBHOOK_URL (the address the webhook subscription posts to, which the signature covers).
import { env, hmac, sameString, type CheckoutRequest, type CheckoutState, type Provider } from './common';

const VERSION = '2025-01-23';
const sandbox = () => env('SQUARE_ENVIRONMENT') === 'sandbox';
const api = () => (sandbox() ? 'https://connect.squareupsandbox.com/v2' : 'https://connect.squareup.com/v2');

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const token = env('SQUARE_ACCESS_TOKEN');
  if (!token) throw new Error('Square is not set up (SQUARE_ACCESS_TOKEN).');
  const res = await fetch(`${api()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Square-Version': VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Square ${res.status}: ${data?.errors?.map((e: { detail?: string; code?: string }) => e.detail || e.code).join('; ') || res.statusText}`);
  return data;
}

async function create(req: CheckoutRequest) {
  const location = env('SQUARE_LOCATION_ID');
  if (!location) throw new Error('Square is not set up (SQUARE_LOCATION_ID).');
  const data = await call('POST', '/online-checkout/payment-links', {
    idempotency_key: req.idempotencyKey,
    order: {
      location_id: location,
      reference_id: req.reference.slice(0, 40),
      line_items: req.items.map((it) => ({ name: it.name.slice(0, 512), quantity: String(it.quantity), base_price_money: { amount: it.unit, currency: req.currency } })),
    },
    checkout_options: { redirect_url: req.returnUrl, ask_for_shipping_address: false },
    ...(req.email ? { pre_populated_data: { buyer_email: req.email } } : {}),
    ...(req.description ? { payment_note: req.description.slice(0, 500) } : {}),
  });
  return { ref: String(data.payment_link.order_id), url: String(data.payment_link.url) };
}

/** Paid once the order's tenders cover it (payment-link orders can stay OPEN until fulfilled). */
async function check(ref: string): Promise<CheckoutState> {
  const { order } = await call('GET', `/orders/${encodeURIComponent(ref)}`);
  const tenders: { id?: string; payment_id?: string }[] = order?.tenders ?? [];
  const due = Number(order?.net_amount_due_money?.amount ?? order?.total_money?.amount ?? 1);
  if (order?.state === 'CANCELED') return { status: 'cancelled' };
  if (tenders.length && (due === 0 || order?.state === 'COMPLETED')) {
    return { status: 'paid', paymentId: tenders[0].payment_id ?? tenders[0].id, amount: Number(order?.total_money?.amount ?? 0) };
  }
  return { status: 'pending' };
}

export const provider: Provider = {
  label: 'Square',
  configured: () => !!(env('SQUARE_ACCESS_TOKEN') && env('SQUARE_LOCATION_ID')),
  sandbox,
  create,
  check,
};

/**
 * A webhook's x-square-hmacsha256-signature: base64 HMAC-SHA256 of the subscription's URL followed by
 * the body, with its signature key (https://developer.squareup.com/docs/webhooks/step3validate).
 */
export async function verifySquareSignature(body: string, header: string, url: string, key: string): Promise<boolean> {
  if (!header) return false;
  return sameString(header, await hmac(key, `${url}${body}`, 'base64'));
}
