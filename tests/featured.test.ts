// Featured per type (Settings > Types, settings.site.featured_types): a Featured switch in the type's
// entries' settings (fields.featured), a Collection block that lists featured entries only, and bulk
// marking from the content list.
import { afterEach, describe, expect, it } from 'vitest';
import { applyTypeSettings, featuredOn, featuredTypesFrom, fieldsFor } from '../src/lib/site';
import { siteDb } from '../src/lib/db/site';
import { Loader } from '../src/lib/data';
import { POST as bulk } from '../src/pages/api/admin/entries/bulk';

afterEach(() => applyTypeSettings({}));

describe('Featured per type', () => {
  it('gives a type the Featured field when an admin turns it on', () => {
    expect(featuredOn('post')).toBe(false);
    expect(fieldsFor('post').some((f) => f.key === 'featured')).toBe(false);
    applyTypeSettings({ featured_types: ['post', 'global', 'nope'] });
    expect(featuredOn('post')).toBe(true);
    expect(fieldsFor('post').at(-1)).toEqual({ key: 'featured', label: 'Featured', type: 'bool' });
    expect(featuredOn('global')).toBe(false);
    expect(featuredTypesFrom(['post', 'global', 'nope'])).toEqual(['post']);
    expect(featuredTypesFrom([])).toBeUndefined();
  });

  it('lists featured entries only, and marks them in bulk', async () => {
    const db = siteDb();
    const make = (slug: string, fields: Record<string, unknown> = {}) => db.from('entries').insert({ type: 'post', slug, title: slug, status: 'publish', fields }).select('id').single().then((r) => r.data!.id as number);
    const a = await make('feat-a', { featured: true });
    const b = await make('feat-b');
    const c = await make('feat-c');
    const listed = async () => (await new Loader(db).query({ postType: 'post', perPage: 50, featuredOnly: true, terms: {} })).ids;
    expect(await listed()).toEqual([a]);

    // Unpublished changes kept aside follow, so publishing them doesn't undo it.
    await db.from('entry_drafts').insert({ entry_id: b, draft: { entry: { fields: { note: 'x' } } } });
    const form = new FormData();
    form.append('action', 'feature');
    for (const id of [b, c]) form.append('ids', String(id));
    await bulk({ request: new Request('http://x', { method: 'POST', body: form }), locals: { db }, redirect: () => new Response(null, { status: 303 }) } as any);
    expect((await listed()).sort()).toEqual([a, b, c].sort());
    const { data: draft } = await db.from('entry_drafts').select('draft').eq('entry_id', b).single();
    expect((draft!.draft as any).entry.fields).toEqual({ note: 'x', featured: true });

    const off = new FormData();
    off.append('action', 'unfeature');
    off.append('ids', String(a));
    await bulk({ request: new Request('http://x', { method: 'POST', body: off }), locals: { db }, redirect: () => new Response(null, { status: 303 }) } as any);
    expect((await listed()).sort()).toEqual([b, c].sort());
  });
});
