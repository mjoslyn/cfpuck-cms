// Payment providers for forms (src/lib/forms/checkout.ts): Stripe Checkout and Square payment links.
// Both are hosted checkouts: the visitor pays on the provider's page and comes back, so no card details
// reach the site. Keys are environment variables (.env.example), never settings: settings are synced
// between copies of the site, and a local copy must not charge with production's keys.
import type { PaymentProvider } from '../forms/types';
import type { Provider } from './common';
import * as stripe from './stripe';
import * as square from './square';

export type { Checkout, CheckoutRequest, CheckoutState, Provider } from './common';

export const PROVIDERS: Record<PaymentProvider, Provider> = { stripe: stripe.provider, square: square.provider };

/** Which providers have keys here, for the form builder. */
export const providerStatus = () =>
  Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, { label: p.label, configured: p.configured(), sandbox: p.configured() && p.sandbox() }])) as Record<PaymentProvider, { label: string; configured: boolean; sandbox: boolean }>;
