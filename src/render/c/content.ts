// Content blocks: sections, columns, text, headings, images, buttons, lists, quotes, separators,
// spacers, covers, galleries, embeds, raw HTML, media & text. Props are documented in
// src/lib/content/types.ts; styles in ./style.ts; container layouts in ./layout.ts.
import type { Renderer, Env } from '../env';
import { mediaImage, mediaImgTag } from '../../lib/media/image';
import { attrs, alignClass, escAttr, itemDecls, styleDecls, type Decl } from './style';
import { layout } from './layout';
import { focalFor, parseRatio } from '../../lib/media/focal';
import type { Media } from '../../lib/types';
import { iconSvg } from './icons';

const esc = (s: unknown) => String(s ?? '').replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SAFE_TAGS = new Set(['div', 'section', 'main', 'header', 'footer', 'aside', 'article', 'nav']);

/** Common root attributes: id, custom classes, width, styles and flex/grid child sizing. */
function root(a: Record<string, any>, base: (string | false | null | undefined)[], extra: Decl[] = [], more: Record<string, string | undefined> = {}) {
  const decls = [...styleDecls(a.style), ...itemDecls(a.item), ...extra];
  return attrs([...base, alignClass(a.width), a.style?.background || a.style?.gradient ? 'has-bg' : null, a.className], decls, { id: a.anchor, ...more });
}

export const section: Renderer = (b, env, inner) => {
  const a = b.attrs;
  const tag = SAFE_TAGS.has(a.tag) ? a.tag : 'div';
  const l = layout(env.ctx, a.layout, a.gap, a.style?.padding);
  return `<${tag} ${root(a, ['c-section', ...l.classes], l.decls)}>${inner()}</${tag}>`;
};

export const columns: Renderer = (b, env, inner) => {
  const a = b.attrs;
  const gap = typeof a.gap === 'object' ? [a.gap.row, a.gap.column].filter(Boolean).join(' ') : a.gap;
  const valign = a.verticalAlign ? `is-${{ top: 'top', center: 'middle', bottom: 'bottom' }[a.verticalAlign as string] ?? a.verticalAlign}` : null;
  return `<div ${root(a, ['c-columns', valign, a.unstacked ? 'is-unstacked' : null], gap ? [['gap', gap]] : [])}>${inner()}</div>`;
};

export const column: Renderer = (b, env, inner) => {
  const a = b.attrs;
  const valign = a.verticalAlign ? `is-${{ top: 'top', center: 'middle', bottom: 'bottom', stretch: 'stretch' }[a.verticalAlign as string]}` : null;
  const l = layout(env.ctx, a.layout ?? { type: 'flow' }, a.gap, a.style?.padding);
  const basis: Decl[] = a.basis ? [['flex-basis', a.basis]] : [];
  return `<div ${root(a, ['c-column', valign, ...l.classes], [...basis, ...l.decls])}>${inner()}</div>`;
};

export const text: Renderer = (b) => {
  const a = b.attrs;
  if (a.content == null || a.content === '') return '<p></p>';
  return `<p ${root(a, ['c-text', a.dropCap ? 'has-drop-cap' : null])}>${a.content}</p>`;
};

export const heading: Renderer = (b) => {
  const a = b.attrs;
  const level = Math.min(6, Math.max(1, Number(a.level) || 2));
  return `<h${level} ${root(a, ['c-heading'])}>${a.content ?? ''}</h${level}>`;
};

