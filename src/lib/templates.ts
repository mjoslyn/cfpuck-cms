// Which template renders an entry's page or a type's listing page, and whether a listing page is on. Admins can choose one per type
// under Settings > Types (settings.site.templates: { [type]: { single?, archive? } }); otherwise the
// first existing template in the default order is used.

export type TemplateMap = Record<string, { single?: string; archive?: string }>;

/**
 * Term pages: a template per taxonomy (Settings > Types, settings.site.taxonomy_templates), and one per
 * term (Content > Taxonomies, terms.fields.template) that the terms under it share.
 */
export type TaxonomyTemplates = Record<string, string>;

/** The template a term chose, or the nearest term above it that chose one. */
export function termTemplate(term: { parent_id: number | null; fields?: Record<string, any> | null }, terms: Map<number, { parent_id: number | null; fields?: Record<string, any> | null }>): { slug: string; from: number | null } | null {
  let t: typeof term | undefined = term;
  let from: number | null = null;
  for (let hops = 0; t && hops < 20; hops++) {
    const slug = t.fields?.template;
    if (typeof slug === 'string' && slug) return { slug, from };
    from = t.parent_id;
    t = t.parent_id ? terms.get(t.parent_id) : undefined;
  }
  return null;
}

/** The default order of templates for a taxonomy's term pages. */
export const defaultTaxonomyTemplates = (taxonomy: string) => [`taxonomy-${taxonomy}`, 'taxonomy', 'archive', 'index'];

/** The default order of templates for a type's entries (`single`) or its listing (`archive`). */
export function defaultTemplates(type: string, kind: 'single' | 'archive'): string[] {
  if (kind === 'archive') return type === 'event' ? ['archive-events', 'archive', 'index'] : [`archive-${type}`, 'archive', 'index'];
  if (type === 'page') return ['page', 'singular', 'index'];
  return type === 'event' ? ['single-event', 'single', 'singular', 'index'] : [`single-${type}`, 'single', 'singular', 'index'];
}

/** The template chosen for a type, if any and still a string. */
export function chosenTemplate(map: TemplateMap | undefined, type: string, kind: 'single' | 'archive'): string | undefined {
  const v = map?.[type]?.[kind];
  return typeof v === 'string' && v ? v : undefined;
}

/** A template as the admin lists it: whether it shows an entry's own content (a Page content block). */
export interface TemplateInfo {
  slug: string;
  title?: string;
  content: boolean;
}

/** Whether some template items include the entry's own content (Page content, or an event's details). */
export function hasContentBlock(items: { type: string; props?: { children?: any[] } }[] | undefined): boolean {
  return (items ?? []).some((i) => i.type === 'entry-content' || i.type === 'event-details' || hasContentBlock(i.props?.children));
}

/** Option label: title and slug, marked when the template leaves out the entry's content. */
export const templateLabel = (t: TemplateInfo) => `${t.title && t.title !== t.slug ? `${t.title} (${t.slug})` : t.slug}${t.content ? '' : ' – no page content'}`;

export const NO_CONTENT_WARNING = "This template has no Page content block: the entry's own content won't show on the site, and opening the entry in the editor edits the template itself (every page using it).";

/** Whether a taxonomy's term pages are on (Settings > Types; settings.site.taxonomy_pages_off lists those off). */
export function termPagesOn(siteSettings: Record<string, any> | undefined, taxonomy: string): boolean {
  const off = siteSettings?.taxonomy_pages_off;
  return !(Array.isArray(off) && off.includes(taxonomy));
}

/** Whether a type's listing page is on (Settings > Types; settings.site.listings_off lists those turned off). */
export function listingOn(siteSettings: Record<string, any> | undefined, type: string): boolean {
  const off = siteSettings?.listings_off;
  return !(Array.isArray(off) && off.includes(type));
}
