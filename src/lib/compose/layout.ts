// Compose on a layout: a template, part or pattern (shared by pages), edited on its own or as a page
// in layout mode, rather than one page's content.

export interface Layout {
  kind: 'template' | 'part' | 'pattern';
  slug: string;
  /** A page edited in layout mode (its template is what it shows), rather than the template on its own. */
  page: boolean;
}

const KINDS: Record<Layout['kind'], string> = { template: 'template', part: 'template part', pattern: 'pattern' };

/** "the template part “header”". */
export const layoutName = (l: Layout) => `the ${KINDS[l.kind]} “${l.slug}”`;

/** "<kind>:<slug>" of a template, part or pattern, as the editor sends it; anything else is null. */
export function templateKey(v: unknown): string | null {
  const s = String(v ?? '');
  return /^(template|part|pattern):[a-z0-9][a-z0-9_-]{0,120}$/.test(s) ? s : null;
}

/** The layout a turn works on, from the editor's JSON; null when it isn't one. */
export function layoutOf(v: unknown): Layout | null {
  try {
    const l = JSON.parse(String(v ?? ''));
    return templateKey(`${l?.kind}:${l?.slug}`) ? { kind: l.kind, slug: l.slug, page: l.page === true } : null;
  } catch {
    return null;
  }
}
