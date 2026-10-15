// Async pass before rendering: resolve template parts, patterns and synced patterns, run queries,
// and preload media and fields. Renderers are synchronous and read everything from ctx.
import { listingImageId, termFieldsFor, termImageId } from '../lib/page-meta';
import type { PuckItem } from '../lib/puck/types';
import type { QueryArgs } from '../lib/data';
import { frontPage } from '../lib/permalink';
import { buildCalendar } from './events/calendar';
import { type CalEvent, loadCalEvents, siteNow } from '../lib/events/model';
import type { RenderCtx } from './env';
import { visibilityPasses } from './blocks/visibility';
import { LISTABLE_TYPES, fieldsFor, searchTypes } from '../lib/site';

/** A type's image fields (top level). */
const imageFields = (type: string) => fieldsFor(type).filter((f) => f.type === 'image').map((f) => f.key);
import { SITE_BLOCKS, SITE_RENDER } from '../lib/site/render';
import type { PrepareTools } from '../lib/site/extend';
import { isShuffled, pageFromUrl } from './c/collection';
import { SWIPER_SCRIPT } from './vendor';
import { MAIN_AREA, areaItems, areaName } from '../lib/content/areas';
import type { Overrides } from '../lib/content/linked-patterns';
import { applyFilters, filterSpec, findFilters } from './c/filters';
import { prepareMap } from './c/map';
import { prepareNavigation } from './c/navigation';
import { prepareTickets, prepareTicketsBlock } from './c/tickets';

interface WalkState {
  /** Counter for unique ids (sliders, content feeds). */
  uid: number;
  /** Media used by image, cover and media & text blocks, loaded in one query. */
  mediaIds: number[];
}

/** Query block attributes -> Loader query args (build_query_vars_from_query_block + theme filters). */
/** Most entries a shuffled collection draws from. */
const SHUFFLE_POOL = 48;

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function queryArgs(attrs: Record<string, any>, ctx: RenderCtx, page: number): Promise<QueryArgs> {
  const q = attrs.query ?? {};
  const terms: Record<string, number[]> = {};
  for (const [tax, ids] of Object.entries(q.taxQuery ?? {})) {
    if (!Array.isArray(ids)) continue;
    const mapped = (await Promise.all(ids.map((id: number) => ctx.loader.termById(Number(id))))).filter(Boolean).map((t) => t!.id);
    if (mapped.length) terms[tax] = mapped;
  }
  const known = async (ids: number[]) => (await ctx.loader.entriesByIds(ids.map(Number))).map((e) => e.id);
  // Hand-picked entries: in the order they were picked, whatever their type.
  const include: number[] = Array.isArray(q.include) ? q.include.map(Number).filter(Boolean) : [];
  const types = Array.isArray(q.postType) ? q.postType : [q.postType ?? 'post'];
  return {
    postType: include.length ? ['page', ...LISTABLE_TYPES] : types,
    perPage: Number(q.perPage) || (include.length ? include.length : 10),
    offset: Number(q.offset) || 0,
    page,
    order: q.order ?? 'desc',
    orderBy: include.length ? 'include' : q.orderBy ?? 'date',
    search: q.search || undefined,
    include: include.length ? include : undefined,
    exclude: q.exclude?.length ? await known(q.exclude) : undefined,
    terms: include.length ? {} : terms,
    upcoming: !include.length && types.length === 1 && types[0] === 'event' && q.upcoming === true,
  };
}

/** The main query (collections listing what the page shows) for archive requests. */
async function mainQueryArgs(ctx: RenderCtx, state: WalkState): Promise<QueryArgs | null> {
  const q = ctx.queried;
  const postType = q.postType ?? 'post';
  const anyType = ['page', ...LISTABLE_TYPES];
  // Search: the types chosen under Settings, best matches first; nothing until there are terms.
  if (q.kind === 'search') return { postType: q.search ? searchTypes(ctx.settings.site) : [], search: q.search, perPage: 10, page: q.page, orderBy: 'relevance', terms: {} };
  if (q.kind !== 'archive' && q.kind !== 'taxonomy') return null;
  const args: QueryArgs = { postType: postType === 'any' ? anyType : postType, perPage: 10, page: q.page, order: 'desc', orderBy: 'date', terms: {} };
  if (q.kind === 'taxonomy' && q.term) args.terms![q.term.taxonomy] = await descendantTermIds(ctx, [q.term.id]);
  // The page's Filters blocks (search words, chosen terms from the query string).
  await applyFilters(args, ctx, (ids) => descendantTermIds(ctx, ids));
  // The site may add its own (e.g. a directory's order, or what shows before any filter).
  await SITE_RENDER.archiveQuery?.(args, ctx, tools(ctx, state));
  return args;
}

async function descendantTermIds(ctx: RenderCtx, roots: number[]): Promise<number[]> {
  const all = await ctx.loader.allTerms();
  const out = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of all) if (t.parent_id && out.has(t.parent_id) && !out.has(t.id)) { out.add(t.id); grew = true; }
  }
  return [...out];
}

