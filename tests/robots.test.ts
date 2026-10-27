// "Hide from search engines and AI answer engines" (seo.noindex): the page's robots meta tag, and
// /robots.txt disallowing those pages for the AI crawlers (src/lib/ai-crawlers.ts).
import { describe, expect, it } from 'vitest';
import { GET } from '../src/pages/robots.txt';
import { AI_CRAWLERS, robotsTxt } from '../src/lib/ai-crawlers';
import { siteDb } from '../src/lib/db/site';

const fetchRobots = async () => (await GET({ cache: { enabled: false } } as any)).text();

describe('robots', () => {
  it('keeps the admin out and has no AI group with nothing hidden', () => {
    expect(robotsTxt([])).toBe('User-agent: *\nDisallow: /admin/\nDisallow: /api/\n');
  });

  it('disallows hidden pages and terms for every AI crawler, not for search engines', async () => {
    const db = siteDb();
    await db.from('entries').insert([
      { type: 'page', slug: 'secret-plans', title: 'Secret', status: 'publish', fields: { seo: { noindex: true } } },
      { type: 'page', slug: 'open-house', title: 'Open', status: 'publish', fields: { seo: { noindex: false } } },
      { type: 'page', slug: 'draft-hidden', title: 'Draft', status: 'draft', fields: { seo: { noindex: true } } },
    ]);
    await db.from('terms').insert({ taxonomy: 'tag', slug: 'internal', name: 'Internal', fields: { seo: { noindex: true } } });
    const txt = await fetchRobots();
    const groups = txt.split('\n\n');
    expect(groups[0]).toBe('User-agent: *\nDisallow: /admin/\nDisallow: /api/');
    for (const bot of AI_CRAWLERS) expect(groups[1]).toContain(`User-agent: ${bot}\n`);
    expect(groups[1]).toContain('Disallow: /secret-plans/');
    expect(groups[1]).toContain('Disallow: /tag/internal/');
    expect(txt).not.toContain('open-house');
    expect(txt).not.toContain('draft-hidden');
    expect(txt).not.toMatch(/Googlebot|Bingbot/);
  });
});
