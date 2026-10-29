// The shop (Settings > Shop): its type and taxonomy, products' options and variants, the cart priced by
// the server, and product pages while the shop is on and off.
import { describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { withShop } from '../src/lib/shop/types';
import { DEFAULT_VARIANT, priceRange, productOf, sellable, shopSettingsFrom, variantOf, variantsFor } from '../src/lib/shop/config';
import { cleanCart, quoteCart } from '../src/lib/shop/cart';
import { showsType } from '../src/lib/features';
import { renderRequest } from '../src/render/page';
import { SHOP_TEMPLATES } from '../src/lib/shop/templates';

const setSite = async (value: Record<string, unknown>) => {
  const db = siteDb();
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  await db.from('settings').upsert({ key: 'site', value: { ...((data?.value as object) ?? {}), ...value } });
};

describe('the shop type', () => {
  it('adds products and product categories, and keeps a site\'s own product type', () => {
    const added = withShop([{ type: 'page', label: 'Pages', singular: 'Page' }], [{ name: 'category', label: 'Categories', base: 'category' }]);
    expect(added.types.map((t) => t.type)).toEqual(['page', 'product']);
    expect(added.taxonomies.map((t) => t.name)).toEqual(['category', 'product_category']);
    expect(added.coreTypes).toEqual(['product']);
    const own = withShop([{ type: 'product', label: 'Goods', singular: 'Good', base: 'goods' }], []);
    expect(own.types[0].label).toBe('Goods');
    expect(own.coreTypes).toEqual([]);
    expect(own.taxonomies).toEqual([]);
  });

  it('is hidden in the admin while the shop is off', () => {
    expect(showsType('product', { events: false, shop: false })).toBe(false);
    expect(showsType('product', { events: false, shop: true })).toBe(true);
    expect(showsType('event', { events: false, shop: true })).toBe(false);
    expect(showsType('post', { events: false, shop: false })).toBe(true);
  });

  it('saves only settings that differ from the defaults', () => {
    expect(shopSettingsFrom({ enabled: true, currency: 'usd', weightUnit: 'lb' })).toEqual({ enabled: true });
    expect(shopSettingsFrom({ currency: 'cad', weightUnit: 'kg' })).toEqual({ currency: 'CAD', weightUnit: 'kg' });
    expect(shopSettingsFrom({ weightUnit: 'stone' })).toBeUndefined();
  });
});

describe('product variants', () => {
  it('has one default variant without options, at the product\'s price', () => {
    const p = productOf({ shop: { price: 1500 } })!;
    expect(p.variants.map((v) => v.id)).toEqual([DEFAULT_VARIANT]);
    expect(variantOf(p, DEFAULT_VARIANT)?.price).toBe(1500);
    expect(productOf({})).toBeNull();
    // No price: not for sale.
    expect(sellable(productOf({ shop: {} })!)).toEqual([]);
  });

  it('makes a variant per combination and keeps a variant whose values stay', () => {
    let n = 0;
    const id = () => `v${++n}`;
    const first = variantsFor([{ name: 'Size', values: ['S', 'M'] }, { name: 'Color', values: ['Red', 'Blue'] }], [], id);
    expect(first.map((v) => v.values.join('/'))).toEqual(['S/Red', 'S/Blue', 'M/Red', 'M/Blue']);
    const priced = first.map((v) => (v.values[0] === 'M' ? { ...v, price: 2500 } : v));
    // A size added and a color taken away: M/Red keeps its id and price; S/Blue and M/Blue go.
    const next = variantsFor([{ name: 'Size', values: ['S', 'M', 'L'] }, { name: 'Color', values: ['Red'] }], priced, id);
    expect(next.map((v) => v.values.join('/'))).toEqual(['S/Red', 'M/Red', 'L/Red']);
    expect(next[1]).toMatchObject({ id: first[2].id, price: 2500 });
    expect(next[2].id).toBe('v5');
  });

  it('gives a combination stored without a variant the same id each time it is read', () => {
    const fields = { shop: { price: 1000, options: [{ name: 'Size', values: ['S', 'M'] }], variants: [] } };
    expect(productOf(fields)!.variants.map((v) => v.id)).toEqual(productOf(fields)!.variants.map((v) => v.id));
  });

  it('prices from its variants, leaving out those not sold', () => {
    const p = productOf({ shop: { price: 1000, options: [{ name: 'Size', values: ['S', 'M', 'L'] }], variants: [{ id: 'a', values: ['S'] }, { id: 'b', values: ['M'], price: 1400 }, { id: 'c', values: ['L'], price: 400, off: true }] } })!;
    expect(priceRange(p)).toEqual({ min: 1000, max: 1400 });
    expect(variantOf(p, 'c')).toBeUndefined();
    expect(variantOf(p, 'b')?.label).toBe('M');
  });
});

describe('the cart', () => {
  it('cleans what the browser sends', () => {
    expect(cleanCart([{ product: 3, variant: 'default', quantity: 2 }, { product: 3, variant: 'default', quantity: 200 }, { product: -1, variant: 'x', quantity: 1 }, { product: 4, variant: 'bad id!', quantity: 1 }, 'junk'])).toEqual([{ product: 3, variant: 'default', quantity: 99 }]);
  });

  it('prices the lines now, fitting them to what is left', async () => {
    const db = siteDb();
    const add = async (slug: string, status: string, shop: Record<string, unknown>, fields: Record<string, unknown> = {}) =>
      (await db.from('entries').insert({ type: 'product', slug, title: slug, status, fields: { shop, ...fields } }).select('id').single()).data!.id as number;
    const mug = await add('mug', 'publish', { price: 1200 });
    const shirt = await add('shirt', 'publish', { price: 2000, trackStock: true, options: [{ name: 'Size', values: ['S', 'M'] }], variants: [{ id: 's', values: ['S'] }, { id: 'm', values: ['M'], price: 2200 }] });
    const draft = await add('draft', 'draft', { price: 500 });
    const secret = await add('secret', 'publish', { price: 900 }, { access: { members: true } });
    await db.from('shop_stock').insert([{ product_id: shirt, variant: 's', on_hand: 0 }, { product_id: shirt, variant: 'm', on_hand: 2 }]);
    const lines = [
      { product: mug, variant: 'default', quantity: 3 },
      { product: shirt, variant: 'm', quantity: 5 },
      { product: shirt, variant: 's', quantity: 1 },
      { product: draft, variant: 'default', quantity: 1 },
      { product: secret, variant: 'default', quantity: 1 },
      { product: mug, variant: 'nope', quantity: 1 },
    ];
    const q = await quoteCart(db, lines, { published: true }, { shop: { enabled: true, currency: 'cad' } });
    expect(q.lines.map((l) => [l.title, l.quantity, l.total, l.problem ?? ''])).toEqual([
      ['mug', 3, 3600, ''],
      ['shirt', 2, 4400, 'fewer'],
      ['shirt', 0, 0, 'sold-out'],
      ['', 0, 0, 'gone'],
      ['', 0, 0, 'gone'],
      ['mug', 0, 0, 'gone'],
    ]);
    expect(q.lines[1].label).toBe('M');
    expect(q.subtotal).toBe(8000);
    expect(q.count).toBe(5);
    expect(q.currency).toBe('CAD');
  });
});

describe('product pages', () => {
  it('are Not found while the shop is off, and sell the product while it is on', async () => {
    const db = siteDb();
    const content = (items: unknown[]) => ({ root: { props: {} }, content: items });
    const t = SHOP_TEMPLATES['single-product'];
    // The template without its header and footer parts (the test database has none).
    await db.from('templates').insert({ kind: 'template', slug: 'single-product', title: t.title, content: content(t.content.filter((i) => i.type !== 'part')) });
    await db.from('entries').insert({ type: 'product', slug: 'lamp', title: 'Desk lamp', status: 'publish', fields: { shop: { price: 4500, compareAt: 6000 } }, content: content([]) });
    const url = new URL('http://localhost/product/lamp/');

    await setSite({ shop: undefined });
    expect((await renderRequest(url, db)).status).toBe(404);
    expect((await renderRequest(new URL('http://localhost/cart/'), db)).status).toBe(404);

    await setSite({ shop: { enabled: true } });
    const on = await renderRequest(url, db);
    expect(on.status).toBe(200);
    expect(on.html).toContain('data-add-to-cart');
    expect(on.html).toContain('$45.00');
    expect(on.html).toContain('<s class="c-price__was">$60.00</s>');
    expect(on.html).toContain('/assets/js/cart.js');
    // The cart, a built-in page, through the page template.
    await db.from('templates').insert({ kind: 'template', slug: 'page', title: 'Page', content: content([{ type: 'entry-content', props: { id: 'pc', attrs: {} } }]) });
    const cart = await renderRequest(new URL('http://localhost/cart/'), db);
    expect(cart.status).toBe(200);
    expect(cart.html).toContain('data-cart');
    await setSite({ shop: undefined });
  });
});
