// Collections: a list of entries from a query (or the page's own listing), laid out by an item
// template (the card). Settings live on the collection: display (grid, list, slider), columns per
// screen size, pagination (numbers, previous/next, load more) and an empty message. Older collections
// carry these as child blocks (collection-empty, pagination...), which still render. Random order is
// query.orderBy 'rand' (per render). A shuffled collection (shuffle) shows part of a pool drawn in
// prepare(); the rest waits in a <template> for /assets/js/collection-shuffle.js, which reshuffles the
// pool on each visit.
import { esc } from '../html';
import { attrs, alignClass, itemDecls, styleDecls, type Decl } from './style';
import { layout } from './layout';
import type { Env, QueryEnv, Renderer } from '../env';
import type { Entry } from '../../lib/types';
import { taxonomyLabel, typeDef } from '../../lib/site';


/** Title of the archive or taxonomy page being shown. */
export function archiveTitleText(env: Env, showPrefix = true): string {
  const q = env.ctx.queried;
  if (q.kind === 'taxonomy' && q.term) return showPrefix ? `${esc(taxonomyLabel(q.term.taxonomy))}: <span>${esc(q.term.name)}</span>` : esc(q.term.name);
  if (q.kind === 'search') return q.search ? (showPrefix ? `Search results for <span>&#8220;${esc(q.search)}&#8221;</span>` : esc(q.search)) : 'Search';
  if (q.kind === 'archive') {
    const label = typeDef(q.postType ?? '')?.label ?? q.postType ?? '';
    return showPrefix ? `Archives: <span>${esc(label)}</span>` : esc(label);
  }
  return '';
}

const isSlider = (a: Record<string, any>) => a.display === 'slider' || a.variant === 'slider';
/** A new random selection on each visit (see prepare()). */
export const isShuffled = (a: Record<string, any>) => a.shuffle === true;

function root(a: Record<string, any>, base: (string | false | null | undefined)[], extra: Decl[] = []) {
  return attrs([...base, alignClass(a.width), a.style?.background ? 'has-bg' : null, a.className], [...styleDecls(a.style), ...itemDecls(a.item), ...extra], { id: a.anchor });
}

export const collection: Renderer = (b, env, inner) => {
  const { ctx } = env;
  const a = b.attrs;
  const result = ctx.queries.get(b.id) ?? { ids: [], total: 0, pages: 0 };
  const q: QueryEnv = { blockId: b.id, attrs: a, result, page: ctx.data.get(`page:${b.id}`) ?? 1 };

  // Shuffled: the first entries of the pool show; the rest wait in a template for the browser.
  const shown = ctx.data.get(`shuffle:${b.id}`) as number | undefined;
  let pool = '';
  if (shown != null) {
    q.result = { ...result, ids: result.ids.slice(0, shown) };
    const rest = { ...q, result: { ...result, ids: result.ids.slice(shown) } };
    if (!ctx.editor && rest.result.ids.length) pool = `<template class="c-collection__pool">${isSlider(a) ? inner({ query: rest, slider: true }) : inner.each({ query: rest }).join('')}</template>`;
  }
  const shuffleAttr = shown != null ? ` data-shuffle="${shown}"` : '';

  if (isSlider(a)) {
    const slides = inner({ query: q, slider: true });
    if (!slides) return '';
    const perView = Math.max(1, Number(a.columns ?? 1));
    const autoplay = a.autoplay ? 4000 : 0;
    const uid = ctx.data.get(`slider:${b.id}`) as string;
    return (
      `<div class="c-slider" id="${uid}" style="--per-view-md:${Math.min(perView, 2)};--per-view-lg:${perView}"${shuffleAttr}><div class="swiper"><div class="swiper-wrapper">${slides}</div></div><div class="swiper-button-prev"></div><div class="swiper-button-next"></div><div class="swiper-pagination"></div>${pool}</div>` +
      `<script>document.addEventListener("DOMContentLoaded",function(){new Swiper("#${uid} .swiper",{slidesPerView:1,spaceBetween:24,speed:500,loop:true,` +
      (autoplay ? `autoplay:{delay:${autoplay},disableOnInteraction:false},` : '') +
      `pagination:{el:"#${uid} .swiper-pagination",clickable:true},navigation:{nextEl:"#${uid} .swiper-button-next",prevEl:"#${uid} .swiper-button-prev"},` +
      `breakpoints:{768:{slidesPerView:${Math.min(perView, 2)}},1024:{slidesPerView:${perView}}}});});</script>`
    );
  }

  const l = layout(ctx, a.layout ?? { type: 'flow' }, a.gap, a.style?.padding);
  const tag = a.tag && /^(section|main|aside|div|nav)$/.test(a.tag) ? a.tag : 'div';
  const kids = new Set((b.children ?? []).map((c) => c.type));
  let body = inner.each({ query: q }).join('');
  const awaitingSearch = a.query?.inherit && env.ctx.queried.kind === 'search' && !env.ctx.queried.search;
  if (!result.ids.length && a.emptyText && !awaitingSearch && !kids.has('collection-empty')) body += `<p class="c-collection__empty is-message">${esc(a.emptyText)}</p>`;
  if (a.pagination && a.pagination !== 'none' && !kids.has('pagination') && shown == null) body += paginationFor({ ...env, query: q }, a.pagination);
  return `<${tag} ${root(a, ['c-collection', ...l.classes], l.decls)} data-collection="${esc(b.id)}"${shuffleAttr}>${body}${pool}</${tag}>`;
};

