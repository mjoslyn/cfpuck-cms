// Content types an admin makes (Settings > Types, /api/admin/types): the site's code's types win over one
// of the same name; a made type gets pages, a listing page and its own fields, and joins the lists the
// rest of the site reads.
import { afterEach, describe, expect, it } from 'vitest';
import { POST } from '../src/pages/api/admin/types';
import { sessionDb, siteDb } from '../src/lib/db/site';
import { applyTypeSettings, ARCHIVE_PATHS, COMPOSABLE_TYPES, CONTENT_TYPES, fieldsFor, LISTABLE_TYPES, PAGELESS_TYPES, RECORD_TYPES, site, TYPE_BASES, typeDef } from '../src/lib/site';
import { fieldsFrom, madeTypesFrom } from '../src/lib/site/type-settings';
import { renderRequest } from '../src/render/page';

const admin = sessionDb({ role: 'admin', uid: '00000000-0000-0000-0000-000000000002' });
const editor = sessionDb({ role: 'editor', uid: '00000000-0000-0000-0000-000000000001' });
const call = async (body: Record<string, unknown>, db = admin) => {
  const res = await POST({ request: new Request('http://x/api/admin/types', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), locals: { db } } as any);
  return { status: res.status, body: await res.json() };
};
const madeInSettings = async () => (((await siteDb().from('settings').select('value').eq('key', 'site').maybeSingle()).data?.value ?? {}) as any).types ?? [];

afterEach(() => applyTypeSettings({}));

describe('type settings', () => {
  it('keeps fields to known kinds, with keys of their own', () => {
    expect(fieldsFrom([
      { label: 'Price', type: 'number', compose: 'price' },
      { label: 'Price', type: 'text' },
      { label: 'SEO', type: 'text' },
      { label: 'Size', type: 'select', options: 'small\nlarge' },
      { label: 'Empty choice', type: 'select', options: '' },
      { label: 'Bad', type: 'repeater' },
    ])).toEqual([
      { key: 'price', label: 'Price', type: 'number', compose: 'price' },
      { key: 'price_2', label: 'Price', type: 'text' },
      { key: 'seo_2', label: 'SEO', type: 'text' },
      { key: 'size', label: 'Size', type: 'select', options: [['small', 'small'], ['large', 'large']] },
    ]);
  });

  it('never takes a name the code or the core uses', () => {
    expect(madeTypesFrom([{ type: 'post', label: 'Mine' }, { type: 'event', label: 'X' }, { type: 'product', label: 'Products', singular: 'Product' }], ['page', 'post'])).toEqual([{ type: 'product', label: 'Products', singular: 'Product', fields: [] }]);
  });

  it('joins the site’s types and every list read from them, the code’s first', () => {
    const before = site.types.map((t) => t.type);
    applyTypeSettings({ types: [{ type: 'product', label: 'Products', singular: 'Product', base: 'products', archive: 'shop', fields: [{ label: 'Price', type: 'number' }] }, { type: 'supplier', label: 'Suppliers', singular: 'Supplier', record: true }, { type: 'post', label: 'Mine' }] });
    expect(site.types.map((t) => t.type)).toEqual([...before.filter((t) => t !== 'global'), 'product', 'supplier', 'global'].filter((t, i, a) => a.indexOf(t) === i));
    expect(typeDef('post')?.label).toBe('Posts');
    expect(TYPE_BASES.product).toBe('products');
    expect(ARCHIVE_PATHS.product).toBe('/shop/');
    expect(fieldsFor('product')).toEqual([{ key: 'price', label: 'Price', type: 'number' }]);
    expect(LISTABLE_TYPES).toContain('product');
    expect(COMPOSABLE_TYPES.map((t) => t.type)).toContain('product');
    expect(RECORD_TYPES.has('supplier')).toBe(true);
    expect(PAGELESS_TYPES.has('supplier')).toBe(true);
    applyTypeSettings({});
    expect(CONTENT_TYPES.some((t) => t.type === 'product')).toBe(false);
    expect(TYPE_BASES.product).toBeUndefined();
  });
});

describe('/api/admin/types', () => {
  it('makes a type whose pages work, changes it, and deletes it once no entry uses it', async () => {
    const made = await call({ action: 'save', label: 'Products', singular: 'Product', base: 'products', archive: 'shop', fields: [{ label: 'Price', type: 'number' }] });
    expect(made.status).toBe(200);
    expect(made.body.type.type).toBe('product');
    expect(typeDef('product')?.made).toBe(true);

    const db = siteDb();
    await db.from('templates').insert({ kind: 'template', slug: 'single', title: 'Single', content: { content: [{ type: 'entry-title', props: { id: 't', attrs: {} } }], root: { props: {} } } });
    const { data: entry } = await db.from('entries').insert({ type: 'product', slug: 'kettle', title: 'Copper kettle', status: 'publish', fields: { price: 40 } }).select('id').single();
    const page = await renderRequest(new URL('http://localhost/products/kettle/'), db);
    expect(page.status).toBe(200);
    expect(page.html).toContain('Copper kettle');
    expect((await renderRequest(new URL('http://localhost/shop/'), db)).status).toBe(200);

    // A new address leaves a redirect from the old.
    expect((await call({ action: 'save', type: 'product', label: 'Products', singular: 'Product', base: 'goods', archive: 'shop', fields: [] })).status).toBe(200);
    expect(TYPE_BASES.product).toBe('goods');
    const { data: redirect } = await db.from('redirects').select('to_url').eq('from_path', '/products/*').single();
    expect(redirect?.to_url).toBe('/goods/*');

    // An address in use is refused.
    expect((await call({ action: 'save', label: 'Gadgets', singular: 'Gadget', base: 'goods' })).status).toBe(400);
    expect((await call({ action: 'save', label: 'Gadgets', singular: 'Gadget', base: 'admin' })).status).toBe(400);

    expect((await call({ action: 'delete', type: 'product' })).status).toBe(400);
    await db.from('entries').delete().eq('id', entry!.id);
    expect((await call({ action: 'delete', type: 'product' })).status).toBe(200);
    expect(await madeInSettings()).toEqual([]);
    expect(typeDef('product')).toBeUndefined();
  });

  it('leaves the code’s types alone, and writes nothing for an editor', async () => {
    expect((await call({ action: 'save', type: 'post', label: 'Mine', singular: 'Mine' })).status).toBe(400);
    expect((await call({ action: 'delete', type: 'page' })).status).toBe(400);
    expect((await call({ action: 'save', label: 'Notes', singular: 'Note' }, editor)).status).toBe(400);
    expect(await madeInSettings()).toEqual([]);
  });
});
