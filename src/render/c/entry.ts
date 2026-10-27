// Entry fields shown inside collections and on single pages: title, excerpt, date, terms, image and
// content. They read the entry in context (env.post). On a term page, outside a collection, Title,
// Excerpt, Featured image and Field show the term: its name, description, featured image (else its
// taxonomy's) and fields. On a type's listing page, outside a collection, Featured image shows the
// listing's (Settings > Types).
import type { Renderer } from '../env';
import type { Entry } from '../../lib/types';
import { mediaImage, mediaImgTag, markImages, mediaUrl } from '../../lib/media/image';
import { permalink, termLink, byTermOrder } from '../../lib/permalink';
import { formatDate, DATE_FORMAT } from '../../lib/date-format';
import { trimWords } from '../html';
import { renderItems } from '../engine';
import { attrs, alignClass, escAttr, itemDecls, styleDecls, type Decl } from './style';
import { layout } from './layout';
import { parseRatio } from '../../lib/media/focal';
import { MAIN_AREA, areaName } from '../../lib/content/areas';
import { termPagesOn } from '../../lib/templates';
import { listingImageId, termImageId } from '../../lib/page-meta';
import { ARCHIVE_PATHS, typeDef } from '../../lib/site';
import type { Env } from '../env';
import type { Term } from '../../lib/types';
import { lockedContent } from './members';
import { entryImageHeight } from '../../lib/content/image-height';

const esc = (s: unknown) => String(s ?? '').replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The entry's title as HTML: the imported rendered title (entities, smart quotes), else the escaped title. */
export const entryTitle = (e: Entry) => e.title_rendered ?? esc(e.title);

/** URL of an image field's value: a media id, or a URL as stored. */
export function imageFieldUrl(ctx: { loader: { mediaById: (id: number) => { path: string } | undefined } }, value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string' && !/^\d+$/.test(value)) return value;
  const m = ctx.loader.mediaById(Number(value));
  return m ? mediaUrl(m.path) : '';
}

function root(a: Record<string, any>, base: (string | false | null | undefined)[], extra: Decl[] = []) {
  return attrs([...base, alignClass(a.width), a.style?.background ? 'has-bg' : null, a.className], [...styleDecls(a.style), ...itemDecls(a.item), ...extra], { id: a.anchor });
}

type Subject = Entry & { term?: Term; listing?: string };

/** The queried term on a term page, shaped as the entry the blocks read (with `term` set). */
function termSubject(env: Env): Subject | undefined {
  const q = env.ctx.queried;
  const t = q.kind === 'taxonomy' ? q.term : undefined;
  if (!t) return undefined;
  return { id: 0, type: t.taxonomy, slug: t.slug, title: t.name, excerpt: t.description ?? '', featured_media_id: termImageId(t, env.ctx.settings.site) ?? null, fields: t.fields ?? {}, term: t } as unknown as Subject;
}
/** A type listing page shaped as the entry the Featured image block reads (only that block uses it). */
function listingSubject(env: Env): Subject | undefined {
  const q = env.ctx.queried;
  const type = q.kind === 'archive' ? q.postType : undefined;
  const image = type ? listingImageId(env.ctx.settings.site, type) : undefined;
  if (!type || !image) return undefined;
  return { id: 0, type, slug: '', title: typeDef(type)?.label ?? type, excerpt: '', featured_media_id: image, fields: {}, listing: ARCHIVE_PATHS[type] } as unknown as Subject;
}

/** The entry in context, else the term of a term page. */
const subject = (env: Env): Subject | undefined => (env.post as Subject | undefined) ?? termSubject(env);
/** Where a title or image links: the entry, or the term's page. */
const linkOf = (e: Subject) => (e.term ? termLink(e.term) : e.listing ? e.listing : permalink(e));

const linkAttrs = (a: Record<string, any>) => `${a.target ? ` target="${escAttr(a.target)}"` : ''}${a.rel ? ` rel="${escAttr(a.rel)}"` : ''}`;

