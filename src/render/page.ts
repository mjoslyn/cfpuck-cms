// Request -> full HTML document:
// resolve the queried object, pick a template via the template hierarchy, render blocks,
// then texturize the result (get_the_block_template_html) and wrap it in the page shell.
import { VENDOR_CSS } from './vendor';
import type { Db } from '../lib/db/query';
import { Loader } from '../lib/data';
import { recurrenceOf, expandEntry, defaultHorizon } from '../lib/recurrence';
import { permalink } from '../lib/permalink';
import { SITE_RENDER } from '../lib/site/render';
import { site, ARCHIVE_PATHS, PAGELESS_TYPES, RECORD_TYPES, TAXONOMY_BASES, TYPE_BASES, termPageType } from '../lib/site';
import { texturize } from '../lib/text/formatting';
import { optimizeImages } from '../lib/media/image';
// The site stylesheet (Tailwind, compiled by Vite); linked after the legacy bundles.
import siteCss from '../styles/site.css?url';
import { modernizeImages } from '../lib/media/modernize';
import { esc } from './html';
import { headMeta } from './meta';
import { findRedirect } from '../lib/redirects';
import { safeDecode } from '../lib/url';
import { chosenTemplate, defaultTaxonomyTemplates, defaultTemplates, listingOn, termPagesOn, termTemplate, type TaxonomyTemplates, type TemplateMap } from '../lib/templates';
import { seoOf } from '../lib/seo';
import { listingSeo, termSeo } from '../lib/page-meta';
import type { PuckItem } from '../lib/puck/types';
import type { Entry, Term } from '../lib/types';
import type { Queried, RenderCtx } from './env';
import { prepare } from './prepare';
import { renderItems } from './engine';
import { bodyClasses } from './body-classes';
import { archiveTitleText as archiveTitle } from './c/collection';
import './blocks';
import type { FormResult } from '../lib/forms/types';
import { ACCOUNT_PATH, memberSettings, type Viewer } from '../lib/members/config';
import { eventsOn } from '../lib/events/on';
import { featuresOf, offTypes } from '../lib/features';
import { CART_PATH, shopOn } from '../lib/shop/config';
import { PREFERENCES_PATH, SUBSCRIBE_PATH, UNSUBSCRIBE_PATH, mailingOn } from '../lib/mailing/config';


export interface PageResult {
  status: number;
  html: string;
  /** The page depends on who views it (RenderCtx.personal): not cached, rendered again for a signed-in visitor. */
  personal?: boolean;
  /** The page's entry is members-only and this render's viewer may not see it (Entry.locked). */
  locked?: boolean;
  /** Set when a missing URL has an obvious new home (guess404: a unique slug match). */
  location?: string;
}

/** redirect_guess_404_permalink(): a published entry whose slug starts with the requested one. */
async function guess404(url: URL, loader: Loader): Promise<string | null> {
  const parts = safeDecode(url.pathname).split('/').filter(Boolean);
  const slug = parts[parts.length - 1];
  if (!slug || slug.length < 2) return null;
  // The rewrite base (e.g. /event/) sets post_type, which limits the guess to that type.
  const typed = parts.length === 2 ? Object.entries(TYPE_BASES).find(([, base]) => base === parts[0])?.[0] : undefined;
  const settings = await loader.settings();
  // Types with pages to go to: a feature's have none while it is off (Settings > Events, Settings > Shop).
  const off = offTypes(featuresOf(settings.site));
  const types = (typed ? [typed] : [...ROOT_TYPES, ...Object.keys(TYPE_BASES)]).filter((t) => !PAGELESS_TYPES.has(t) && !off.includes(t));
  if (!types.length) return null;
  const { data } = await loader.db
    .from('entries')
    .select('id, type, slug')
    .eq('status', 'publish')
    .in('type', types)
    .like('slug', `${slug.replace(/[%_]/g, '\\$&')}%`)
    .order('id')
    .limit(1);
  const hit = data?.[0];
  if (!hit) return null;
  return hit.id === settings.site?.front_page_id ? '/' : permalink(hit);
}

