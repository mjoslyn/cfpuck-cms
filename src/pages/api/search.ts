// Live search for the search forms (public/assets/js/search.js):
//   GET /api/search?q=<terms>[&limit=6][&types=member,event][&taxonomy=member_category]
// The same matching and ranking as the /search/ page, as JSON: the best matches with their type, URL
// and a short excerpt, and the total. The types are those chosen under Settings, unless `types` names
// others (types with pages of their own); with `taxonomy`, the terms of it whose names match come too
// (those in use), so a filter can offer them. A signed-in visitor also gets the members-only entries
// they may see, in an answer for them only.
import { BROWSER_CACHE_CONTROL, PAGE_CACHE_TAG } from '../../lib/cache';
import type { APIRoute } from 'astro';
import { siteDb } from '../../lib/db/site';
import { featuresOf, offTypes } from '../../lib/features';
import { Loader, PUBLIC_SCOPE } from '../../lib/data';
import { hasSession, siteViewer } from '../../lib/members/viewer';
import { permalink, termLink } from '../../lib/permalink';
import { COMPOSABLE_TYPES, isTaxonomy, searchTypes, taxonomySingular, typeDef } from '../../lib/site';
import { decodeEntities } from '../../lib/text/entities';
import { termPagesOn } from '../../lib/templates';

const plain = (html: string) => decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s);
const PAGE_TYPES = new Set(COMPOSABLE_TYPES.map((t) => t.type));
const TERM_LIMIT = 5;

export const GET: APIRoute = async ({ url, request, cache }) => {
  // Only for a visitor with a sign-in cookie does the answer depend on who asks (members-only entries).
  const signedIn = hasSession(request);
  // Otherwise cached at the CDN like the pages, and cleared with them after edits (src/lib/cache.ts).
  if (cache.enabled && !signedIn) cache.set({ maxAge: 60, swr: 600, tags: [PAGE_CACHE_TAG] });
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const limit = Math.min(10, Math.max(1, parseInt(url.searchParams.get('limit') ?? '6', 10) || 6));
  const asked = (url.searchParams.get('types') ?? '').split(',').map((t) => t.trim()).filter((t) => PAGE_TYPES.has(t));
  const taxonomy = url.searchParams.get('taxonomy') ?? '';
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': signedIn ? 'private, no-store' : BROWSER_CACHE_CONTROL,
    'X-Robots-Tag': 'noindex',
  };
  const none = { q, total: 0, results: [], terms: [] };
  if (q.length < 2) return new Response(JSON.stringify(none), { headers });
  const loader = new Loader(siteDb(), undefined, { ...PUBLIC_SCOPE, viewer: signedIn ? await siteViewer(request) : null });
  // Events or Shop off: none of theirs found.
  loader.scope!.off = offTypes(featuresOf((await loader.settings()).site));
  const types = asked.length ? asked : searchTypes((await loader.settings()).site);

  // Terms of the taxonomy whose names hold the words, in use, by name.
  let terms: { id: number; title: string; url: string; type: string }[] = [];
  if (taxonomy && isTaxonomy(taxonomy)) {
    const counts = await loader.termCounts(taxonomy);
    // Without term pages a term is still offered (a filter can take it), with no address.
    const pagesOn = termPagesOn((await loader.settings()).site, taxonomy);
    const needle = q.toLowerCase();
    terms = (await loader.allTerms())
      .filter((t) => t.taxonomy === taxonomy && (counts.get(t.id) ?? 0) > 0 && decodeEntities(t.name).toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, TERM_LIMIT)
      .map((t) => ({ id: t.id, title: decodeEntities(t.name), url: pagesOn ? termLink(t) : '', type: taxonomySingular(taxonomy) }));
  }

  if (!types.length) return new Response(JSON.stringify({ ...none, terms }), { headers });
  const found = await loader.query({ postType: types, search: q, perPage: limit, page: 1, orderBy: 'relevance', terms: {} });
  const results = found.ids
    .map((id) => loader.entries.get(id))
    .filter((e) => !!e)
    .map((e) => ({
      id: e!.id,
      title: plain(e!.title_rendered ?? e!.title) || '(untitled)',
      url: permalink(e!),
      type: typeDef(e!.type)?.singular ?? e!.type,
      excerpt: clip(plain(e!.excerpt_rendered ?? e!.excerpt ?? ''), 110),
    }));
  return new Response(JSON.stringify({ q, total: found.total, results, terms }), { headers });
};
