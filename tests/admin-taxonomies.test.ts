// Taxonomies set in the admin (Content > Taxonomies, /api/admin/taxonomies): an admin makes one for some
// types, or adds types to one of the site's own; the site, the editor's pickers and term pages follow.
import { afterEach, describe, expect, it } from 'vitest';
import { POST } from '../src/pages/api/admin/taxonomies';
import { sessionDb, siteDb } from '../src/lib/db/site';
import { applyTaxonomySettings, isFlat, isTaxonomy, site, TAXONOMY_BASES, taxonomiesOf, termPageType, typesOfTaxonomy } from '../src/lib/site';
import { baseProblem, cleanBase, madeTaxonomiesFrom, taxonomyName, taxonomyTypesFrom } from '../src/lib/site/taxonomy-settings';
import { renderRequest } from '../src/render/page';

const admin = sessionDb({ role: 'admin', uid: '00000000-0000-0000-0000-000000000002' });
const editor = sessionDb({ role: 'editor', uid: '00000000-0000-0000-0000-000000000001' });
const post = (fields: Record<string, string | string[]>, db = admin) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) form.append(k, x);
  return POST({ request: new Request('http://x/api/admin/taxonomies', { method: 'POST', body: form }), locals: { db }, redirect: (to: string) => new Response(null, { status: 303, headers: { location: to } }) } as any);
};
const siteSettings = async () => ((await siteDb().from('settings').select('value').eq('key', 'site').maybeSingle()).data?.value ?? {}) as Record<string, any>;

afterEach(() => applyTaxonomySettings({}));

describe('taxonomy settings', () => {
  it('names a taxonomy from its label and cleans its address', () => {
    expect(taxonomyName('Colours & Finishes')).toBe('colours_finishes');
    expect(taxonomyName('2024 Seasons')).toBe('seasons');
    expect(cleanBase(' /Shop/Colours! ')).toBe('shop/colours');
  });

  it('keeps known names and types only, never a name the site uses', () => {
    const made = madeTaxonomiesFrom(
      [{ name: 'color', label: 'Colors', types: ['post', 'nope'], flat: true }, { name: 'category', label: 'Clash', types: [] }, { name: 'Bad Name', label: 'X', types: [] }, { name: 'color', label: 'Again', types: [] }],
      ['page', 'post'],
      ['category', 'tag'],
    );
    expect(made).toEqual([{ name: 'color', label: 'Colors', types: ['post'], flat: true }]);
    expect(taxonomyTypesFrom({ category: ['page', 'x'], tag: ['page'], gone: ['page'] }, ['category'], ['page', 'post'])).toEqual({ category: ['page'] });
  });

  it('refuses an address the site or another type or taxonomy uses', () => {
    expect(baseProblem('admin/colors', [])).toMatch(/own addresses/);
    expect(baseProblem('category', ['category'])).toMatch(/already used/);
    expect(baseProblem('colors', ['category'])).toBeNull();
  });

  it('applies to the site: its taxonomies, their types, addresses and term pages', () => {
    applyTaxonomySettings({ taxonomies: [{ name: 'color', label: 'Colors', base: 'colors', flat: true, types: ['page', 'post'] }], taxonomy_types: { category: ['page'] } });
    expect(isTaxonomy('color')).toBe(true);
    expect(site.taxonomies.map((t) => t.name)).toContain('color');
    expect(TAXONOMY_BASES.color).toBe('colors');
    expect(isFlat('color')).toBe(true);
    expect(taxonomiesOf('page')).toEqual(['category', 'color']);
    expect(taxonomiesOf('post')).toEqual(['category', 'color']);
    expect(typesOfTaxonomy('color')).toEqual(['page', 'post']);
    // On more than one type, a term page lists them all.
    expect(termPageType('color')).toBe('any');
    applyTaxonomySettings({});
    expect(isTaxonomy('color')).toBe(false);
    expect(TAXONOMY_BASES.color).toBeUndefined();
    expect(taxonomiesOf('page')).toEqual([]);
    expect(taxonomiesOf('post')).toEqual(['category']);
  });
});

describe('/api/admin/taxonomies', () => {
  it('makes a taxonomy for several types, whose term pages then work', async () => {
    const res = await post({ action: 'create', label: 'Colors', singular: 'Color', base: 'colors', types: ['page', 'post'] });
    expect(res.headers.get('location')).toContain('taxonomy=colors');
    expect((await siteSettings()).taxonomies).toEqual([{ name: 'colors', label: 'Colors', singular: 'Color', base: 'colors', types: ['page', 'post'] }]);
    expect(taxonomiesOf('page')).toContain('colors');

    const db = siteDb();
    const { data: term } = await db.from('terms').insert({ taxonomy: 'colors', slug: 'red', name: 'Red' }).select('id').single();
    const { data: entry } = await db.from('entries').insert({ type: 'page', slug: 'red-barn', title: 'The red barn', status: 'publish' }).select('id').single();
    await db.from('entry_terms').insert({ entry_id: entry!.id, term_id: term!.id });
    const page = await renderRequest(new URL('http://localhost/colors/red/'), db);
    expect(page.status).toBe(200);

    // A second with the same name gets its own; an address in use is refused.
    await post({ action: 'create', label: 'Colors', types: ['post'] });
    expect((await siteSettings()).taxonomies.map((t: any) => t.name)).toEqual(['colors', 'colors_2']);
    const clash = await post({ action: 'create', label: 'Shades', base: 'colors', types: ['post'] });
    expect(clash.headers.get('location')).toContain('error=');

    // Deleting it deletes its terms.
    await post({ action: 'delete', taxonomy: 'colors' });
    expect((await siteSettings()).taxonomies.map((t: any) => t.name)).toEqual(['colors_2']);
    expect((await db.from('terms').select('id').eq('taxonomy', 'colors')).data).toEqual([]);
    expect(isTaxonomy('colors')).toBe(false);
    await post({ action: 'delete', taxonomy: 'colors_2' });
  });

  it('adds types to one of the site’s own taxonomies, keeping those its code sets', async () => {
    await post({ action: 'update', taxonomy: 'category', types: ['page', 'post'] });
    expect((await siteSettings()).taxonomy_types).toEqual({ category: ['page'] });
    expect(taxonomiesOf('page')).toContain('category');
    // Unticking what the code sets doesn't take it away.
    await post({ action: 'update', taxonomy: 'category', types: [] });
    expect((await siteSettings()).taxonomy_types).toEqual({});
    expect(taxonomiesOf('post')).toEqual(['category']);
    // Tags are on every type already.
    expect((await post({ action: 'update', taxonomy: 'tag', types: ['page'] })).headers.get('location')).toContain('error=');
  });

  it('writes nothing for an editor', async () => {
    const res = await post({ action: 'create', label: 'Sizes', types: ['post'] }, editor);
    expect(res.headers.get('location')).toContain('error=');
    expect(((await siteSettings()).taxonomies ?? []).some((t: any) => t.name === 'sizes')).toBe(false);
  });
});