/** <img> for a media-library item (srcset, sizes) or a plain URL. */
export function imageTag(env: Env, a: Record<string, any>, opts: { className?: string; style?: string } = {}): string {
  if (env.imageRatio) a = { ...a, aspectRatio: env.imageRatio };
  const m = a.mediaId ? env.ctx.loader.media.get(Number(a.mediaId)) : undefined;
  // Cover or Contain without a set shape or height fills the block's own space. A shape or height fills
  // the width unless the block sets one (cropped unless Fit says otherwise); without one the image
  // keeps its own size. With a height the ratio only picks the crop: as CSS it would give the image a
  // minimum width (height x ratio) that pushes a narrow column wider.
  const fill = a.scale && !a.aspectRatio && !a.imgHeight ? 'width:100%;height:100%' : '';
  const fixedHeight = a.imgHeight && a.imgHeight !== 'auto';
  const style = [opts.style, fill, a.aspectRatio && !fixedHeight ? `aspect-ratio:${a.aspectRatio}` : '', (a.aspectRatio || fixedHeight) && !a.scale ? 'object-fit:cover' : '', a.scale ? `object-fit:${a.scale}` : '', a.imgWidth ? `width:${a.imgWidth}` : a.aspectRatio || fixedHeight ? 'width:100%' : '', a.imgHeight ? `height:${a.imgHeight}` : '']
    .filter(Boolean)
    .join(';');
  if (m) {
    const img = mediaImage(m, a.size || 'large', { alt: a.alt ?? m.alt ?? '', className: opts.className, style: style || undefined, ratio: parseRatio(a.aspectRatio) });
    // Keep an explicitly chosen URL (e.g. a specific size) when it differs from the size lookup.
    if (a.src && a.src !== img.src && !img.srcSet) img.src = a.src;
    return mediaImgTag(img).replace(/\sdata-cms-img="attachment"/, '');
  }
  if (!a.src) return '';
  return `<img src="${escAttr(a.src)}" alt="${escAttr(a.alt ?? '')}"${opts.className ? ` class="${opts.className}"` : ''}${a.width ? ` width="${escAttr(String(a.width))}"` : ''}${a.height ? ` height="${escAttr(String(a.height))}"` : ''}${style ? ` style="${escAttr(style)}"` : ''} />`;
}

export const image: Renderer = (b, env) => {
  const a = b.attrs;
  // Focal points per screen size, when the block sets any (else the image's own, as mediaImage places it).
  const m = a.mediaId ? env.ctx.loader.media.get(Number(a.mediaId)) : undefined;
  const ratio = parseRatio(a.aspectRatio);
  const points = hasOwnFocal(a) ? screenFocal(a, m, [ratio, ratio, ratio]) : [];
  let img = imageTag(env, a, points.length ? { style: 'object-position:var(--focal-at)' } : {});
  if (!img) return '';
  if (a.href) img = `<a href="${escAttr(a.href)}"${a.target ? ` target="${escAttr(a.target)}"` : ''}${a.rel ? ` rel="${escAttr(a.rel)}"` : ''}>${img}</a>`;
  const caption = a.caption ? `<figcaption>${a.caption}</figcaption>` : '';
  const fill = a.scale && !a.aspectRatio && !a.imgHeight && !a.cover;
  // Cover: the image fills the block it is in, behind the rest (as the card image's option); Shade
  // darkens it towards the bottom.
  const shade = a.shade ? '<span class="c-entry-image__overlay is-shade" aria-hidden="true"></span>' : '';
  return `<figure ${root({ ...a, width: a.align }, ['c-image', a.variant === 'circle' ? 'is-circle' : null, fill ? 'is-fill' : null, a.cover ? 'is-cover' : null], points)}>${img}${shade}${caption}</figure>`;
};

export const buttons: Renderer = (b, env, inner) => {
  const a = b.attrs;
  const l = layout(env.ctx, { type: a.vertical ? 'stack' : 'row', justify: a.justify, wrap: a.wrap }, a.gap);
  return `<div ${root(a, ['c-buttons', ...l.classes.filter((c) => c !== 'c-row' && c !== 'c-stack'), a.vertical ? 'is-vertical' : null], [...l.decls, ...(a.vertical ? ([['flex-direction', 'column']] as Decl[]) : [])])}>${inner()}</div>`;
};

