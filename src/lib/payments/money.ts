// Money for payments (forms and tickets): the currencies offered, amounts in minor units (cents) and how
// they show. No environment or server imports: the builders and the browser use it too.

/** Currencies offered for payment (all with cents, which the amounts assume): ISO 4217 code, name. */
export const CURRENCIES: [string, string][] = [
  ['USD', 'US dollar'],
  ['CAD', 'Canadian dollar'],
  ['EUR', 'Euro'],
  ['GBP', 'British pound'],
  ['AUD', 'Australian dollar'],
  ['NZD', 'New Zealand dollar'],
];

/** Stripe's smallest charge (50 cents) is the floor for both providers; a total of 0 needs no checkout. */
export const MIN_CHARGE = 50;

/** An amount in minor units in its currency (either case), e.g. $25.00. */
export function formatMoney(minor: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** A price as a number in the currency (12.5) as minor units (1250). */
export const toMinor = (n: unknown) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) : 0);