/** Listing pages by path ("/directory/" -> member). */
const ARCHIVES: Record<string, string> = Object.fromEntries(Object.entries(ARCHIVE_PATHS).map(([type, path]) => [path, type]));
const BASE_TYPES = Object.fromEntries(Object.entries(TYPE_BASES).map(([type, base]) => [base, type]));
/** Types served at the site root (/<slug>/): public types without a URL base, pages first. */
const ROOT_TYPES = site.types.filter((t) => !t.base && !PAGELESS_TYPES.has(t.type)).map((t) => t.type);
/** Term pages, longest base first ("directory/category" before "category"). */
const TAXONOMY_ROUTES = Object.entries(TAXONOMY_BASES)
  .map(([taxonomy, b]) => ({ taxonomy, base: b.split('/').filter(Boolean) }))
  .sort((a, b) => b.base.length - a.base.length);
const EVENTS_BASE = (ARCHIVE_PATHS.event ?? '/events/').split('/').filter(Boolean)[0];

export async function resolve(url: URL, loader: Loader): Promise<Queried> {
  let path = safeDecode(url.pathname);
  let page = 1;
  const paged = path.match(/^(.*\/)page\/(\d+)\/?$/);
  if (paged) {
    // A page number past six digits is past any listing's end (and too big for an offset).
    if (paged[2].length > 6) return { kind: '404', page: 1, url };
    path = paged[1];
    page = parseInt(paged[2], 10);
  }
  const parts = path.split('/').filter(Boolean);
  const base: Queried = { kind: '404', page, url };
  const settings = await loader.settings();
  // Events or Shop off: their listings, calendar views, term pages and pages are Not found.
  const events = eventsOn(settings.site);
  const off = offTypes(featuresOf(settings.site));

  if (!parts.length) {
    const id = settings.site?.front_page_id;
    const entry = id ? await loader.entryById(id) : null;
    return entry ? { ...base, kind: 'singular', entry, isFront: true } : base;
  }
  // Search results: /search/?q=<terms>.
  if (parts.length === 1 && parts[0] === 'search') return { ...base, kind: 'search', search: (url.searchParams.get('q') ?? '').trim().slice(0, 200) };
  // Listing pages that are on (Settings > Types); a page may take the address of one that is off.
  const archive = ARCHIVES[`/${parts.join('/')}/`];
  if (archive && listingOn(settings.site, archive) && !off.includes(archive)) return { ...base, kind: 'archive', postType: archive };
  // Calendar views: /events/past/, /events/month/[Y-m/], /events/today/, /events/day/Y-m-d/.
  if (parts[0] === EVENTS_BASE && ['past', 'month', 'today', 'day'].includes(parts[1]) && listingOn(settings.site, 'event') && events) {
    return { ...base, kind: 'archive', postType: 'event' };
  }
  // Term pages (/directory/category/<slug>/, /tag/<slug>/...): the entries with the term.
  // A taxonomy whose pages are off: its addresses are treated like any other (a page there, or Not found).
  const route = TAXONOMY_ROUTES.find((r) => parts.length === r.base.length + 1 && r.base.every((seg, i) => parts[i] === seg) && termPagesOn(settings.site, r.taxonomy) && !off.includes(termPageType(r.taxonomy)));
  if (route) {
    const term = await loader.termBySlug(route.taxonomy, parts[parts.length - 1]);
    return term ? { ...base, kind: 'taxonomy', term, postType: termPageType(route.taxonomy) } : base;
  }
  // Records (venues) have no page of their own: their URLs serve the front page.
  if (parts.length <= 2 && [...RECORD_TYPES].some((t) => TYPE_BASES[t] === parts[0])) return resolve(new URL('/', url), loader).then((q) => ({ ...q, url }));
  if (off.includes(BASE_TYPES[parts[0]])) return base;
  if (parts.length === 2 && BASE_TYPES[parts[0]]) {
    const entry = (await loader.entry(BASE_TYPES[parts[0]], parts[1])) ?? (await loader.lockedEntry([BASE_TYPES[parts[0]]], parts[1]));
    // A recurring series has no page of its own; send visitors to the next occurrence.
    const occurrences = entry && recurrenceOf(entry) ? expandEntry(entry, defaultHorizon(loader.now)) : null;
    if (occurrences?.length) {
      const next = occurrences.find((o) => Date.parse(o.event_end ?? o.event_start!) >= loader.now.getTime()) ?? occurrences[occurrences.length - 1];
      return { ...base, redirect: permalink(next) };
    }
    return entry ? { ...base, kind: 'singular', entry } : base;
  }
  // Recurring event occurrences: /event/<slug>/<Y-m-d>/.
  if (parts.length === 3 && parts[0] === TYPE_BASES.event && /^\d{4}-\d{2}-\d{2}$/.test(parts[2])) {
    const series = await loader.entry('event', parts[1]);
    const occ = series && recurrenceOf(series) ? expandEntry(series, defaultHorizon(loader.now)).find((o) => o.occurrence === parts[2]) : null;
    // An occurrence of a members-only series the viewer may not see: its sign-in prompt.
    const locked = series ? null : await loader.lockedEntry(['event'], parts[1], parts[2]);
    if (locked) return { ...base, kind: 'singular', entry: locked };
    if (!occ) return base;
    // The occurrence is its own (virtual) entry, so loops over the main query see its dates.
    loader.entries.set(occ.id, occ);
    return { ...base, kind: 'singular', entry: occ };
  }
  const slug = parts[parts.length - 1];
  const entry = (await loader.entry(ROOT_TYPES, slug)) ?? (await loader.lockedEntry(ROOT_TYPES, slug));
  if (entry) return { ...base, kind: 'singular', entry };
  // The members' account page, unless a page has its address.
  if (`/${parts.join('/')}/` === ACCOUNT_PATH && memberSettings(settings.site).enabled) return { ...base, kind: 'singular', entry: accountPage() };
  // Mailing's pages (signing up, unsubscribing, email preferences), unless a page has the address.
  const mailing = MAILING_PAGES[`/${parts.join('/')}/`];
  if (mailing && mailingOn(settings.site)) return { ...base, kind: 'singular', entry: builtInPage(mailing.slug, mailing.title, mailing.block) };
  // The shop's cart, unless a page has its address.
  if (`/${parts.join('/')}/` === CART_PATH && shopOn(settings.site)) return { ...base, kind: 'singular', entry: cartPage() };
  return base;
}