export const entryTitleBlock: Renderer = (b, env) => {
  const post = subject(env);
  if (!post) return '';
  const a = b.attrs;
  let title = entryTitle(post);
  if (!title) return '';
  const tag = a.level === 0 ? 'p' : `h${Math.min(6, Math.max(1, Number(a.level) || 2))}`;
  if (a.link) title = `<a href="${linkOf(post)}"${linkAttrs(a)}>${title}</a>`;
  return `<${tag} ${root(a, ['c-entry-title'])}>${title}</${tag}>`;
};

export const entryExcerpt: Renderer = (b, env) => {
  const post = subject(env);
  if (!post) return '';
  const a = b.attrs;
  let excerpt = post.excerpt_rendered ?? post.excerpt ?? '';
  if (!excerpt && post.term) return '';
  const more = a.moreText ? `<a class="c-entry-excerpt__more" href="${linkOf(post)}">${a.moreText}</a>` : '';
  if (more) excerpt = excerpt.replace(/ \[&hellip;\]$/, '');
  excerpt = trimWords(excerpt, a.length ?? 55);
  const body = a.moreOnNewLine !== false && more ? `<p class="c-entry-excerpt__text">${excerpt}</p><p class="c-entry-excerpt__more-line">${more}</p>` : `<p class="c-entry-excerpt__text">${excerpt} ${more}</p>`;
  return `<div ${root(a, ['c-entry-excerpt'])}>${body}</div>`;
};

export const entryDate: Renderer = (b, { post }) => {
  if (!post) return '';
  const a = b.attrs;
  if (a.modified && formatDate('YmdHi', post.updated_at) <= formatDate('YmdHi', post.published_at)) return '';
  const date = a.modified ? post.updated_at : post.published_at;
  let text = formatDate(a.format || DATE_FORMAT, date);
  if (a.link) text = `<a href="${permalink(post)}">${text}</a>`;
  return `<div ${root(a, ['c-entry-date'])}><time datetime="${formatDate('c', date)}">${text}</time></div>`;
};

export const entryTerms: Renderer = (b, { post, ctx }) => {
  if (!post || !b.attrs.taxonomy) return '';
  const a = b.attrs;
  const terms = (post.term_ids ?? [])
    .map((id) => ctx.loader.terms.get(id)!)
    .filter((t) => t && t.taxonomy === a.taxonomy)
    .sort(byTermOrder);
  if (!terms.length) return '';
  const sep = `<span class="c-entry-terms__sep">${esc(a.separator ?? ', ')}</span>`;
  const prefix = a.prefix ? `<span class="c-entry-terms__prefix">${a.prefix}</span>` : '';
  const suffix = a.suffix ? `<span class="c-entry-terms__suffix">${a.suffix}</span>` : '';
  return `<div ${root(a, ['c-entry-terms'])}>${prefix}${terms.map((t) => (termPagesOn(ctx.settings.site, t.taxonomy) ? `<a href="${termLink(t)}" rel="tag">${esc(t.name)}</a>` : `<span>${esc(t.name)}</span>`)).join(sep)}${suffix}</div>`;
};

/**
 * The entry's featured image, or with `field` an image field of the entry (e.g. a sponsor's square logo),
 * falling back to the featured image when that field is empty. With `linkField`, the image links to
 * that field's URL (in a new tab), or to the entry.
 */
