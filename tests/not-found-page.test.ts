// The site's Not found page (Settings > General, settings.site.not_found_page_id): an address with
// nothing there shows that page, answered with 404 and kept out of search engines; without one (or
// while it isn't published) the 404 template as before.
import { describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { renderRequest } from '../src/render/page';

const setSite = async (value: Record<string, unknown>) => {
  const db = siteDb();
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  await db.from('settings').upsert({ key: 'site', value: { ...((data?.value as object) ?? {}), ...value } });
};

describe('the Not found page', () => {
  it('shows the chosen page at a missing address, with a 404 and noindex', async () => {
    const db = siteDb();
    const content = { content: [{ type: 'text', props: { id: 'nf-text', attrs: { content: 'Nothing lives at this address.' } } }], root: { props: {} } };
    const { data: page } = await db.from('entries').insert({ type: 'page', slug: 'lost', title: 'Lost your way?', status: 'publish', content }).select('id').single();
    // A page template showing the page's content (the test database has no templates).
    await db.from('templates').insert({ kind: 'template', slug: 'page', title: 'Page', content: { content: [{ type: 'entry-content', props: { id: 'pc', attrs: {} } }], root: { props: {} } } });
    const missing = new URL('http://localhost/no-such-place-anywhere/');

    const before = await renderRequest(missing, db);
    expect(before.status).toBe(404);
    expect(before.html).not.toContain('Nothing lives at this address.');

    await setSite({ not_found_page_id: page!.id });
    const after = await renderRequest(missing, db);
    expect(after.status).toBe(404);
    expect(after.html).toContain('Nothing lives at this address.');
    expect(after.html).toContain('<title>Lost your way?');
    expect(after.html).toContain('noindex');
    expect(after.html).not.toContain('rel="canonical"');
    expect(after.html).toMatch(/<body class="[^"]*is-404/);

    // Its own address is an ordinary page, kept out of search engines.
    const own = await renderRequest(new URL('http://localhost/lost/'), db);
    expect(own.status).toBe(200);
    expect(own.html).toContain('noindex');

    // Unpublished, it isn't shown.
    await db.from('entries').update({ status: 'draft' }).eq('id', page!.id);
    const draft = await renderRequest(missing, db);
    expect(draft.status).toBe(404);
    expect(draft.html).not.toContain('Nothing lives at this address.');
    await setSite({ not_found_page_id: null });
  });
});
