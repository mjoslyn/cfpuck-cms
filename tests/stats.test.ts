// Site statistics (src/lib/stats.ts): page views, visitors once a day, links clicked and referring sites,
// counted from the browser's reports; addresses that aren't pages, machines and made-up flood rows aren't.
import { describe, expect, it } from 'vitest';
import { serviceClient, sessionDb, siteDb } from '../src/lib/db/site';
import { STATS_DAY_ROWS } from '../src/lib/db/functions';
import { pruneStats, recordHit, referrerHost, statPath, statsCsv, statsRange, statsSummary, statTarget, statsDay } from '../src/lib/stats';

const last = (days: number, when: Date) => statsRange(new URLSearchParams({ days: String(days) }), when);
import { renderRequest } from '../src/render/page';

const at = new Date('2026-11-04T15:00:00Z');
const req = (ua = 'Mozilla/5.0 (Macintosh) Safari/605', ip = '203.0.113.7') => new Request('https://site.test/api/stats', { method: 'POST', headers: { 'user-agent': ua, 'cf-connecting-ip': ip } });

describe('site stats', () => {
  it('keeps only page addresses and strips queries from links', () => {
    expect(statPath('/about/?utm=x#top')).toBe('/about/');
    expect(statPath('/admin/')).toBe('');
    expect(statPath('//evil.test/')).toBe('');
    expect(statPath('https://site.test/')).toBe('');
    expect(statTarget('https://Example.org/shop?token=secret#x', 'https://site.test')).toBe('example.org/shop');
    expect(statTarget('/contact/?q=1', 'https://site.test')).toBe('/contact/');
    expect(statTarget('https://site.test/media/2026/menu.pdf', 'https://site.test')).toBe('/media/2026/menu.pdf');
    expect(statTarget('mailto:hello@site.test?subject=Hi', 'https://site.test')).toBe('mailto:hello@site.test');
    expect(statTarget('javascript:alert(1)', 'https://site.test')).toBe('');
    expect(referrerHost('https://www.google.com/search?q=x', 'https://site.test')).toBe('google.com');
    expect(referrerHost('https://site.test/other/', 'https://site.test')).toBe('');
  });

  it('counts views, visitors once a day, clicks and referrers', async () => {
    const db = serviceClient();
    await recordHit(db, { t: 'view', p: '/', r: 'https://www.google.com/' }, req(), at);
    await recordHit(db, { t: 'view', p: '/about/' }, req(), at);
    await recordHit(db, { t: 'view', p: '/' }, req('Mozilla/5.0 (iPhone) Safari', '198.51.100.2'), at);
    await recordHit(db, { t: 'click', p: '/', h: 'https://example.org/tickets?id=9' }, req(), at);
    await recordHit(db, { t: 'click', p: '/about/', h: 'https://example.org/tickets' }, req(), at);
    expect(await recordHit(db, { t: 'view', p: '/' }, req('Googlebot/2.1 (+http://www.google.com/bot.html)'), at)).toBe(false);
    expect(await recordHit(db, { t: 'view', p: '/admin/' }, req(), at)).toBe(false);

    const s = await statsSummary(db, last(7, at));
    expect(s.to).toBe(statsDay(at));
    expect(s.daily).toHaveLength(7);
    expect(s.totals).toEqual({ views: 3, visitors: 2, clicks: 2 });
    expect(s.pages).toEqual([{ path: '/', views: 2, clicks: 1 }, { path: '/about/', views: 1, clicks: 1 }]);
    expect(s.links).toEqual([{ target: 'example.org/tickets', clicks: 2, pages: 2 }]);
    expect(s.referrers).toEqual([{ host: 'google.com', visits: 1 }]);

    // The next day the same visitor counts again; the old day's hashes go.
    const next = new Date(at.getTime() + 86_400_000);
    await recordHit(db, { t: 'view', p: '/' }, req(), next);
    expect(await pruneStats(db, next)).toMatch(/^2 visitor hashes/);
    expect((await statsSummary(db, last(7, next))).totals.visitors).toBe(3);
  });

  it('lists every page by clicks, takes chosen dates and exports CSV', async () => {
    const db = serviceClient();
    const day = new Date('2026-09-10T15:00:00Z');
    await recordHit(db, { t: 'view', p: '/a/' }, req(), day);
    await recordHit(db, { t: 'view', p: '/a/' }, req(), day);
    await recordHit(db, { t: 'click', p: '/b/', h: '=cmd|x' }, req(), day);
    await recordHit(db, { t: 'click', p: '/b/', h: '/a/' }, req(), day);
    const range = statsRange(new URLSearchParams({ from: '2026-09-12', to: '2026-09-08' }), at);
    expect(range).toEqual({ from: '2026-09-08', to: '2026-09-12', days: 5, preset: null });
    expect((await statsSummary(db, range, 'clicks')).pages).toEqual([{ path: '/b/', views: 0, clicks: 2 }, { path: '/a/', views: 2, clicks: 0 }]);
    expect((await statsSummary(db, range, 'views')).pages[0].path).toBe('/a/');
    // Dates past today stop at today; a range too long is cut; bad dates fall back to 30 days.
    expect(statsRange(new URLSearchParams({ from: '2020-01-01', to: '2030-01-01' }), at)).toMatchObject({ to: '2026-11-04', days: 731 });
    expect(statsRange(new URLSearchParams({ from: '2026-02-30', to: 'x' }), at)).toMatchObject({ days: 30, preset: 30 });
    const csv = statsCsv(await statsSummary(db, range, 'clicks'), 'links');
    expect(csv).toContain('Link,Clicks,Pages clicked from\r\n');
    expect(csv).toContain('/a/,1,1');
    expect(statsCsv({ ...(await statsSummary(db, range)), links: [{ target: '=HYPERLINK("x")', clicks: 1, pages: 1 }] }, 'links')).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('stops adding rows to a day past its limit, still counting the ones it has', async () => {
    const db = serviceClient();
    const day = '2026-10-01';
    const rows = Array.from({ length: STATS_DAY_ROWS }, (_, i) => ({ day, kind: 'view', path: `/p${i}/`, target: '', hits: 1 }));
    for (let i = 0; i < rows.length; i += 500) await db.from('site_stats').insert(rows.slice(i, i + 500));
    await db.rpc('stat_hit', { kind: 'view', day, path: '/new-one/' });
    await db.rpc('stat_hit', { kind: 'view', day, path: '/p1/' });
    const { data } = await db.from('site_stats').select('path, hits').eq('day', day).in('path', ['/new-one/', '/p1/']);
    expect(data).toEqual([{ path: '/p1/', hits: 2 }]);
  });

  it('is read by editors, written only by the server, and reported from public pages', async () => {
    const editor = sessionDb({ role: 'editor', uid: '00000000-0000-0000-0000-000000000001' });
    expect((await editor.from('site_stats').select('day').limit(1)).error).toBeNull();
    expect((await editor.rpc('stats_summary', { from: '2026-11-01', to: '2026-11-04' })).error).toBeNull();
    expect((await editor.from('site_stats').insert({ day: '2026-11-04', kind: 'view', path: '/x/', hits: 99 })).error).not.toBeNull();
    expect((await editor.rpc('stat_hit', { kind: 'view', day: '2026-11-04', path: '/x/' })).error).not.toBeNull();
    await siteDb().from('entries').insert({ type: 'page', slug: 'stats-counted', title: 'Counted', status: 'publish', content: { content: [], root: { props: {} } } });
    const page = await renderRequest(new URL('http://localhost/stats-counted/'), siteDb());
    expect(page.status).toBe(200);
    expect(page.html).toContain('/assets/js/stats.js');
    const missing = await renderRequest(new URL('http://localhost/no-such-page-here/'), siteDb());
    expect(missing.html).not.toContain('/assets/js/stats.js');
  });
});
