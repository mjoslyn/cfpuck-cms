// SEO settings of an entry, kept in its fields under the reserved key `seo` (so drafts, previews and
// revisions carry them): the title and description search engines and social cards show, the share
// image, noindex, and whether the site's own search leaves it out (nosearch). Compose fills them when it builds a page (`generated`), unless someone has
// edited them since.
import { decodeEntities } from './text/entities';
export interface Seo {
  title?: string;
  description?: string;
  /** Media id of the image social cards show, and its URL for the editor's preview. */
  image?: number;
  image_url?: string;
  /** Kept out of search engines (the robots meta tag) and AI answer engines (robots.txt and the tag's
   * noai; src/lib/ai-crawlers.ts). */
  noindex?: boolean;
  /** Left out of the site's own search (/search/ and the search forms' live results; entry_search). */
  nosearch?: boolean;
  /** Written by Compose and not edited since, so the next build may rewrite it. */
  generated?: boolean;
}

/** Lengths search engines show before cutting off. */
export const SEO_LIMITS = { title: 60, description: 160 };

export const seoOf = (fields: Record<string, any> | null | undefined): Seo => (fields?.seo && typeof fields.seo === 'object' ? fields.seo : {});

/** Plain text of some HTML, cut at a word to `max` characters. */
export function summary(html: string | null | undefined, max = SEO_LIMITS.description): string {
  const text = decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text;
}

const TEXT_KEYS = ['eyebrow', 'title', 'content', 'text', 'question', 'answer', 'citation', 'caption', 'html'];

/** The readable text of some page items (as entries.body_text does in the database). */
export function itemsText(items: { props?: { attrs?: Record<string, any>; children?: any[] } }[] | undefined): string {
  const out: string[] = [];
  const walk = (list: typeof items) => {
    for (const item of list ?? []) {
      const a = item.props?.attrs ?? {};
      for (const k of TEXT_KEYS) if (typeof a[k] === 'string') out.push(a[k]);
      if (Array.isArray(a.items)) for (const i of a.items) if (typeof i?.content === 'string') out.push(i.content);
      walk(item.props?.children);
    }
  };
  walk(items);
  return summary(out.join(' '), 100000);
}
