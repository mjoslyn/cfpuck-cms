// Shared by the payment providers (./index.ts).
export const env = (k: string) => ((import.meta.env?.[k] as string | undefined) ?? process.env[k])?.trim() || undefined;

export interface CheckoutRequest {
  /** Our reference (the submission id), shown in the provider's dashboard. */
  reference: string;
  /** Unique to this checkout, so a retried request makes one (ids repeat between copies of the site). */
  idempotencyKey: string;
  items: { name: string; unit: number; quantity: number }[];
  currency: string;
  description?: string;
  email?: string;
  /** Where the visitor comes back to, paid or not. */
  returnUrl: string;
}

export interface Checkout {
  /** The provider's id for this checkout (Stripe session, Square order). */
  ref: string;
  /** The page to send the visitor to. */
  url: string;
}

/** Where a checkout stands, asked of the provider (never taken from a redirect or webhook as given). */
export interface CheckoutState {
  status: 'pending' | 'processing' | 'paid' | 'cancelled';
  paymentId?: string;
  /** What was paid, in minor units, to compare with what was asked. */
  amount?: number;
}

export interface Provider {
  label: string;
  configured(): boolean;
  /** Test or sandbox keys. */
  sandbox(): boolean;
  create(req: CheckoutRequest): Promise<Checkout>;
  check(ref: string): Promise<CheckoutState>;
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