export const entryImage: Renderer = (b, env) => {
  const { ctx } = env;
  const post = subject(env) ?? listingSubject(env);
  if (!post) return '';
  const a = b.attrs;

  const fieldSrc = a.field ? imageFieldUrl(ctx, post.fields?.[a.field]) : '';
  if (fieldSrc) {
    // A field's image (a logo, a banner) in a shape: fitted inside it, not cropped, unless set otherwise.
    const ratio = a.aspectRatio && a.aspectRatio !== 'auto' ? String(a.aspectRatio) : '';
    // A shape fills the width: a ratio with a height would otherwise set the width from the height.
    // With a height the ratio is left out: it would give the box a minimum width (height x ratio)
    // that pushes a narrow card wider.
    const fixedHeight = entryImageHeight(a);
    const box = [ratio && !fixedHeight && `aspect-ratio:${ratio}`, fixedHeight && `height:${fixedHeight}`, (ratio || fixedHeight) && 'width:100%'].filter(Boolean).join(';');
    const shaped = box || a.scale ? ` style="width:100%;height:100%;object-fit:${escAttr(a.scale ?? 'contain')}"` : '';
    const img = `<img src="${escAttr(fieldSrc)}" alt="${escAttr(entryTitle(post))}"${shaped}>`;
    const inner = a.linkField ? `<a href="${escAttr(post.fields?.[a.linkField] || linkOf(post))}" target="_blank" rel="noopener noreferrer">${img}</a>` : img;
    return `<figure class="c-entry-image${a.scale && !box ? ' is-fill' : ''}${a.className ? ` ${escAttr(a.className)}` : ''}"${box ? ` style="${escAttr(box)}"` : ''}>${inner}</figure>`;
  }

  const media = post.featured_media_id ? ctx.loader.media.get(post.featured_media_id) : undefined;
  if (!media) return '';
  const s = a.style ?? {};
  // Its height: the block's (a preset or custom length), the card height in a collection's card, or
  // the image's own (Auto).
  const height = entryImageHeight(a, env.inCard);
  // Radius, borders and shadow draw on the image itself.
  const imgStyle = styleDecls({ radius: s.radius, borderWidth: s.borderWidth, borderColor: s.borderColor, borderStyle: s.borderStyle, shadow: s.shadow });
  if (a.aspectRatio || (a.scale && !height)) imgStyle.push(['width', '100%'], ['height', '100%']);
  else if (height) imgStyle.push(['height', height]);
  // The image fills a fixed ratio or height, cropped ("cover") unless set otherwise.
  if (a.scale || a.aspectRatio || height) imgStyle.push(['object-fit', a.scale ?? 'cover']);
  const alt = a.link ? entryTitle(post).replace(/<[^>]*>/g, '').trim() || `Untitled ${post.id}` : undefined;
  const img = mediaImgTag(mediaImage(media, a.size || 'large', { alt, style: imgStyle.map(([p, v]) => `${p}:${v}`).join(';') || undefined, ratio: parseRatio(a.aspectRatio) }));
  let overlay = '';
  // Shade: a gradient darkening towards the bottom, so text over the image stays readable.
  if (a.shade) overlay += '<span class="c-entry-image__overlay is-shade" aria-hidden="true"></span>';
  if (a.dim) {
    const d: Decl[] = [['opacity', String(a.dim / 100)]];
    if (a.overlayGradient) d.push(['background', a.overlayGradient]);
    else d.push(['background-color', a.overlay ?? '#000']);
    if (s.radius && typeof s.radius === 'string') d.push(['border-radius', s.radius]);
    overlay += `<span class="c-entry-image__overlay" style="${escAttr(d.map(([p, v]) => `${p}:${v}`).join(';'))}" aria-hidden="true"></span>`;
  }
  const inner = a.link ? `<a href="${linkOf(post)}"${linkAttrs(a)}${height ? ` style="height:${escAttr(height)}"` : ''}>${img}${overlay}</a>` : img + overlay;
  const dims: Decl[] = [];
  const fixedHeight = !!height;
  // A shape fills the width unless the block sets one. With a height the ratio is left out: it would
  // set the width from the height, and give the box a minimum width that pushes a narrow card wider.
  if (a.aspectRatio && !fixedHeight) dims.push(['aspect-ratio', a.aspectRatio]);
  if (a.imgWidth) dims.push(['width', a.imgWidth]);
  else if (a.aspectRatio || fixedHeight) dims.push(['width', '100%']);
  if (height) dims.push(['height', height]);
  const outer = { ...a, style: { margin: s.margin, padding: s.padding } };
  // Cover: the image fills the block it sits in, behind the rest of it (a card with its title over the photo).
  return `<figure ${root(outer, ['c-entry-image', a.cover ? 'is-cover' : null, a.scale && !a.aspectRatio && !height && !a.cover ? 'is-fill' : null], a.cover ? [] : dims)}>${inner}</figure>`;
};