/** Mailing's built-in pages: a page holding one block. */
const MAILING_PAGES: Record<string, { slug: string; title: string; block: { type: string; attrs: Record<string, unknown> } }> = {
  [SUBSCRIBE_PATH]: { slug: SUBSCRIBE_PATH.split('/').filter(Boolean).pop()!, title: 'Subscribe', block: { type: 'subscribe', attrs: { heading: 'Get our email', showName: true } } },
  [UNSUBSCRIBE_PATH]: { slug: UNSUBSCRIBE_PATH.split('/').filter(Boolean).pop()!, title: 'Unsubscribe', block: { type: 'mail-preferences', attrs: { view: 'unsubscribe' } } },
  [PREFERENCES_PATH]: { slug: PREFERENCES_PATH.split('/').filter(Boolean).pop()!, title: 'Email preferences', block: { type: 'mail-preferences', attrs: {} } },
};

/** A built-in page (no stored entry): a page with one block, not for search engines. */
function builtInPage(slug: string, title: string, block: { type: string; attrs: Record<string, unknown> }): Entry {
  const now = new Date().toISOString();
  return {
    id: 0, type: 'page', slug, title, title_rendered: null, excerpt: '', excerpt_rendered: null,
    status: 'publish', template: null, parent_id: null, menu_order: 0, featured_media_id: null, fields: { seo: { noindex: true } },
    content: { root: { props: {} }, content: [{ type: block.type, props: { id: block.type, attrs: block.attrs } }] } as any,
    event_start: null, event_end: null, event_all_day: null, published_at: now, updated_at: now, term_ids: [],
  };
}