export const button: Renderer = (b) => {
  const a = b.attrs;
  const s = a.style ?? {};
  // Typography sits on the wrapper (inherited by the link); colours, borders and padding on the link.
  const outer: Decl[] = [];
  const typo = ['fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'fontStyle', 'fontFamily', 'lineHeight', 'textDecoration'] as const;
  const inner: Record<string, any> = { ...s };
  const wrap: Record<string, any> = {};
  for (const k of typo) if (s[k]) (wrap[k] = s[k]), delete inner[k];
  outer.push(...styleDecls(wrap));
  const linkDecls = styleDecls(inner);
  const tag = a.href ? 'a' : 'button';
  const href = a.href ? ` href="${escAttr(a.href)}"` : ' type="button"';
  const target = a.target ? ` target="${escAttr(a.target)}"` : '';
  const rel = a.rel ? ` rel="${escAttr(a.rel)}"` : '';
  const link = `<${tag} class="c-button__link"${href}${target}${rel}${linkDecls.length ? ` style="${escAttr(linkDecls.map(([p, v]) => `${p}:${v}`).join(';'))}"` : ''}>${a.text ?? ''}</${tag}>`;
  return `<div ${attrs(['c-button', a.variant === 'outline' ? 'is-outline' : null, a.widthPct ? `w-${a.widthPct}` : null, a.className], outer, { id: a.anchor })}>${link}</div>`;
};

/**
 * A list: items ({ content, icon? }) with a marker: bullets, numbers, an icon, or none. Older lists
 * keep their items as list-item children (and `ordered` / `variant: plain`); they render the same way.
 */
export const list: Renderer = (b, env, inner) => {
  const a = b.attrs;
  const marker: string = a.marker ?? (a.ordered ? 'number' : a.variant === 'plain' ? 'none' : 'bullet');
  const tag = marker === 'number' ? 'ol' : 'ul';
  const extra: Record<string, string | undefined> = {};
  if (tag === 'ol' && a.start != null) extra.start = String(a.start);
  if (tag === 'ol' && a.reversed) extra.reversed = 'reversed';
  const decls: Decl[] = [];
  if (a.iconColor) decls.push(['--list-icon-color', a.iconColor]);
  if (a.itemGap) decls.push(['--list-gap', a.itemGap]);
  const cls = ['c-list', marker === 'none' ? 'is-plain' : null, marker === 'icon' ? 'has-icons' : null];
  if (!Array.isArray(a.items)) return `<${tag} ${root(a, cls, decls, extra)}>${inner()}</${tag}>`;
  const items = (a.items as { content?: string; icon?: string }[])
    .map((it) => {
      const icon = marker === 'icon' ? iconSvg(it.icon || a.icon || 'check') : '';
      return icon ? `<li class="c-list__item"><span class="c-list__icon">${icon}</span><span class="c-list__text">${it.content ?? ''}</span></li>` : `<li class="c-list__item">${it.content ?? ''}</li>`;
    })
    .join('');
  return `<${tag} ${root(a, cls, decls, extra)}>${items}</${tag}>`;
};

export const listItem: Renderer = (b, env, inner) => {
  const a = b.attrs;
  const rest = attrs([a.className], styleDecls(a.style));
  return `<li${rest ? ` ${rest}` : ''}>${a.content ?? ''}${inner()}</li>`;
};

export const quote: Renderer = (b, env, inner) => {
  const a = b.attrs;
  const cite = a.citation ? `<cite>${a.citation}</cite>` : '';
  return `<blockquote ${root(a, ['c-quote', 'c-flow'])}>${inner()}${cite}</blockquote>`;
};

export const separator: Renderer = (b) => {
  const a = b.attrs;
  // The line colour is the background for solid separators and the text colour for dots.
  const s = { ...(a.style ?? {}) };
  const extra: Decl[] = [];
  if (s.color && a.variant !== 'dots') extra.push(['background-color', s.color], ['border-color', s.color]);
  if (s.background && a.variant !== 'dots') extra.push(['border-color', s.background]);
  return `<hr ${root({ ...a, style: s }, ['c-separator', a.variant === 'dots' ? 'is-dots' : a.variant ? `is-${a.variant}` : null], extra)} />`;
};

/**
 * A page hero: a full-bleed image under a dark gradient with an eyebrow line, title, text and up to two
 * buttons. Attrs: mediaId/src, eyebrow, title, text, primaryLabel/primaryHref, secondaryLabel/secondaryHref,
 * height (screen, large, medium), level (1 or 2), width (full unless set).
 */
/** A focal point ({ x, y } in 0..1) as CSS, or undefined. */
function focalCss(p: unknown): string | undefined {
  const q = p as { x?: unknown; y?: unknown } | null | undefined;
  const x = Number(q?.x);
  const y = Number(q?.y);
  if (!q || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const pc = (v: number) => `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;
  return `${pc(x)} ${pc(y)}`;
}

/**
 * The Hero's and Image's focal points per screen size, as the variables the stylesheet picks from
 * (--focal, --focal-tablet, --focal-phone; it sets --focal-at for the screen, and the image's style is
 * object-position:var(--focal-at)). Each size: the block's own (attrs.focal, focalTablet, focalPhone),
 * else the image's from the media library for the crop's shape on that size (`ratios`), else its main point.
 */
function screenFocal(a: Record<string, any>, m: Media | undefined, ratios: [number | null, number | null, number | null]): Decl[] {
  const own = [a.focal, a.focalTablet, a.focalPhone];
  const out: Decl[] = [];
  (['--focal', '--focal-tablet', '--focal-phone'] as const).forEach((name, i) => {
    const v = focalCss(own[i]) ?? (m ? focalCss(focalFor(m, ratios[i])) : undefined);
    if (v) out.push([name, v]);
  });
  return out;
}
const hasOwnFocal = (a: Record<string, any>) => [a.focal, a.focalTablet, a.focalPhone].some((p) => focalCss(p));

export const hero: Renderer = (b, env) => {
  const a = b.attrs;
  const m = a.mediaId ? env.ctx.loader.media.get(Number(a.mediaId)) : undefined;
  // Focal points per screen size (screenFocal): a hero is wide on desktop and tall on tablets and phones.
  const points = screenFocal(a, m, [16 / 9, 3 / 4, 3 / 4]);
  const pos = points.length ? 'object-position:var(--focal-at)' : undefined;
  const img = a.mediaId || a.src ? imageTag(env, { mediaId: a.mediaId, src: a.src, alt: '', size: 'full' }, { className: 'c-hero__image', style: pos }).replace(/\swidth="\d+"|\sheight="\d+"/g, '').replace(/<img\b/, '<img data-cms-img="cover"') : '';
  const level = a.level === 2 ? 2 : 1;
  const btn = (label: unknown, href: unknown, cls: string) => (label && href ? `<a class="c-hero__button ${cls}" href="${escAttr(String(href))}">${esc(String(label))}</a>` : '');
  const buttons = btn(a.primaryLabel, a.primaryHref, 'is-primary') + btn(a.secondaryLabel, a.secondaryHref, 'is-secondary');
  const height = a.height === 'large' || a.height === 'medium' ? a.height : 'screen';
  // The overlay that keeps the text readable: how dark (medium by default) and where it is darkest.
  const shade = ['none', 'light', 'strong'].includes(a.overlay) ? `is-shade-${a.overlay}` : null;
  const shadeFrom = ['left', 'even'].includes(a.overlayFrom) ? `is-shade-${a.overlayFrom}` : null;
  return (
    `<section ${root({ ...a, width: a.width ?? 'full' }, ['c-hero', `is-${height}`, shade, shadeFrom], points)}>${img}<span class="c-hero__overlay" aria-hidden="true"></span>` +
    `<div class="c-hero__inner"><div class="c-hero__content">` +
    (a.eyebrow ? `<p class="c-hero__eyebrow">${esc(String(a.eyebrow))}</p>` : '') +
    (a.title ? `<h${level} class="c-hero__title">${esc(String(a.title))}</h${level}>` : '') +
    (a.text ? `<p class="c-hero__text">${esc(String(a.text))}</p>` : '') +
    (buttons ? `<div class="c-hero__buttons">${buttons}</div>` : '') +
    `</div></div></section>`
  );
};

export const spacer: Renderer = (b) => {
  const a = b.attrs;
  const d: Decl[] = [['height', a.height || '100px']];
  if (a.width) d.push(['width', a.width]);
  return `<div ${attrs(['c-spacer', a.className], [...d, ...itemDecls(a.item)])} aria-hidden="true"></div>`;
};

export const cover: Renderer = (b, env, inner) => {
  const a = b.attrs;
  const src = a.useFeaturedImage ? featuredImage(env) : a.mediaId || a.src ? a : null;
  // Focal points per screen size (screenFocal): a cover is usually wide on desktop and tall on phones.
  const m = src?.mediaId ? env.ctx.loader.media.get(Number(src.mediaId)) : undefined;
  const points = src ? screenFocal(a, m, [16 / 9, 3 / 4, 3 / 4]) : [];
  const img = src ? imageTag(env, src, { className: 'c-cover__image', style: points.length ? 'object-position:var(--focal-at)' : undefined }).replace(/\swidth="\d+"|\sheight="\d+"/g, '').replace(/<img\b/, '<img data-cms-img="cover"') : '';
  // Overlay: a solid colour, or (overlayStyle) a gradient from it, darkest at the bottom or the left
  // (where the text usually is), clearing towards the other side.
  const shade = a.overlayStyle === 'bottom' || a.overlayStyle === 'left' ? a.overlayStyle : null;
  const dim = a.dim ?? (src ? (shade ? 80 : 50) : 100);
  const overlayDecls: Decl[] = [['opacity', String(dim / 100)]];
  const color = a.overlay || 'var(--color-dark)';
  if (a.gradient) overlayDecls.push(['background', a.gradient]);
  else if (shade) overlayDecls.push(['background', `linear-gradient(${shade === 'left' ? 'to right' : 'to top'}, ${color} 0%, color-mix(in srgb, ${color} 55%, transparent) 50%, transparent 100%)`]);
  else if (a.overlay) overlayDecls.push(['background-color', a.overlay]);
  const overlay = `<span aria-hidden="true" class="c-cover__overlay" style="${escAttr(overlayDecls.map(([p, v]) => `${p}:${v}`).join(';'))}"></span>`;
  const l = layout(env.ctx, a.layout ?? { type: 'flow' }, a.gap, a.style?.padding);
  const tag = SAFE_TAGS.has(a.tag) ? a.tag : 'div';
  const minHeight: Decl[] = a.minHeight ? [['min-height', a.minHeight]] : [];
  const position = a.position && a.position !== 'center-center' ? `is-${a.position}` : null;
  return (
    `<${tag} ${root(a, ['c-cover', a.light ? 'is-light' : null, a.fixed ? 'is-fixed' : null, position], [...minHeight, ...points])}>` +
    `${img}${overlay}<div class="${['c-cover__inner', ...l.classes].join(' ')}"${l.decls.length ? ` style="${escAttr(l.decls.map(([p, v]) => `${p}:${v}`).join(';'))}"` : ''}>${inner()}</div></${tag}>`
  );
};

function featuredImage(env: Env): Record<string, any> | null {
  const post = env.post;
  if (!post?.featured_media_id) return null;
  const m = env.ctx.loader.media.get(post.featured_media_id);
  return m ? { mediaId: m.id, alt: m.alt, size: 'full' } : null;
}

/**
 * Image galleries (image blocks) and video galleries (embed and video blocks), shown as a grid, as
 * masonry columns or as a slider: a row that scrolls, with buttons and autoplay from
 * /assets/js/gallery-slider.js. Attrs: display, columns, gap, crop and ratio (images), autoplay, caption.
 */
function galleryOf(video: boolean): Renderer {
  return (b, env, inner) => {
    const a = b.attrs;
    const display = a.display === 'masonry' || a.display === 'slider' ? a.display : 'grid';
    const d: Decl[] = [['--gallery-cols', String(a.columns || 3)]];
    if (a.gap) d.push(['--gallery-gap', a.gap]);
    const ratio = !video && display !== 'masonry' && a.ratio ? String(a.ratio) : undefined;
    const kids = inner(ratio ? { imageRatio: ratio } : {});
    if (!kids.trim()) return '';
    const cropped = !video && display !== 'masonry' && (a.crop !== false || !!ratio);
    const cls = ['c-gallery', video ? 'is-video' : null, display === 'grid' ? null : `is-${display}`, cropped ? 'is-cropped' : null];
    const label = video ? 'Videos' : 'Images';
    const body =
      display === 'slider'
        ? `<div class="c-gallery__track" tabindex="0" role="region" aria-label="${label}">${kids}</div>` +
          `<button type="button" class="c-gallery__prev" aria-label="Previous" hidden>${iconSvg('chevron')}</button><button type="button" class="c-gallery__next" aria-label="Next" hidden>${iconSvg('chevron')}</button>`
        : kids;
    const more = display === 'slider' && !video && a.autoplay ? { 'data-autoplay': '5' } : {};
    return `<figure ${root(a, cls, d, more)}>${body}${a.caption ? `<figcaption>${a.caption}</figcaption>` : ''}</figure>`;
  };
}

export const gallery = galleryOf(false);
export const videoGallery = galleryOf(true);

export const embed: Renderer = (b) => {
  const a = b.attrs;
  const d: Decl[] = a.ratio ? [['--embed-ratio', `${(100 / Number(a.ratio)).toFixed(2)}%`]] : [];
  const body = a.html || (a.url ? `<a href="${escAttr(a.url)}">${esc(a.url)}</a>` : '');
  return `<figure ${root(a, ['c-embed', a.provider ? `is-${a.provider}` : null, a.ratio ? 'is-responsive' : null], d)}><div class="c-embed__wrapper">${body}</div>${a.caption ? `<figcaption>${a.caption}</figcaption>` : ''}</figure>`;
};

/** An uploaded video file (video links use embed). Attrs: src, mediaId, poster, caption, controls, autoplay, loop. */
export const video: Renderer = (b) => {
  const a = b.attrs;
  if (!a.src) return '';
  const flags = [a.controls !== false && 'controls', a.autoplay && 'autoplay muted playsinline', a.loop && 'loop'].filter(Boolean).join(' ');
  return `<figure ${root(a, ['c-video'])}><video src="${escAttr(a.src)}"${a.poster ? ` poster="${escAttr(a.poster)}"` : ''} ${flags} preload="metadata"></video>${a.caption ? `<figcaption>${a.caption}</figcaption>` : ''}</figure>`;
};

export const html: Renderer = (b) => String(b.attrs.html ?? '');

export const mediaText: Renderer = (b, env, inner) => {
  const a = b.attrs;
  const img = imageTag(env, a);
  const d: Decl[] = a.mediaWidth && a.mediaWidth !== 50 ? [['--media-width', `${a.mediaWidth}%`]] : [];
  const media = `<figure class="c-media-text__media">${a.href ? `<a href="${escAttr(a.href)}">${img}</a>` : img}</figure>`;
  const content = `<div class="c-media-text__content">${inner()}</div>`;
  const cls = ['c-media-text', a.mediaPosition === 'right' ? 'is-media-right' : null, a.stack !== false ? 'is-stacked' : null, a.verticalAlign ? `is-${a.verticalAlign}` : null];
  return `<div ${root(a, cls, d)}>${a.mediaPosition === 'right' ? content + media : media + content}</div>`;
};

export const CONTENT_RENDERERS: Record<string, Renderer> = {
  section,
  columns,
  column,
  text,
  heading,
  image,
  buttons,
  button,
  list,
  'list-item': listItem,
  quote,
  separator,
  spacer,
  cover,
  gallery,
  'video-gallery': videoGallery,
  hero,
  embed,
  video,
  html,
  'media-text': mediaText,
};

