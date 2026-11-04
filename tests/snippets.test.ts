// Settings > Code snippets (src/lib/snippets.ts): markup put on every page at the end of <head>, the start
// of <body> and before </body>, as written; known places only; not on previews.
import { describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { snippetsFrom, SNIPPET_MAX } from '../src/lib/snippets';
import { renderRequest } from '../src/render/page';

describe('code snippets', () => {
  it('keeps known places as text, trimmed and capped', () => {
    expect(snippetsFrom({ head: '  <meta name="x" content="1">  ', other: '<script>', footer: 5, bodyStart: ' ' })).toEqual({ head: '<meta name="x" content="1">' });
    expect(snippetsFrom({ footer: 'x'.repeat(SNIPPET_MAX + 10) })!.footer).toHaveLength(SNIPPET_MAX);
    expect(snippetsFrom(null)).toBeUndefined();
  });

  it('puts them on pages in their places, as written, and leaves them off previews', async () => {
    const db = siteDb();
    const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
    const head = `<script async src="https://analytics.example/a.js" data-site="x"></script>`;
    await db.from('settings').upsert({ key: 'site', value: { ...((data?.value as object) ?? {}), snippets: { head, bodyStart: '<noscript><iframe src="https://tags.example/ns"></iframe></noscript>', footer: `<script>window.chat = "it's here";</script>` } } });
    const { data: entry } = await db.from('entries').insert({ type: 'page', slug: 'snippet-page', title: 'Snippets', status: 'publish', content: { content: [], root: { props: {} } } }).select('*').single();
    const { html } = await renderRequest(new URL('http://localhost/snippet-page/'), db);
    expect(html).toContain(`${head}\n</head>`);
    expect(html).toMatch(/<body[^>]*>\n<noscript><iframe src="https:\/\/tags\.example\/ns"><\/iframe><\/noscript>\n<a class="c-skip-link/);
    // Untouched by the smart quotes the page's text gets.
    expect(html).toContain(`<script>window.chat = "it's here";</script>\n</body>`);
    const preview = await renderRequest(new URL('http://localhost/snippet-page/'), db, undefined, { entry: entry as never });
    expect(preview.html).not.toContain('analytics.example');
  });
});
