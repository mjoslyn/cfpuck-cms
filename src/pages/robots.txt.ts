// robots.txt (src/lib/ai-crawlers.ts): the admin and API kept out, and the published entries and the
// terms whose SEO settings hide them from search engines and AI answer engines (`seo.noindex`)
// disallowed for the AI crawlers. Cached like pages, so publishing a change clears it. A site's own
// public/robots.txt is served instead.
import type { APIRoute } from 'astro';
import { siteDb } from '../lib/db/site';
import { Loader, PUBLIC_SCOPE } from '../lib/data';
import { frontPage, permalink, termLink } from '../lib/permalink';
import { robotsTxt } from '../lib/ai-crawlers';
import { BROWSER_CACHE_CONTROL, PAGE_CACHE } from '../lib/cache';

const hidden = (r: { fields: unknown }) => (r.fields as { seo?: { noindex?: unknown } } | null)?.seo?.noindex === true;

export const GET: APIRoute = async ({ cache }) => {
  const db = siteDb();
  const loader = new Loader(db, undefined, PUBLIC_SCOPE);
  const [{ data: entries }, { data: terms }] = await Promise.all([
    db.from('entries').select('id, fields').eq('status', 'publish').not('fields->seo->noindex', 'is', null),
    db.from('terms').select('taxonomy, slug, fields').not('fields->seo->noindex', 'is', null),
  ]);
  const ids = (entries ?? []).filter(hidden).map((r) => r.id as number);
  frontPage.id = (await loader.settings()).site?.front_page_id ?? null;
  const paths = [...(ids.length ? (await loader.entriesByIds(ids)).map((e) => permalink(e)) : []), ...(terms ?? []).filter(hidden).map((t) => termLink(t as { taxonomy: string; slug: string }))];
  if (cache.enabled) cache.set(PAGE_CACHE);
  return new Response(robotsTxt(paths), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': BROWSER_CACHE_CONTROL } });
};
