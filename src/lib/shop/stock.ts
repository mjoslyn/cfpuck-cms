// A product's stock (table shop_stock): how many of each variant are on hand. Read by the shop's blocks
// as the page is made, by the availability endpoint for pages that may be a minute old, and by the cart.
// Checkout will hold what an unpaid order takes against it. Safe in the browser (the editor reads it too).
import type { Db } from '../db/query';
import type { Product } from './config';

const chunks = (ids: number[], size = 200) => Array.from({ length: Math.ceil(ids.length / size) }, (_, i) => ids.slice(i * size, (i + 1) * size));

/** On-hand counts by product id, then variant id. */
export type StockMap = Map<number, Record<string, number>>;

/** The stock of some products (each one asked for is in the map, with no counts when it has none). */
export async function loadStock(db: Db, ids: number[]): Promise<StockMap> {
  const want = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  const out: StockMap = new Map(want.map((id) => [id, {}]));
  for (const chunk of chunks(want)) {
    const { data, error } = await db.from('shop_stock').select('product_id, variant, on_hand').in('product_id', chunk);
    if (error) throw error;
    for (const r of data ?? []) out.set(r.product_id, { ...(out.get(r.product_id) ?? {}), [r.variant]: Number(r.on_hand) || 0 });
  }
  return out;
}

/** How many of a variant are left: null when the product doesn't count stock (no limit). */
export function leftOf(p: Product, stock: Record<string, number> | undefined, variant: string): number | null {
  return p.trackStock ? Math.max(0, stock?.[variant] ?? 0) : null;
}