/** The cart when no page has its address: a heading and a Cart block, in a padded column. */
function cartPage(): Entry {
  const page = builtInPage(CART_PATH.split('/').filter(Boolean).pop()!, 'Your cart', { type: 'cart', attrs: {} });
  const pad = { top: 'var(--space-70)', right: 'var(--space-50)', bottom: 'var(--space-80)', left: 'var(--space-50)' };
  (page.content as any).content = [
    { type: 'section', props: { id: 'cart-page', attrs: { layout: { type: 'constrained', contentSize: '960px' }, style: { padding: pad }, gap: 'var(--space-50)' }, children: [
      { type: 'heading', props: { id: 'cart-title', attrs: { content: 'Your cart', level: 1 } } },
      { type: 'cart', props: { id: 'cart', attrs: {} } },
    ] } },
  ];
  return page;
}

/** The account page when no page has its address: a page holding a Member account block. */
function accountPage(): Entry {
  const now = new Date().toISOString();
  return {
    id: 0, type: 'page', slug: ACCOUNT_PATH.split('/').filter(Boolean).pop()!, title: 'Your account', title_rendered: null, excerpt: '', excerpt_rendered: null,
    status: 'publish', template: null, parent_id: null, menu_order: 0, featured_media_id: null, fields: { seo: { noindex: true } },
    content: { root: { props: {} }, content: [{ type: 'member-account', props: { id: 'member-account', attrs: {} } }] } as any,
    event_start: null, event_end: null, event_all_day: null, published_at: now, updated_at: now, term_ids: [],
  };
}

/**
 * The templates to try for a request, most specific first: an entry's own (the template chosen on the
 * entry, a slug-specific one), then the one chosen for its type under Settings > Types, then the defaults.
 */
export function templateCandidates(q: Queried, map: TemplateMap = {}, tax: { templates?: TaxonomyTemplates; terms?: Map<number, Term> } = {}): string[] {
  const e = q.entry;
  const chosen = (type: string, kind: 'single' | 'archive') => {
    const t = chosenTemplate(map, type, kind);
    return t ? [t] : [];
  };
  if (q.kind === 'singular' && e) {
    if (e.type === 'page') {
      const custom = e.template && e.template !== 'default' ? [e.template] : [];
      return [...custom, `page-${e.slug}`, `page-${e.id}`, ...chosen('page', 'single'), ...defaultTemplates('page', 'single')];
    }
    const custom = e.template && e.template !== 'default' ? [e.template] : [];
    return [...custom, ...(e.type === 'event' ? [] : [`single-${e.type}-${e.slug}`]), ...chosen(e.type, 'single'), ...defaultTemplates(e.type, 'single')];
  }
  if (q.kind === 'archive') return [...chosen(q.postType ?? 'post', 'archive'), ...defaultTemplates(q.postType ?? 'post', 'archive')];
  if (q.kind === 'taxonomy' && q.term) {
    // The term's own template (or the nearest term above it with one), its slug's, its taxonomy's.
    const own = tax.terms ? termTemplate(q.term, tax.terms) : null;
    const chosenTax = tax.templates?.[q.term.taxonomy];
    return [...(own ? [own.slug] : []), `taxonomy-${q.term.taxonomy}-${q.term.slug}`, ...(chosenTax ? [chosenTax] : []), ...defaultTaxonomyTemplates(q.term.taxonomy)];
  }
  if (q.kind === 'search') return ['search', 'index'];
  return ['404', 'index'];
}

/**
 * What the editor bar (/assets/js/editor-bar.js, shown to signed-in editors) links to: the entry shown
 * (a recurring event's series) and the template used. Nothing on previews, which have their own bar.
 */
function editTargets(q: Queried, templateSlug: string, preview: boolean): string {
  if (preview) return '';
  const e = q.kind === 'singular' ? q.entry : undefined;
  const id = e ? (e.series_id ?? e.id) : undefined;
  return `${id && id > 0 ? ` data-edit-entry="${id}"` : ''}${templateSlug ? ` data-edit-template="${esc(templateSlug)}"` : ''}`;
}

/** A search title set for a term page or a type's listing page (on its own address, not a search in it). */
function ownTitle(q: Queried, site: Record<string, any>): string | undefined {
  if (q.kind === 'taxonomy' && q.term) return termSeo(q.term, site).title;
  if (q.kind === 'archive' && q.postType && !q.url.searchParams.get('q')) return listingSeo(site, q.postType, ARCHIVE_PATHS[q.postType] === q.url.pathname).title;
  return undefined;
}

