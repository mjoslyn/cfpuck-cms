// Filters for the page's listing (the collection showing what an archive, term or search page lists):
// a search box with suggestions (search.js), a taxonomy's terms to add as filters (chips), the count
// and Clear. The filters are query-string parameters whose names a block sets, so existing addresses
// keep working (a directory's ?member_cat=51); the page's main query applies them (applyFilters) and
// public/assets/js/collection-filters.js refreshes the listing in place as they change.
import type { Renderer, RenderCtx } from '../env';
import type { QueryArgs } from '../../lib/data';
import type { PuckItem } from '../../lib/puck/types';
import { eachBlock } from '../../lib/puck/tree';
import { esc } from '../html';
import { decodeEntities } from '../../lib/text/entities';
import { isTaxonomy, taxonomyLabel, typeDef } from '../../lib/site';
import { byTermOrder } from '../../lib/permalink';

export interface FilterSpec {
  /** The search parameter ('' for no search box). */
  searchParam: string;
  taxonomy?: string;
  /** The parameter holding the chosen terms (comma-separated ids). */
  termParam?: string;
}

/** A Filters block's settings, with the defaults. */
export function filterSpec(attrs: Record<string, any> = {}): FilterSpec {
  const taxonomy = attrs.taxonomy && isTaxonomy(attrs.taxonomy) ? String(attrs.taxonomy) : undefined;
  return {
    searchParam: attrs.search === false ? '' : String(attrs.searchParam || 'search'),
    taxonomy,
    termParam: taxonomy ? String(attrs.termParam || taxonomy) : undefined,
  };
}

/** The Filters blocks among a page's blocks (read before the page's query runs). */
export function findFilters(items: PuckItem[]): FilterSpec[] {
  const out: FilterSpec[] = [];
  eachBlock(items, (i) => {
    if (i.type === 'collection-filters') out.push(filterSpec(i.props.attrs));
  });
  return out;
}

/** What a request asks for under these filters: the search words and chosen term ids. */
export function activeFilters(spec: FilterSpec, url: URL) {
  const search = spec.searchParam ? (url.searchParams.get(spec.searchParam) ?? '').trim().slice(0, 200) : '';
  const terms = spec.termParam ? (url.searchParams.get(spec.termParam) ?? '').split(',').map((v) => parseInt(v, 10)).filter((n) => n > 0) : [];
  return { search, terms };
}

/** Apply the page's filters to its main query (terms include their descendants). */
export async function applyFilters(args: QueryArgs, ctx: RenderCtx, descendants: (ids: number[]) => Promise<number[]>) {
  for (const spec of (ctx.data.get('filters') as FilterSpec[] | undefined) ?? []) {
    const { search, terms } = activeFilters(spec, ctx.queried.url);
    if (search) args.search = search;
    if (spec.taxonomy && terms.length) {
      const known = (await Promise.all(terms.map((id) => ctx.loader.termById(id)))).filter((t) => t?.taxonomy === spec.taxonomy).map((t) => t!.id);
      if (known.length) args.terms = { ...(args.terms ?? {}), [spec.taxonomy]: await descendants(known) };
    }
  }
}

const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

export const collectionFilters: Renderer = (b, env) => {
  const { ctx } = env;
  const a = b.attrs ?? {};
  const spec = filterSpec(a);
  const { search, terms: active } = activeFilters(spec, ctx.queried.url);
  // The listing's first page: new filters start over (page 3 of the old ones may not exist).
  const path = ctx.queried.url.pathname.replace(/page\/\d+\/?$/, '');
  const listing = ctx.data.get('main-listing') as string | undefined;
  const postType = ctx.queried.postType ?? ctx.data.get('main-type');
  const def = typeof postType === 'string' ? typeDef(postType) : undefined;
  const json = (v: unknown) => esc(JSON.stringify(v));

  let o = `<form class="c-filters${a.className ? ` ${esc(a.className)}` : ''}" method="get" action="${esc(path)}" data-filters${listing ? ` data-target="${esc(listing)}"` : ''}`;
  if (spec.searchParam && a.suggest !== false) {
    o += ` data-live-search data-input="${esc(spec.searchParam)}" data-all="false"${typeof postType === 'string' ? ` data-types="${esc(postType)}"` : ''}${spec.taxonomy ? ` data-taxonomy="${esc(spec.taxonomy)}" data-active-terms="${esc(active.join(','))}"` : ''}`;
  }
  if (spec.termParam) o += ` data-term-param="${esc(spec.termParam)}"`;
  o += '><div class="c-filters__row">';
  if (spec.searchParam) {
    const label = a.placeholder || `Search ${(def?.label ?? 'entries').toLowerCase()}…`;
    o +=
      `<div class="c-filters__search" data-results-anchor>` +
      `<input type="search" name="${esc(spec.searchParam)}" value="${esc(search)}" placeholder="${esc(label)}" aria-label="${esc(label)}" class="c-filters__input" autocomplete="off">` +
      `<button type="submit" class="c-filters__submit" aria-label="Search">${SEARCH_ICON}</button></div>`;
  }
  if (spec.taxonomy && spec.termParam) {
    const counts = (ctx.data.get(`term-counts:${spec.taxonomy}`) as Map<number, number> | undefined) ?? new Map();
    const terms = [...ctx.loader.terms.values()]
      .filter((t) => t.taxonomy === spec.taxonomy && (counts.get(t.id) ?? 0) > 0)
      .sort(byTermOrder)
      .map((t) => ({ id: t.id, name: decodeEntities(t.name), parent: ctx.loader.terms.get(t.parent_id ?? -1)?.id ?? 0, count: counts.get(t.id) }));
    const first = a.termPlaceholder || `All ${taxonomyLabel(spec.taxonomy).toLowerCase()}`;
    const more = a.termMorePlaceholder || `Add another…`;
    o +=
      `<input type="hidden" name="${esc(spec.termParam)}" value="${esc(active.join(','))}">` +
      `<div class="c-filters__terms" data-terms="${json(terms)}" data-active="${json(active)}" data-first="${esc(first)}" data-more="${esc(more)}">` +
      `<select class="c-filters__select" aria-label="${esc(taxonomyLabel(spec.taxonomy))}"><option value="">${esc(active.length ? more : first)}</option>` +
      terms.filter((t) => !active.includes(t.id)).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('') +
      `</select></div>`;
  }
  if (search || active.length) o += `<a href="${esc(path)}" class="c-filters__clear">Clear</a>`;
  o += '</div>';
  if (spec.taxonomy) o += '<div class="c-filters__tags"></div>';
  if (a.count !== false) {
    const found = Number(ctx.data.get('main-found') ?? 0);
    const noun = (found === 1 ? def?.singular : def?.label)?.toLowerCase() ?? (found === 1 ? 'entry' : 'entries');
    o += `<div class="c-filters__count" aria-live="polite">${found.toLocaleString('en-US')} ${esc(noun)}</div>`;
  }
  return `${o}</form>`;
};

export const FILTER_RENDERERS: Record<string, Renderer> = { 'collection-filters': collectionFilters };
