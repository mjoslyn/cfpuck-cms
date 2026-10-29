// Shop: an optional feature (Settings > Shop, settings.site.shop), off until an admin turns it on. A
// product (the `product` type, src/lib/shop/types.ts) keeps what it sells in its fields under the
// reserved key `shop`: its price, options (Size, Color...) and variants, each with its own price, SKU,
// weight and image. Its stock is kept apart (table shop_stock, per variant), so saving a product never
// overwrites a count. Prices are in minor units (cents). Safe in the browser.

/** The shop's blocks: offered in the editor, and shown on the site, only while the shop is on. */
export const SHOP_BLOCKS = ['product-price', 'add-to-cart', 'cart', 'cart-link'];

/** The reserved field key a product's shop settings live under. */
export const SHOP_KEY = 'shop';
/** The cart page (a page with that address, else a built-in one). */
export const CART_PATH = '/cart/';
/** The variant of a product with no options. */
export const DEFAULT_VARIANT = 'default';
export const MAX_OPTIONS = 3;
export const MAX_VALUES = 30;
export const MAX_VARIANTS = 100;
/** The most of one line a cart takes, whatever the product allows. */
export const MAX_QUANTITY = 99;
/** The most lines a cart takes. */
export const MAX_LINES = 50;

export const WEIGHT_UNITS: [string, string][] = [
  ['lb', 'Pounds'],
  ['oz', 'Ounces'],
  ['kg', 'Kilograms'],
  ['g', 'Grams'],
];

export interface ShopSettings {
  enabled: boolean;
  /** ISO 4217, upper case (src/lib/payments/money.ts CURRENCIES). */
  currency: string;
  weightUnit: string;
}

/** The shop's settings with their defaults. */
export function shopSettings(site: Record<string, any> | null | undefined): ShopSettings {
  const s = site?.shop ?? {};
  return {
    enabled: s.enabled === true,
    currency: /^[A-Za-z]{3}$/.test(String(s.currency ?? '')) ? String(s.currency).toUpperCase() : 'USD',
    weightUnit: WEIGHT_UNITS.some(([u]) => u === s.weightUnit) ? s.weightUnit : 'lb',
  };
}

/** The shop's settings as saved (Settings > Shop): only what differs from the defaults. */
export function shopSettingsFrom(raw: unknown): Partial<ShopSettings> | undefined {
  const s = shopSettings({ shop: raw });
  const out: Partial<ShopSettings> = {};
  if (s.enabled) out.enabled = true;
  if (s.currency !== 'USD') out.currency = s.currency;
  if (s.weightUnit !== 'lb') out.weightUnit = s.weightUnit;
  return Object.keys(out).length ? out : undefined;
}

/** Whether the shop is on. */
export const shopOn = (site: Record<string, any> | null | undefined): boolean => site?.shop?.enabled === true;

export interface ProductOption {
  name: string;
  values: string[];
}

/** One combination of a product's option values. Its own price, compare-at price, SKU, weight and image
 *  replace the product's; empty, the product's are used. */
export interface Variant {
  /** Stable: stock and carts name it. */
  id: string;
  /** One value per option, in the options' order. */
  values: string[];
  price?: number | null;
  compareAt?: number | null;
  sku?: string;
  weight?: number | null;
  /** A media id. */
  image?: number | null;
  /** Not sold (a combination that doesn't exist). */
  off?: boolean;
}

export interface Product {
  /** Null: no price yet, not for sale. */
  price: number | null;
  compareAt?: number | null;
  sku?: string;
  weight?: number | null;
  /** Sent by post (default), or not (a service, a gift card picked up). */
  ships: boolean;
  /** Only collected (pickup), never posted. */
  pickupOnly?: boolean;
  /** Taxed (default). */
  taxable: boolean;
  /** The most one order takes; empty: MAX_QUANTITY. */
  maxPerOrder?: number | null;
  /** Count stock (shop_stock); off, there's no limit. */
  trackStock: boolean;
  options: ProductOption[];
  variants: Variant[];
}

/** A variant as sold: the product's settings where it has none of its own. */
export interface ResolvedVariant {
  id: string;
  values: string[];
  /** "Large / Blue"; '' for a product with no options. */
  label: string;
  price: number | null;
  compareAt: number | null;
  sku: string;
  weight: number | null;
  image: number | null;
  off: boolean;
}

const cents = (v: unknown): number | null => (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.round(Number(v)));
const text = (v: unknown, max = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v: unknown): number | null => (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));

/** A new variant id. */
export const newVariantId = () => `v${Math.random().toString(36).slice(2, 9)}`;

/** The key of a combination of values (to match variants when the options change). */
const comboKey = (values: string[]) => values.map((v) => v.toLowerCase()).join('\u0001');

