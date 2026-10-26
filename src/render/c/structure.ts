// Template parts (header, footer), patterns and globals (content kept once and placed on many pages).
import type { Renderer } from '../env';
import { renderItems } from '../engine';
import { markImages } from '../../lib/media/image';
import { applyOverrides, type Overrides } from '../../lib/content/linked-patterns';
import { escAttr } from './style';

const AREA_TAGS: Record<string, string> = { header: 'header', footer: 'footer' };
const PART_TAGS = new Set(['div', 'section', 'header', 'footer', 'aside', 'nav', 'main', 'article']);

export const part: Renderer = (b, env) => {
  const items = env.ctx.docs.get(`part:${b.attrs.slug}`);
  if (!items) return '';
  const area = b.attrs.slug === 'header' || b.attrs.slug === 'footer' ? b.attrs.slug : 'other';
  const tag = PART_TAGS.has(b.attrs.tag) ? b.attrs.tag : AREA_TAGS[area] || 'div';
  // Header images load eagerly; the rest of the part is lazy (see optimizeImages()).
  const inner = markImages(renderItems(items, { ...env, parentLayout: null, imgCtx: `part-${area}` }), `part-${area}`);
  return `<${tag} class="c-part is-${area}${b.attrs.className ? ` ${escAttr(String(b.attrs.className))}` : ''}">${inner}</${tag}>`;
};

export const STRUCTURE_RENDERERS: Record<string, Renderer> = {
  part,
  // A linked pattern in the editor (or its preview) carries its blocks; on the site, the pattern's
  // blocks with the page's content changes.
  pattern: (b, env, inner) => (b.attrs.expanded ? inner() : renderItems(applyOverrides(env.ctx.docs.get(`pattern:${b.attrs.slug}`) ?? [], b.attrs.overrides as Overrides | undefined), env)),
  global: (b, env) => renderItems(env.ctx.docs.get(`global:${b.attrs.ref}`), env),
};