/** Entries' featured images and their image fields (as the site config defines them), in one query. */
async function loadEntryMedia(ctx: RenderCtx, ids: number[]) {
  const entries = ids.map((id) => ctx.loader.entries.get(id)).filter(Boolean);
  const imageIds = entries.flatMap((e) => imageFields(e!.type).map((k) => Number(e!.fields?.[k])).filter((n) => n > 0));
  await ctx.loader.loadMedia([...entries.map((e) => e!.featured_media_id!), ...imageIds]);
}

async function loadDoc(ctx: RenderCtx, key: string, fetch: () => Promise<PuckItem[] | null | undefined>, state: WalkState) {
  if (ctx.docs.has(key)) return;
  const items = (await fetch()) ?? [];
  ctx.docs.set(key, items);
  await walk(items, ctx, state);
}

/** The helpers prepare hooks get. */
function tools(ctx: RenderCtx, state: WalkState): PrepareTools {
  return {
    uid: () => ++state.uid,
    loadEntryMedia: (ids) => loadEntryMedia(ctx, ids),
    descendantTermIds: (ids) => descendantTermIds(ctx, ids),
  };
}

async function walk(items: PuckItem[], ctx: RenderCtx, state: WalkState) {
  for (const item of items) {
    const { type, props } = item;
    const attrs = props.attrs ?? {};
    const className = String(attrs.className ?? '');

    switch (type) {
      case 'part':
        await loadDoc(ctx, `part:${attrs.slug}`, async () => (await ctx.loader.template('part', attrs.slug))?.content as PuckItem[], state);
        break;
      case 'pattern':
        await loadDoc(ctx, `pattern:${attrs.slug}`, async () => (await ctx.loader.template('pattern', attrs.slug))?.content as PuckItem[], state);
        // A linked pattern's content changes can bring their own images.
        for (const o of Object.values((attrs.overrides ?? {}) as Overrides)) if (o.mediaId) state.mediaIds.push(Number(o.mediaId));
        break;
      case 'global':
        await loadDoc(ctx, `global:${attrs.ref}`, async () => (await ctx.loader.entryById(Number(attrs.ref), true))?.content?.content as PuckItem[], state);
        break;
      case 'entry-content': {
        // The block's area of the page's content (main: the page's content; others: slots on its root).
        const e = ctx.queried.entry;
        const area = areaName(attrs.area);
        if (e) await loadDoc(ctx, area === MAIN_AREA ? `content:${e.id}` : `content:${e.id}:${area}`, async () => areaItems(e.content, area) as PuckItem[], state);
        break;
      }
      case 'image':
      case 'cover':
      case 'media-text':
      case 'hero':
        // Loaded together at the end of prepare().
        if (attrs.mediaId) state.mediaIds.push(Number(attrs.mediaId));
        if (type === 'cover' && attrs.useFeaturedImage && ctx.queried.entry?.featured_media_id) state.mediaIds.push(ctx.queried.entry.featured_media_id);
        break;
      case 'collection': {
        const page = attrs.query?.inherit ? ctx.queried.page : pageFromUrl(ctx.queried.url, props.id, attrs.queryId);
        ctx.data.set(`page:${props.id}`, page);
        const shuffled = isShuffled(attrs) && !attrs.query?.inherit;
        const args = attrs.query?.inherit ? await mainQueryArgs(ctx, state) : await queryArgs(attrs, ctx, page);
        // Shuffled: a pool of matching entries in the collection's own order, in random order; the
        // page shows the first ones and collection-shuffle.js reshuffles the pool on each visit.
        if (shuffled && args) {
          ctx.data.set(`shuffle:${props.id}`, args.perPage);
          Object.assign(args, { perPage: SHUFFLE_POOL, page: 1 });
        }
        // On a singular request the main query is the queried entry itself.
        const singular = attrs.query?.inherit && ctx.queried.kind === 'singular' && ctx.queried.entry;
        const result = singular ? { ids: [singular.id], total: 1, pages: 1 } : args ? await ctx.loader.query(args) : { ids: [], total: 0, pages: 0 };
        if (shuffled) {
          result.ids = shuffle(result.ids);
          result.pages = 1;
          ctx.headScripts ??= [];
          const tag = '<script src="/assets/js/collection-shuffle.js" defer></script>';
          if (!ctx.headScripts.includes(tag)) ctx.headScripts.push(tag);
        }
        ctx.queries.set(props.id, result);
        if (attrs.query?.inherit) {
          ctx.data.set('main-found', result.total);
          ctx.data.set('main-pages', result.pages);
          ctx.data.set('main-listing', props.id);
          if (args && !Array.isArray(args.postType)) ctx.data.set('main-type', args.postType);
        }
        await loadEntryMedia(ctx, result.ids);
        if (attrs.pagination === 'load-more') {
          ctx.headScripts ??= [];
          const tag = '<script src="/assets/js/collection-more.js" defer></script>';
          if (!ctx.headScripts.includes(tag)) ctx.headScripts.push(tag);
        }
        if (className.includes('is-style-slider') || attrs.variant === 'slider' || attrs.display === 'slider') {
          ctx.data.set(`slider:${props.id}`, `c-slider-${++state.uid}`);
          // Swiper runs the slider: its script, and its stylesheet in <head> (VENDOR_CSS, via ctx.assets).
          ctx.assets.add('swiper');
          if (!ctx.scripts.includes(SWIPER_SCRIPT)) ctx.scripts.push(SWIPER_SCRIPT);
        }
        break;
      }
      case 'form':
        ctx.data.set('forms', await ctx.loader.forms());
        break;
      case 'map':
        await prepareMap(props.id, attrs, ctx);
        break;
      case 'navigation':
        await prepareNavigation(ctx, (ids) => loadEntryMedia(ctx, ids));
        break;
      case 'collection-filters': {
        const spec = filterSpec(attrs);
        if (spec.taxonomy) ctx.data.set(`term-counts:${spec.taxonomy}`, await ctx.loader.termCounts(spec.taxonomy));
        ctx.headScripts ??= [];
        const tag = '<script src="/assets/js/collection-filters.js" defer></script>';
        if (!ctx.headScripts.includes(tag)) ctx.headScripts.push(tag);
        break;
      }
      default:
        // The site's own blocks load what they need.
        await SITE_BLOCKS[type]?.prepare?.(item, ctx, tools(ctx, state));
        break;
      case 'events-calendar':
        ctx.data.set('calendar', await buildCalendar(ctx.queried.url, ctx.loader));
        break;
      case 'event-calendar': {
        // Every event once per request; each block keeps its categories and tags.
        let all = ctx.data.get('cal-events') as CalEvent[] | undefined;
        if (!all) ctx.data.set('cal-events', (all = await loadCalEvents(ctx.loader)));
        const cats: number[] = (attrs.categories ?? []).map(Number);
        const tags: number[] = (attrs.tags ?? []).map(Number);
        const events = all.filter((ev) => (!cats.length || ev.categories.some((c) => cats.includes(c.id))) && (!tags.length || (ev.entry.term_ids ?? []).some((t) => tags.includes(t))));
        const now = siteNow();
        ctx.data.set(`event-calendar:${props.id}`, { events, now, today: now.slice(0, 10) });
        ctx.headScripts ??= [];
        const tag = '<script src="/assets/js/event-calendar.js" defer></script>';
        if (!ctx.headScripts.includes(tag)) ctx.headScripts.push(tag);
        break;
      }
      case 'members':
      case 'member-account':
        // What these show depends on who is viewing.
        ctx.personal = true;
        break;
      case 'tickets': {
        // The Event details block leaves its event's tickets to this one.
        const target = await prepareTicketsBlock(ctx, props.id, attrs);
        if (target?.own) ctx.data.set('tickets-block', true);
        break;
      }
      case 'event-details': {
        const e = ctx.queried.entry;
        if (!e) break;
        await prepareTickets(ctx);
        const venue = Number(e.fields?.venue) || 0;
        if (venue) await ctx.loader.entriesByIds([venue]);
        await loadDoc(ctx, `content:${e.id}`, async () => e.content?.content as PuckItem[], state);
        break;
      }
      case 'gallery':
      case 'video-gallery':
        if (attrs.display === 'slider') {
          ctx.headScripts ??= [];
          const tag = '<script src="/assets/js/gallery-slider.js" defer></script>';
          if (!ctx.headScripts.includes(tag)) ctx.headScripts.push(tag);
        }
        break;
    }

    if (props.children) await walk(props.children, ctx, state);
  }
}

