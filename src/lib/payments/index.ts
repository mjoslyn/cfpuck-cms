// Payments for forms (src/lib/forms/checkout.ts) and tickets (src/lib/tickets/orders.ts): Stripe Checkout
// and Square payment links. Both are hosted checkouts: the visitor pays on the provider's page and comes
// back, so no card details reach the site. One webhook address per provider serves both
// (/api/payments/<provider>). Keys are environment variables (.env.example), never settings: settings are
// synced between copies of the site, and a local copy must not charge with production's keys.
import { env, type Provider } from './common';
import * as stripe from './stripe';
import * as square from './square';

export type { Checkout, CheckoutRequest, CheckoutState, PaymentEvent, Provider } from './common';
export { ProviderError } from './common';

export type PaymentProvider = 'stripe' | 'square';

export const PROVIDERS: Record<PaymentProvider, Provider> = { stripe: stripe.provider, square: square.provider };

/** The provider named, if it is one ('free' ticket orders have none). */
export const providerOf = (name: string | null | undefined): Provider | undefined => (name === 'stripe' || name === 'square' ? PROVIDERS[name] : undefined);

export interface ProviderStatus {
  label: string;
  configured: boolean;
  sandbox: boolean;
  /** The environment variables it still needs. */
  missing: string[];
}

/** Which providers have keys here, for the form builder and Settings > Tickets. */
export const providerStatus = () =>
  Object.fromEntries(
    Object.entries(PROVIDERS).map(([k, p]) => [k, { label: p.label, configured: p.configured(), sandbox: p.configured() && p.sandbox(), missing: p.keys.filter((v) => !env(v)) }]),
  ) as Record<PaymentProvider, ProviderStatus>;

/** Stop an unpaid checkout taking payment (best effort: it may already be closed or paid). */
export async function closeCheckout(name: string, ref: string | null | undefined) {
  const p = providerOf(name);
  if (!p || !ref) return;
  try {
    await p.close(ref);
  } catch (e) {
    console.warn(`payments: closing ${name} checkout ${ref}: ${(e as Error).message}`);
  }
}
