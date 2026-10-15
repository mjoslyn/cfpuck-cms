// Shared by the payment providers (./index.ts).
export const env = (k: string) => ((import.meta.env?.[k] as string | undefined) ?? process.env[k])?.trim() || undefined;

/** A provider refused or failed a request; its message is fit to show an editor. */
export class ProviderError extends Error {}

export interface CheckoutRequest {
  /** Our reference (a submission id, a ticket order's code), shown in the provider's dashboard. */
  reference: string;
  /** Unique to this checkout, so a retried request makes one (ids repeat between copies of the site). */
  idempotencyKey: string;
  /** Price of one in minor units. */
  items: { name: string; unit: number; quantity: number }[];
  currency: string;
  description?: string;
  email?: string;
  /** Where the visitor comes back to, paid or not (and Cancel goes, without a `cancelUrl`). */
  returnUrl: string;
  /** Stripe's Cancel; Square has none. */
  cancelUrl?: string;
  /** When the checkout stops taking payment (Stripe: clamped to 30 minutes to 24 hours). */
  expiresAt?: Date;
}

export interface Checkout {
  /** The page to send the visitor to. */
  url: string;
  /** The checkout: a Stripe Checkout Session, a Square payment link. */
  ref: string;
  /** Square's order, which its payment is on. */
  order?: string;
}

/** Where a checkout stands, asked of the provider (never taken from a redirect or webhook as given). */
export interface CheckoutState {
  /** processing: paid by a method that takes days (bank debits). */
  status: 'pending' | 'processing' | 'paid' | 'cancelled';
  paymentId?: string;
  /** What was paid, in minor units, to compare with what was asked. */
  amount?: number;
  /** How much of it has been refunded. */
  refunded?: number;
}

/**
 * What a webhook reports, in terms both features share: a checkout to look at again (found by `ref`, or
 * Square's `order`), with `failed` or `expired` when it won't be paid; or a payment's refunds (`refunded`,
 * the total so far as the provider has it now, which drops when a refund fails).
 */
export type PaymentEvent =
  | { kind: 'checkout'; ref?: string; order?: string; failed?: boolean; expired?: boolean }
  | { kind: 'refund'; payment: string; refunded: number };

export interface Provider {
  label: string;
  /** How long after the buyer comes back its checkout can take to show the payment, worth one wait and a second look (ms). */
  returnLag?: number;
  /** The environment variables it needs, all set: configured. */
  keys: string[];
  configured(): boolean;
  /** Test or sandbox keys. */
  sandbox(): boolean;
  create(req: CheckoutRequest): Promise<Checkout>;
  check(checkout: { ref: string; order?: string | null }): Promise<CheckoutState>;
  /** Stop an unpaid checkout taking payment. */
  close(ref: string): Promise<void>;
  /** Give back `amount` of a payment; `key` makes a retried refund count once. */
  refund(paymentId: string, amount: number, currency: string, key: string): Promise<void>;
  /** How much of a payment has been refunded so far, pending refunds included and failed ones not. */
  refunded(paymentId: string): Promise<number>;
  /** A webhook's event if it is signed by the provider; null if not. */
  webhookEvent(body: string, headers: Headers, url: string): Promise<any | null>;
  /** What a signed event reports; null for events neither feature uses. */
  parseEvent(event: any): Promise<PaymentEvent | null>;
}

/** Timing-safe comparison of two strings (signatures, tokens). */
export function sameString(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export async function hmac(key: string, message: string, encoding: 'hex' | 'base64'): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message)));
  return encoding === 'hex' ? [...sig].map((b) => b.toString(16).padStart(2, '0')).join('') : btoa(String.fromCharCode(...sig));
}
