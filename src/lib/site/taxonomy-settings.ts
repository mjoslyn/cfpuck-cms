// Taxonomies set in the admin (Content > Taxonomies), kept in the site settings beside the site's own
// (src/site/config.ts): taxonomies an admin made (settings.site.taxonomies), each with the types it
// belongs to, and types an admin added to one of the site's (settings.site.taxonomy_types). Checked
// here, with no other imports, so the server, the admin's browser and src/lib/site share it.

/** A taxonomy an admin made. */
export interface MadeTaxonomy {
  /** Stored in terms.taxonomy; made from the label when it is first saved, then kept. */
  name: string;
  /** Plural, as the admin shows it ("Colors"). */
  label: string;
  /** One term ("Color"). */
  singular?: string;
  /** URL base of its term pages ("colors" serves /colors/<slug>/); none: no term pages. */
  base?: string;
  /** Terms in a flat list, like tags, rather than nested under each other. */
  flat?: boolean;
  /** The types it belongs to. */
  types: string[];
}

/** Addresses a taxonomy's term pages can't start with: the site's own routes. */
export const RESERVED_BASES = ['admin', 'api', 'media', 'assets', 'search', 'm', 'account', 'subscribe', 'unsubscribe', 'email-preferences', 'cdn-cgi', 'page', 'feed'];

/** A taxonomy name from its label: lowercase letters, digits and underscores, starting with a letter. */
export function taxonomyName(label: string): string {
  const s = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+|_+$/g, '');
  return s.slice(0, 32).replace(/_+$/, '');
}

/** A URL base as stored: path segments of lowercase letters, digits and hyphens, without slashes around it. */
export function cleanBase(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .split('/')
    .map((s) => s.trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('/');
}

const text = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The taxonomies an admin made, as stored: each with a known name, a label and its types (those of
 * `types` only), never a name the site's code uses (`taken`), and no two with one name.
 */
export function madeTaxonomiesFrom(v: unknown, types: string[], taken: string[]): MadeTaxonomy[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set(taken);
  const out: MadeTaxonomy[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(r.name) ? r.name : '';
    const label = text(r.label, 60);
    if (!name || !label || seen.has(name)) continue;
    seen.add(name);
    const t: MadeTaxonomy = { name, label, types: Array.isArray(r.types) ? types.filter((x) => (r.types as unknown[]).includes(x)) : [] };
    const singular = text(r.singular, 60);
    if (singular) t.singular = singular;
    const base = cleanBase(r.base);
    if (base) t.base = base;
    if (r.flat === true) t.flat = true;
    out.push(t);
  }
  return out;
}

/** Types an admin added to the site's own taxonomies: { taxonomy: types }, known names only, none repeated. */
export function taxonomyTypesFrom(v: unknown, taxonomies: string[], types: string[]): Record<string, string[]> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [tax, list] of Object.entries(v as Record<string, unknown>)) {
    if (!taxonomies.includes(tax) || !Array.isArray(list)) continue;
    const kept = types.filter((t) => list.includes(t));
    if (kept.length) out[tax] = kept;
  }
  return out;
}

/**
 * Why a URL base can't be used, or null: one of the site's routes, or the address of a type's pages,
 * a listing or another taxonomy (`used`: those, without slashes around them).
 */
export function baseProblem(base: string, used: string[]): string | null {
  if (!base) return null;
  if (RESERVED_BASES.includes(base.split('/')[0])) return `"/${base}/" is one of the site's own addresses.`;
  if (used.includes(base)) return `"/${base}/" is already used by another type or taxonomy.`;
  return null;
}