/** A product's options, cleaned: named, with distinct values, at most MAX_OPTIONS. */
export function cleanOptions(raw: unknown): ProductOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .map((o) => {
      const values: string[] = [];
      for (const v of Array.isArray(o?.values) ? o.values : []) {
        const t = text(v, 60);
        if (t && !values.some((x) => x.toLowerCase() === t.toLowerCase())) values.push(t);
      }
      return { name: text(o?.name, 40), values: values.slice(0, MAX_VALUES) };
    })
    .filter((o) => {
      const key = o.name.toLowerCase();
      if (!o.name || !o.values.length || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_OPTIONS);
}

/** Every combination of the options' values, in order (the first option varying slowest). */
export function combinations(options: ProductOption[]): string[][] {
  return options.reduce<string[][]>((acc, o) => acc.flatMap((c) => o.values.map((v) => [...c, v])), [[]]).slice(0, MAX_VARIANTS);
}

/**
 * The variants for a set of options: one per combination, each keeping the variant it had (its id,
 * price, stock...) when its values are the same, else a new one. No options: the one default variant.
 */
export function variantsFor(options: ProductOption[], existing: Variant[] = [], makeId?: () => string): Variant[] {
  if (!options.length) {
    const own = existing.find((v) => v.id === DEFAULT_VARIANT);
    return [{ ...(own ?? {}), id: DEFAULT_VARIANT, values: [] }];
  }
  const byKey = new Map(existing.filter((v) => v.values.length === options.length).map((v) => [comboKey(v.values), v]));
  const used = new Set<string>();
  return combinations(options).map((values) => {
    const had = byKey.get(comboKey(values));
    // A new combination: a fresh id in the editor, else one made from its values (stable across reads).
    let id = had && had.id !== DEFAULT_VARIANT ? had.id : makeId ? makeId() : comboId(values);
    while (used.has(id)) id = makeId ? makeId() : `${id}x`;
    used.add(id);
    return { ...(had ?? {}), id, values };
  });
}

/** A product's shop settings as stored (fields.shop), cleaned; null when the entry has none. */
export function productOf(fields: Record<string, any> | null | undefined): Product | null {
  const raw = fields?.[SHOP_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const options = cleanOptions(raw.options);
  const variants = (Array.isArray(raw.variants) ? raw.variants : [])
    .filter((v: any) => v && typeof v.id === 'string' && /^[\w-]{1,40}$/.test(v.id))
    .map((v: any): Variant => ({
      id: v.id,
      values: Array.isArray(v.values) ? v.values.map((x: unknown) => text(x, 60)) : [],
      price: cents(v.price),
      compareAt: cents(v.compareAt),
      sku: text(v.sku, 60) || undefined,
      weight: num(v.weight),
      image: Number(v.image) > 0 ? Number(v.image) : null,
      off: v.off === true || undefined,
    }));
  const max = Math.floor(Number(raw.maxPerOrder));
  return {
    price: cents(raw.price),
    compareAt: cents(raw.compareAt),
    sku: text(raw.sku, 60) || undefined,
    weight: num(raw.weight),
    ships: raw.ships !== false,
    pickupOnly: raw.pickupOnly === true || undefined,
    taxable: raw.taxable !== false,
    maxPerOrder: max > 0 ? Math.min(max, MAX_QUANTITY) : null,
    trackStock: raw.trackStock === true,
    options,
    // The variants that match the options now (a variant for values no longer offered is dropped).
    variants: variantsFor(options, variants),
  };
}

/** A stable id for a combination stored without one (the same each time it is read). */
function comboId(values: string[]): string {
  let h = 0;
  for (const ch of comboKey(values)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return `c${(h >>> 0).toString(36)}`;
}

/** A variant with the product's settings where it has none of its own. */
export function resolveVariant(p: Product, v: Variant): ResolvedVariant {
  return {
    id: v.id,
    values: v.values,
    label: v.values.join(' / '),
    price: v.price ?? p.price,
    compareAt: v.compareAt ?? p.compareAt ?? null,
    sku: v.sku || p.sku || '',
    weight: v.weight ?? p.weight ?? null,
    image: v.image ?? null,
    off: !!v.off,
  };
}

/** The variants a product sells (switched-off ones and those with no price left out). */
export const sellable = (p: Product): ResolvedVariant[] => p.variants.map((v) => resolveVariant(p, v)).filter((v) => !v.off && v.price != null);

/** A variant by id, as sold; undefined when it isn't (gone, off or without a price). */
export const variantOf = (p: Product, id: string): ResolvedVariant | undefined => sellable(p).find((v) => v.id === id);

/** The lowest and highest price of what a product sells; null when it sells nothing. */
export function priceRange(p: Product): { min: number; max: number } | null {
  const prices = sellable(p).map((v) => v.price!);
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
}

/** The most of a variant one order may take, given what is in stock (null: not counted). */
export const maxQuantity = (p: Product, left: number | null) => Math.max(0, Math.min(p.maxPerOrder || MAX_QUANTITY, left ?? MAX_QUANTITY));