function documentTitle(q: Queried, site: Record<string, any>): string {
  const name = site.name ?? '';
  if (q.isFront) return seoOf(q.entry?.fields).title ? `${esc(seoOf(q.entry?.fields).title!)} &#8211; ${name}` : `${name} &#8211; ${site.description ?? ''}`;
  if (q.kind === 'singular' && q.entry) return `${seoOf(q.entry.fields).title ? esc(seoOf(q.entry.fields).title!) : (q.entry.title_rendered ?? q.entry.title)} &#8211; ${name}`;
  if (q.kind === 'search') return q.search ? `Search results for &#8220;${esc(q.search)}&#8221; &#8211; ${name}` : `Search &#8211; ${name}`;
  const own = ownTitle(q, site);
  if (own) return `${esc(own)} &#8211; ${name}`;
  if (q.kind === 'archive' || q.kind === 'taxonomy') {
    const t = archiveTitle({ ctx: { queried: q } } as any, false).replace(/<[^>]*>/g, '');
    return `${t} &#8211; ${name}`;
  }
  return `Page not found &#8211; ${name}`;
}

/** Third-party stylesheets (CDN) a page needs besides site.css. */
export { VENDOR_CSS };

/** The vendor stylesheets this page needs: Swiper with a slider, Leaflet with a map. */
export function vendorCss(ctx: RenderCtx): string[] {
  return Object.keys(VENDOR_CSS).filter((name) => ctx.assets.has(name));
}

/** Preview: render this entry (unsaved content and fields included), optionally with an edited template. */
export interface PreviewOverride {
  entry: Entry;
  template?: PuckItem[];
}

/** The page chosen as the site's Not found page (settings.site.not_found_page_id), while it is published. */
export async function notFoundPage(site: Record<string, any> | undefined, loader: Loader): Promise<Entry | null> {
  const id = Number(site?.not_found_page_id) || 0;
  return id ? loader.entryById(id) : null;
}