/** The entry's own blocks (the page body inside a template). */
export const entryContent: Renderer = (b, env) => {
  const { post, ctx } = env;
  if (!post) return '';
  const a = b.attrs;
  const area = areaName(a.area);
  const editing = env.contentSlot && post.id === ctx.queried.entry?.id;
  // A members-only page the viewer may not see: the sign-in prompt in its place.
  if (post.locked && !editing) return `<div ${root(a, ['c-entry-content'])}>${lockedContent(env, post)}</div>`;
  // In the editor each area is a drop zone (the marker says which); on the site, the area's blocks.
  const inner = editing
    ? env.contentSlot!.replace('<cms-content>', `<cms-content data-area="${area}">`)
    : markImages(renderItems(ctx.docs.get(area === MAIN_AREA ? `content:${post.id}` : `content:${post.id}:${area}`), { ...env, parentLayout: a.layout ?? null, imgCtx: 'content' }), 'content');
  if (!editing && !inner.trim()) return '';
  const l = layout(ctx, a.layout ?? { type: 'flow' }, a.gap, a.style?.padding);
  return `<div ${root(a, ['c-entry-content', ...l.classes], l.decls)}>${inner}</div>`;
};

/**
 * One of the entry's own fields (a member's phone, a venue's address...): as text, a link (URL, email,
 * phone) or an image. Attrs: field, as, label (shown before the value), linkText, newTab.
 */
export const entryField: Renderer = (b, env) => {
  const a = b.attrs;
  const post = env.post ?? env.ctx.queried.entry ?? termSubject(env);
  const key = String(a.field ?? '').trim();
  if (!post || !key) return '';
  const value = post.fields?.[key];
  const text = value == null || typeof value === 'object' ? '' : String(value).trim();
  const label = a.label ? `<span class="c-entry-field__label">${esc(a.label)}</span> ` : '';
  const wrap = (inner: string) => `<p ${attrs(['c-entry-field', alignClass(a.width), a.className], styleDecls(a.style), { id: a.anchor })}>${label}${inner}</p>`;
  if (a.as === 'image') {
    const m = /^\d+$/.test(text) ? env.ctx.loader.mediaById(Number(text)) : undefined;
    if (m) return wrap(mediaImgTag(mediaImage(m, a.size || 'medium', { alt: '' })));
    return text ? wrap(`<img src="${escAttr(text)}" alt="" loading="lazy" />`) : '';
  }
  if (!text) return '';
  const href = a.as === 'email' ? `mailto:${text}` : a.as === 'phone' ? `tel:${text.replace(/[^0-9+]/g, '')}` : a.as === 'link' ? text : '';
  if (!href) return wrap(esc(text));
  const shown = a.linkText || (a.as === 'link' ? text.replace(/^https?:\/\/(www\.)?|\/$/g, '') : text);
  return wrap(`<a href="${escAttr(href)}"${a.newTab ? ' target="_blank" rel="noopener"' : ''}>${esc(shown)}</a>`);
};

export const ENTRY_RENDERERS = {
  'entry-field': entryField,
  'entry-title': entryTitleBlock,
  'entry-excerpt': entryExcerpt,
  'entry-date': entryDate,
  'entry-terms': entryTerms,
  'entry-image': entryImage,
  'entry-content': entryContent,
};

export type { Entry };
