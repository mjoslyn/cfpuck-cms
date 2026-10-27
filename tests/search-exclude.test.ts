// An entry's "Leave out of this site's search" (fields.seo.nosearch): the site search's ranking
// (entry_search, used by /search/ and /api/search) never lists it.
import { describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { Loader } from '../src/lib/data';

describe('leaving an entry out of site search', () => {
  it('drops it from the ranked matches and the search results', async () => {
    const db = siteDb();
    const add = async (slug: string, fields: Record<string, unknown>) => (await db.from('entries').insert({ type: 'page', slug, title: `Zephyr ${slug}`, status: 'publish', fields }).select('id').single()).data!.id as number;
    const shown = await add('shown', {});
    const hidden = await add('hidden', { seo: { nosearch: true } });
    const off = await add('off-again', { seo: { nosearch: false } });
    const { data } = await db.rpc('entry_search', { p_query: '"zephyr"*', p_status: 'publish', p_types: ['page'] });
    expect(((data ?? []) as { id: number }[]).map((r) => r.id).sort()).toEqual([shown, off].sort());
    const found = await new Loader(db).query({ postType: ['page'], search: 'zephyr', perPage: 10, page: 1, orderBy: 'relevance', terms: {} });
    expect(found.ids).not.toContain(hidden);
    expect(found.total).toBe(2);
  });
});