/** Pagination from the collection's own setting. */
function paginationFor(env: Env, kind: string): string {
  const q = env.query!;
  if (q.result.pages <= 1) return '';
  if (kind === 'load-more') {
    if (q.page >= q.result.pages) return '';
    return `<div class="c-collection__more"><button type="button" class="c-collection__more-button" data-next="${esc(pageHref(env, q.page + 1))}" data-pages="${q.result.pages}">Load more</button></div>`;
  }
  const prev = q.page > 1 ? `<a href="${esc(pageHref(env, q.page - 1))}" class="c-pagination__previous">Previous Page</a>` : '';
  const next = q.page < q.result.pages ? `<a href="${esc(pageHref(env, q.page + 1))}" class="c-pagination__next">Next Page</a>` : '';
  const numbers = kind === 'numbers' ? `<div class="c-pagination__numbers">${pageNumbers(env, 2)}</div>` : '';
  return `<nav class="c-pagination c-collection__pagination" aria-label="Pagination">${prev}${numbers}${next}</nav>`;
}

/** The item template, repeated per entry. Layout: a list, or a grid of N columns. */
export const collectionItems: Renderer = (b, env, inner) => {
  const { ctx, query: q } = env;
  if (!q || !q.result.ids.length) return '';
  const a = b.attrs;
  const posts = q.result.ids.map((id) => ctx.loader.entries.get(id)).filter(Boolean) as Entry[];
  if (env.slider) return posts.map((post) => `<div class="swiper-slide">${inner({ post, inCard: true })}</div>`).join('');
  // A grid of N columns (one column on phones), or a list with a gap between items.
  let classes: string[];
  let decls: Decl[];
  // Columns and the gap between items are the collection's settings.
  const c = q.attrs;
  const columns = c.display === 'list' ? undefined : c.columns;
  if (columns) {
    // Cards in a row as tall as the tallest, unless the collection turns it off.
    classes = ['is-grid', ...(c.equalHeight === false ? [] : ['has-equal-height'])];
    decls = [['--columns', String(columns)], ['gap', c.itemGap ?? '1.25em']];
    if (c.columnsTablet) decls.push(['--columns-tablet', String(c.columnsTablet)]);
    if (c.columnsMobile) decls.push(['--columns-mobile', String(c.columnsMobile)]);
  } else {
    const l = layout(ctx, a.layout ?? { type: 'flow' }, c.itemGap, a.style?.padding);
    classes = l.classes;
    decls = l.decls;
  }
  let items = posts.map((post) => `<li class="${esc(entryClasses(post))}" data-id="${post.id}">${inner({ post, inCard: true })}</li>`).join('');
  // Listings of the page's own query count as the main loop for image loading.
  if (q.attrs.query?.inherit) items = items.replace(/data-cms-img="attachment"/g, 'data-cms-img="loop"');
  return `<ul ${root(a, ['c-collection__items', ...classes], decls)}>${items}</ul>`;
};

/** Classes on each item: the entry and its type. */
/** A listed entry's classes: its type, and is-featured when its `featured` field is set. */
export const entryClasses = (e: Entry) => `c-entry c-entry--${e.type}${e.fields?.featured === true || e.fields?.featured === '1' ? ' is-featured' : ''}`;

export const collectionEmpty: Renderer = (b, env, inner) => {
  if (!env.query || env.query.result.ids.length > 0) {
    // Rendered for its styles even when the collection has entries.
    inner();
    return '';
  }
  const content = inner();
  if (!content.trim()) return '';
  return `<div ${root(b.attrs, ['c-collection__empty'])}>${content}</div>`;
};

/**
 * The query-string key for a collection's page number: its own, so paging one collection leaves the
 * others on the page alone. From a hash of its block id ("pg-1k3x9zq"); imported collections with
 * a queryId also read their old key ("query-1-page").
 */
export function pageParam(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return `pg-${h.toString(36)}`;
}

/** A collection's page number from the address (1 when none). */
export function pageFromUrl(url: URL, id: string, queryId?: unknown): number {
  const sp = url.searchParams;
  const raw = sp.get(pageParam(id)) ?? (queryId != null ? sp.get(`query-${queryId}-page`) : null) ?? (queryId == null ? sp.get('query-page') : null);
  // Digits only, at most six: anything else (1e20, a number too big for an offset) is page 1.
  return raw && /^\d{1,6}$/.test(raw) ? Math.max(1, parseInt(raw, 10)) : 1;
}


