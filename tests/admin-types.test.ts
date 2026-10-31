// Content types an admin makes (Settings > Types, /api/admin/types): the site's code's types win over one
// of the same name; a made type gets pages, a listing page and its own fields, and joins the lists the
// rest of the site reads.
import { afterEach, describe, expect, it } from 'vitest';
import { POST } from '../src/pages/api/admin/types';
import { sessionDb, siteDb } from '../src/lib/db/site';
import { applyTypeSettings, ARCHIVE_PATHS, CODE_TYPES, COMPOSABLE_TYPES, CONTENT_TYPES, fieldsFor, LISTABLE_TYPES, PAGELESS_TYPES, RECORD_TYPES, site, TYPE_BASES, typeDef } from '../src/lib/site';
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
    expect(madeTypesFrom([{ type: 'post', label: 'Mine' }, { type: 'event', label: 'X' }, { type: 'gizmo', label: 'Gizmos', singular: 'Gizmo' }], ['page', 'post'])).toEqual([{ type: 'gizmo', label: 'Gizmos', singular: 'Gizmo', fields: [] }]);
  });

  it('joins the site’s types and every list read from them, the code’s first', () => {
    const before = site.types.map((t) => t.type);
    applyTypeSettings({ types: [{ type: 'gizmo', label: 'Gizmos', singular: 'Gizmo', base: 'gizmos', archive: 'gizmo-shop', fields: [{ label: 'Price', type: 'number' }] }, { type: 'gizmo_maker', label: 'Gizmo makers', singular: 'Gizmo maker', record: true }, { type: 'post', label: 'Mine' }] });
    expect(site.types.map((t) => t.type)).toEqual([...before.filter((t) => t !== 'global'), 'gizmo', 'gizmo_maker', 'global'].filter((t, i, a) => a.indexOf(t) === i));
    // The code's post type wins over the made one named post.
    expect(typeDef('post')?.label).toBe(CODE_TYPES.find((t) => t.type === 'post')!.label);
    expect(TYPE_BASES.gizmo).toBe('gizmos');
    expect(ARCHIVE_PATHS.gizmo).toBe('/gizmo-shop/');
    expect(fieldsFor('gizmo')).toEqual([{ key: 'price', label: 'Price', type: 'number' }]);
    expect(LISTABLE_TYPES).toContain('gizmo');
    expect(COMPOSABLE_TYPES.map((t) => t.type)).toContain('gizmo');
    expect(RECORD_TYPES.has('gizmo_maker')).toBe(true);
    expect(PAGELESS_TYPES.has('gizmo_maker')).toBe(true);
    applyTypeSettings({});
    expect(CONTENT_TYPES.some((t) => t.type === 'gizmo')).toBe(false);
    expect(TYPE_BASES.gizmo).toBeUndefined();
  });
});

describe('/api/admin/types', () => {
  it('makes a type whose pages work, changes it, and deletes it once no entry uses it', async () => {
    const made = await call({ action: 'save', label: 'Gizmos', singular: 'Gizmo', base: 'gizmos', archive: 'gizmo-shop', fields: [{ label: 'Price', type: 'number' }] });
    expect(made.status).toBe(200);
    expect(made.body.type.type).toBe('gizmo');
    expect(typeDef('gizmo')?.made).toBe(true);

    const db = siteDb();
    await db.from('templates').insert({ kind: 'template', slug: 'single', title: 'Single', content: { content: [{ type: 'entry-title', props: { id: 't', attrs: {} } }], root: { props: {} } } });
    const { data: entry } = await db.from('entries').insert({ type: 'gizmo', slug: 'kettle', title: 'Copper kettle', status: 'publish', fields: { price: 40 } }).select('id').single();
    const page = await renderRequest(new URL('http://localhost/gizmos/kettle/'), db);
    expect(page.status).toBe(200);
    expect(page.html).toContain('Copper kettle');
    expect((await renderRequest(new URL('http://localhost/gizmo-shop/'), db)).status).toBe(200);

    // A new address leaves a redirect from the old.
    expect((await call({ action: 'save', type: 'gizmo', label: 'Gizmos', singular: 'Gizmo', base: 'gizmo-goods', archive: 'gizmo-shop', fields: [] })).status).toBe(200);
    expect(TYPE_BASES.gizmo).toBe('gizmo-goods');
    const { data: redirect } = await db.from('redirects').select('to_url').eq('from_path', '/gizmos/*').single();
    expect(redirect?.to_url).toBe('/gizmo-goods/*');

    // An address in use is refused.
    expect((await call({ action: 'save', label: 'Gadgets', singular: 'Gadget', base: 'gizmo-goods' })).status).toBe(400);
    expect((await call({ action: 'save', label: 'Gadgets', singular: 'Gadget', base: 'admin' })).status).toBe(400);

    expect((await call({ action: 'delete', type: 'gizmo' })).status).toBe(400);
    await db.from('entries').delete().eq('id', entry!.id);
    expect((await call({ action: 'delete', type: 'gizmo' })).status).toBe(200);
    expect(await madeInSettings()).toEqual([]);
    expect(typeDef('gizmo')).toBeUndefined();
  });

  it('leaves the code’s types alone, and writes nothing for an editor', async () => {
    expect((await call({ action: 'save', type: 'post', label: 'Mine', singular: 'Mine' })).status).toBe(400);
    expect((await call({ action: 'delete', type: 'page' })).status).toBe(400);
    expect((await call({ action: 'save', label: 'Notes', singular: 'Note' }, editor)).status).toBe(400);
    expect(await madeInSettings()).toEqual([]);
  });
});