export async function renderRequest(url: URL, db: Db, form?: FormResult, preview?: PreviewOverride, viewer?: Viewer | null): Promise<PageResult> {
  // The site's view: published entries, members-only ones for whoever may see them. Previews read with
  // the editor's own session, whose database policies decide instead.
  const loader = new Loader(db, undefined, preview ? undefined : { published: true, viewer });
  const settings = await loader.settings();
  // A member counts as one only while Members is on.
  const who = viewer && !memberSettings(settings.site).enabled ? { ...viewer, member: null } : viewer;
  if (loader.scope) Object.assign(loader.scope, { viewer: who, off: offTypes(featuresOf(settings.site)) });
  let queried: Queried = preview ? { kind: 'singular', entry: preview.entry, page: 1, url, isFront: settings.site?.front_page_id === preview.entry.id } : await resolve(url, loader);
  if (queried.redirect) return { status: 302, html: '', location: queried.redirect };
  if (queried.kind === '404' && url.pathname !== '/__not-found__/') {
    // The editors' redirects first (/admin/redirects/), then a guess from the address.
    const redirect = await findRedirect(db, url.pathname);
    if (redirect) {
      await db.rpc('redirect_hit', { redirect_id: redirect.rule.id });
      const target = redirect.location.includes('?') || !url.search ? redirect.location : `${redirect.location}${url.search}`;
      return { status: redirect.rule.status, html: '', location: target };
    }
    const guess = await guess404(url, loader);
    if (guess && guess !== url.pathname) return { status: 301, html: '', location: guess };
  }
  // Nothing here: the site's Not found page (Settings > General), if one is set and published, else the
  // 404 template.
  if (queried.kind === '404') {
    const entry = await notFoundPage(settings.site, loader);
    if (entry) queried = { kind: 'singular', entry, page: 1, url, notFound: true };
  }
  const ctx: RenderCtx = { loader, queried, settings, queries: new Map(), docs: new Map(), css: [], assets: new Set(), data: new Map(), scripts: [], rendered: [], viewer: who ?? null };

  if (form) ctx.data.set('form-result', form);
  let template: PuckItem[] | null = preview?.template ?? null;
  let templateSlug = '';
  // A term page's template can come from the terms above it.
  if (queried.kind === 'taxonomy') await loader.allTerms();
  for (const slug of template ? [] : templateCandidates(queried, settings.site?.templates, { templates: settings.site?.taxonomy_templates, terms: loader.terms })) {
    const doc = await loader.template('template', slug);
    if (doc) {
      template = doc.content as PuckItem[];
      templateSlug = slug;
      break;
    }
  }
  await prepare(template ?? [], ctx);
  // A list (or a picked entry) left out members-only entries: a member's view of the page differs (while
  // Members is off nobody is one, and the page stays shared).
  if (loader.hidMembersOnly && memberSettings(settings.site).enabled) ctx.personal = true;
  // A listing page past the last one is not found (page 1 of an empty listing is fine).
  const pages = ctx.data.get('main-pages') as number | undefined;
  if (!preview && queried.kind !== 'singular' && queried.page > 1 && pages !== undefined && queried.page > pages) {
    return renderRequest(new URL('/__not-found__/', url), db, form, undefined, viewer);
  }

  // Block themes run the main loop on singular requests, which drives image loading attributes.
  const body = await modernizeImages(optimizeImages(texturize(renderItems(template ?? [], { ctx, post: queried.entry ?? null, query: null, parentLayout: null })), queried.kind === 'singular'), db);
  const css = [...new Set(ctx.css)].join('');
  const pre = vendorCss(ctx).map((b) => `<link rel="stylesheet" id="${b}-css" href="${VENDOR_CSS[b]}" media="all" />\n`).join('');
  const site = settings.site ?? {};
  const icons = site.icons ?? {};

  // Footer scripts: those the blocks added, arranged (and added to) by the site; then the editor bar
  // (shown only to signed-in editors).
  const scripts = [...(SITE_RENDER.pageScripts ? await SITE_RENDER.pageScripts(ctx) : ctx.scripts), '<script src="/assets/js/editor-bar.js" defer></script>'];
  // Live search on any search form (the search-form block or a site's own).
  if (body.includes('c-search-form') || body.includes('data-live-search')) scripts.push('<script src="/assets/js/search.js" defer></script>');
  // A visit from a tracked email link reports the visitor's first interaction (Mailing on).
  if (mailingOn(site) && !preview) scripts.push('<script src="/assets/js/mail-seen.js" defer></script>');

  // A calendar view names itself ("Events for October 2026"), unless its listing has a search title of its own.
  const title = ctx.data.get('calendar') && !ownTitle(queried, site) ? `${esc((ctx.data.get('calendar') as { title: string }).title)} &#8211; ${site.name ?? ''}` : documentTitle(queried, site);
  const meta = await headMeta(ctx, title);
  const html = `<!DOCTYPE html>
<html lang="en-US">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
${queried.kind === 'search' || (ctx.data.get('calendar') as { outside?: boolean } | undefined)?.outside ? '	<meta name="robots" content="noindex, follow" />\n' : ''}	<title>${title}</title>
${meta}${pre}<style id='core-block-supports-inline-css'>
${css}
</style>
${(ctx.headScripts ?? []).map((s) => `${s}\n`).join('')}<link rel='stylesheet' id='site-css' href='${siteCss}' media='all' />
${SITE_RENDER.head ? `${SITE_RENDER.head(ctx)}\n` : ''}${icons['32'] ? `<link rel="icon" href="${icons['32']}" sizes="32x32" />\n` : ''}${icons['192'] ? `<link rel="icon" href="${icons['192']}" sizes="192x192" />\n` : ''}${icons['180'] ? `<link rel="apple-touch-icon" href="${icons['180']}" />\n` : ''}</head>

<body class="${bodyClasses(queried)}"${editTargets(queried, templateSlug, !!preview)}>
<a class="c-skip-link c-sr-only" href="#content">Skip to content</a>
<div class="c-page">${body.replace(/<main(?![^>]*\sid=)/, '<main id="content"')}</div>
${scripts.join('\n')}
</body>
</html>
`;
  return { status: queried.kind === '404' || queried.notFound ? 404 : 200, html, personal: !!ctx.personal, locked: !!queried.entry?.locked };
}