function pageHref(env: Env, n: number) {
  const q = env.query!;
  const url = env.ctx.queried.url;
  if (q.attrs.query?.inherit) {
    // Keep the listing's search and filters (?q=, a directory's filters) on every page.
    const base = url.pathname.replace(/page\/\d+\/$/, '');
    return `${n <= 1 ? base : `${base}page/${n}/`}${url.search}`;
  }
  const key = pageParam(q.blockId);
  const u = new URL(url);
  // The collection's own key only (an old shared one would move the others too).
  if (q.attrs.queryId != null) u.searchParams.delete(`query-${q.attrs.queryId}-page`);
  else u.searchParams.delete('query-page');
  if (n <= 1) u.searchParams.delete(key);
  else u.searchParams.set(key, String(n));
  return `${u.pathname}${u.search}`;
}

export const pagination: Renderer = (b, env, inner) => {
  if (!env.query || env.query.result.pages <= 1) return '';
  const content = inner({ paginationArrow: b.attrs.arrow } as Partial<Env>);
  if (!content.trim()) return '';
  const a = b.attrs;
  const l = layout(env.ctx, { type: 'row', justify: a.justify ?? 'left', ...(a.layout ?? {}) }, a.gap, a.style?.padding);
  return `<nav ${root(a, ['c-pagination', a.justify === 'space-between' ? 'is-spread' : null, ...l.classes], l.decls)} aria-label="Pagination">${content}</nav>`;
};

const ARROWS: Record<string, [string, string]> = { arrow: ['←', '→'], chevron: ['«', '»'] };
function arrow(env: Env, b: { attrs: Record<string, any> }, next: boolean) {
  const kind = (env as any).paginationArrow ?? b.attrs.arrow ?? 'none';
  if (!ARROWS[kind]) return '';
  return `<span class="c-pagination__arrow is-${next ? 'next' : 'previous'}" aria-hidden="true">${ARROWS[kind][next ? 1 : 0]}</span>`;
}

export const paginationNext: Renderer = (b, env) => {
  const q = env.query;
  if (!q || q.page >= q.result.pages) return '';
  return `<a href="${esc(pageHref(env, q.page + 1))}" ${root(b.attrs, ['c-pagination__next'])}>${b.attrs.label || 'Next Page'}${arrow(env, b, true)}</a>`;
};

export const paginationPrevious: Renderer = (b, env) => {
  const q = env.query;
  if (!q || q.page <= 1) return '';
  return `<a href="${esc(pageHref(env, q.page - 1))}" ${root(b.attrs, ['c-pagination__previous'])}>${arrow(env, b, false)}${b.attrs.label || 'Previous Page'}</a>`;
};

/** Page numbers with ellipses. */
export const paginationNumbers: Renderer = (b, env) => {
  const q = env.query;
  if (!q || q.result.pages <= 1) return '';
  return `<div ${root(b.attrs, ['c-pagination__numbers'])}>${pageNumbers(env, b.attrs.midSize ?? 2)}</div>`;
};

function pageNumbers(env: Env, mid: number): string {
  const q = env.query!;
  const total = q.result.pages;
  const links: string[] = [];
  let dots = false;
  for (let n = 1; n <= total; n++) {
    if (n === q.page) {
      links.push(`<span aria-current="page" class="c-page-number is-current">${n}</span>`);
      dots = true;
    } else if (n <= 1 || (n >= q.page - mid && n <= q.page + mid) || n > total - 1) {
      links.push(`<a class="c-page-number" href="${esc(pageHref(env, n))}">${n}</a>`);
      dots = true;
    } else if (dots) {
      links.push('<span class="c-page-number is-dots">&hellip;</span>');
      dots = false;
    }
  }
  return links.join('\n');
}


/** Heading naming the listing being shown (an archive, a term or search results). */
export const archiveTitle: Renderer = (b, env) => {
  const a = b.attrs;
  const kind = env.ctx.queried.kind;
  if (kind !== 'archive' && kind !== 'taxonomy' && kind !== 'search') return '';
  const tag = `h${Math.min(6, Math.max(1, Number(a.level) || 1))}`;
  return `<${tag} ${root(a, ['c-archive-title'])}>${archiveTitleText(env, a.showPrefix !== false)}</${tag}>`;
};

export const COLLECTION_RENDERERS: Record<string, Renderer> = {
  'archive-title': archiveTitle,
  collection,
  'collection-items': collectionItems,
  'collection-empty': collectionEmpty,
  pagination,
  'pagination-next': paginationNext,
  'pagination-previous': paginationPrevious,
  'pagination-numbers': paginationNumbers,
};