export async function prepare(items: PuckItem[], ctx: RenderCtx) {
  frontPage.id = ctx.settings.site?.front_page_id ?? null;
  await ctx.loader.allTerms();
  const state: WalkState = { uid: 0, mediaIds: [] };
  const e = ctx.queried.entry;
  if (e?.featured_media_id) await ctx.loader.loadMedia([e.featured_media_id]);
  // On a term page, the term's featured image (or its taxonomy's) and image fields, for the blocks showing it.
  const t = ctx.queried.kind === 'taxonomy' ? ctx.queried.term : undefined;
  if (t) {
    const ids = [termImageId(t, ctx.settings.site), ...termFieldsFor(t.taxonomy).filter((f) => f.type === 'image').map((f) => Number(t.fields?.[f.key]))].filter((n): n is number => !!n && n > 0);
    if (ids.length) await ctx.loader.loadMedia(ids);
  }
  // On a type's listing page, its featured image (Settings > Types).
  const listingImage = ctx.queried.kind === 'archive' && ctx.queried.postType ? listingImageId(ctx.settings.site, ctx.queried.postType) : undefined;
  if (listingImage) await ctx.loader.loadMedia([listingImage]);
  // Filters blocks set what the page's main query reads from the URL, so they are found first.
  // A members-only page someone may not see: its prompt depends on who they are.
  if (e?.locked) ctx.personal = true;
  const filters = findFilters(items);
  if (filters.length) ctx.data.set('filters', filters);
  await walk(items, ctx, state);
  if (state.mediaIds.length) await ctx.loader.loadMedia([...new Set(state.mediaIds)]);
}
