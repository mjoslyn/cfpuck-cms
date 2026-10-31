// The site's configuration and everything derived from it. Core code reads content types, URLs,
// taxonomies, timezone and identity from here, never from src/site directly.
import siteConfig from '../../site/config';
import movedPaths from '../../site/moved-paths.json';
import presets from '../../site/presets.json';
import type { ContentType, EventsConfig, FieldDef, SiteConfig, Taxonomy, TypeExtension } from './types';
import { withEvents } from '../events/types';
import { madeTaxonomiesFrom, taxonomyTypesFrom, type MadeTaxonomy } from './taxonomy-settings';

export type { ContentType, EventsConfig, FieldDef, SiteConfig, Taxonomy, TypeExtension };

// The site's config with the core's optional features' types added (Events: src/lib/events/types.ts).
const config: SiteConfig = { ...siteConfig, ...withEvents(siteConfig.types, siteConfig.taxonomies, siteConfig.events) };

for (const t of ['page', 'post', 'global']) if (!config.types.some((c) => c.type === t)) throw new Error(`site config: the "${t}" content type is required`);
for (const t of ['category', 'tag']) if (!config.taxonomies.some((c) => c.name === t)) throw new Error(`site config: the "${t}" taxonomy is required`);

export const site: SiteConfig = config;
/** Path prefixes the site moved ([old, new] pairs, src/site/moved-paths.json). */
export const MOVED_PATHS = movedPaths as [string, string][];
/** The colors, font sizes and spacing the editor offers (src/site/presets.json). */
export const PRESETS = presets;
/**
 * The site's timezone: the admin setting (settings.site.timezone) when there is one, else the config's.
 * A live binding: the server sets it from the settings (src/lib/site/timezone.ts, per request, cached),
 * admin pages hand it to the browser as window.__siteTz.
 */
export let SITE_TZ: string = (typeof window !== 'undefined' && (window as any).__siteTz) || config.timezone;
export function setSiteTimezone(tz: string | undefined | null) {
  SITE_TZ = tz && isTimezone(tz) ? tz : config.timezone;
}
/** A name the runtime's time zone data knows ("America/New_York"). */
export function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Content types in admin order (hidden ones left out). */
export const CONTENT_TYPES: ContentType[] = config.types.filter((t) => !t.hidden);
export const typeDef = (type: string): ContentType | undefined => config.types.find((t) => t.type === type);
export const typeLabel = (type: string) => typeDef(type)?.singular ?? type;

/** Data only, with no page of their own: edited with a plain form, not the page editor. */
export const RECORD_TYPES = new Set(config.types.filter((t) => t.record).map((t) => t.type));
/** No public page of their own (no URL or View link in the admin). */
export const PAGELESS_TYPES = new Set(config.types.filter((t) => t.record || t.pageless).map((t) => t.type));
/** Types Compose can create: those with a page of their own. */
export const COMPOSABLE_TYPES = CONTENT_TYPES.filter((t) => !PAGELESS_TYPES.has(t.type));
/** Types a collection, search or random list may show: public types other than plain pages. */
export const LISTABLE_TYPES = config.types.filter((t) => !PAGELESS_TYPES.has(t.type) && t.type !== 'page').map((t) => t.type);
/** Types site search can cover: every type with a page. */
export const SEARCHABLE_TYPES = ['page', ...LISTABLE_TYPES];
/** The types search covers: the admin's choice under Settings (settings.site.search_types), else all. */
export function searchTypes(siteSettings: Record<string, any> | undefined): string[] {
  const chosen = siteSettings?.search_types;
  if (!Array.isArray(chosen)) return SEARCHABLE_TYPES;
  return SEARCHABLE_TYPES.filter((t) => chosen.includes(t));
}

/** A type's fields: the site config's, with Featured when an admin turned it on for the type (Settings > Types). */
export const fieldsFor = (type: string): FieldDef[] => {
  const own = typeDef(type)?.fields ?? [];
  return FEATURED_TYPES.has(type) && !own.some((f) => f.key === 'featured') ? [...own, FEATURED_FIELD] : own;
};
/** The Featured toggle an admin can give a type (fields.featured), which collections and the Map can list alone. */
export const FEATURED_FIELD: FieldDef = { key: 'featured', label: 'Featured', type: 'bool' };
/** Types an admin gave Featured (settings.site.featured_types), as last applied. */
let FEATURED_TYPES = new Set<string>();
/** Whether the site's code gives a type a `featured` field of its own. */
export const codeFeatured = (type: string) => (typeDef(type)?.fields ?? []).some((f) => f.key === 'featured');
/** Whether a type's entries can be marked featured: a field of the site's own, or Featured turned on for it. */
export const featuredOn = (type: string) => codeFeatured(type) || FEATURED_TYPES.has(type);
/** Featured types as stored: known types other than globals. */
export const featuredTypesFrom = (v: unknown): string[] | undefined => {
  const out = Array.isArray(v) ? config.types.filter((t) => t.type !== 'global' && v.includes(t.type)).map((t) => t.type) : [];
  return out.length ? out : undefined;
};

/** URL segment for single entries of a type (/directory/<slug>/). */
export const TYPE_BASES: Record<string, string> = Object.fromEntries(config.types.filter((t) => t.base).map((t) => [t.type, t.base!]));
/** The types whose entries share `type`'s addresses: every type without a URL base lives at /<slug>/. */
export const typesSharingAddresses = (type: string): string[] =>
  TYPE_BASES[type] || PAGELESS_TYPES.has(type) ? [type] : config.types.filter((t) => !t.base && !PAGELESS_TYPES.has(t.type)).map((t) => t.type);
/** Listing page of a type. */
export const ARCHIVE_PATHS: Record<string, string> = Object.fromEntries(config.types.filter((t) => t.archive).map((t) => [t.type, t.archive!]));
/** The site's own taxonomies (its config, with the core's features'), before any an admin made. */
export const CODE_TAXONOMIES: readonly Taxonomy[] = [...config.taxonomies];
/** URL base of a taxonomy's term pages. */
export const TAXONOMY_BASES: Record<string, string> = Object.fromEntries(config.taxonomies.filter((t) => t.base).map((t) => [t.name, t.base]));
/** Types an admin gave a taxonomy (Content > Taxonomies): all of a made one's, those added to the site's own. */
let ADDED_TYPES: Record<string, string[]> = {};
/** The taxonomies an admin made, as last applied. */
export let MADE_TAXONOMIES: MadeTaxonomy[] = [];
/** Types an admin added to the site's own taxonomies, as last applied. */
export let ADDED_TO_CODE: Record<string, string[]> = {};

/**
 * Applies the types' settings an admin made: Featured per type (settings.site.featured_types, through
 * fieldsFor and featuredOn), and the taxonomies (settings.site.taxonomies, taxonomy_types), to the site's: the
 * made ones join `site.taxonomies` and TAXONOMY_BASES (changed in place, so code holding them sees it),
 * and every one's added types count in taxonomiesOf. A live binding, like SITE_TZ: the server applies it
 * from the settings (src/lib/site/timezone.ts, cached a minute), admin pages hand the browser
 * window.__siteTypes.
 */
export function applyTypeSettings(siteSettings: Record<string, any> | null | undefined) {
  const typeNames = config.types.filter((t) => t.type !== 'global').map((t) => t.type);
  const codeNames = CODE_TAXONOMIES.map((t) => t.name);
  MADE_TAXONOMIES = madeTaxonomiesFrom(siteSettings?.taxonomies, typeNames, codeNames);
  const added = taxonomyTypesFrom(siteSettings?.taxonomy_types, codeNames.filter((n) => n !== 'tag'), typeNames);
  const made: Taxonomy[] = MADE_TAXONOMIES.map((t) => ({ name: t.name, label: t.label, singular: t.singular, base: t.base ?? '', flat: t.flat, made: true }));
  config.taxonomies.splice(0, config.taxonomies.length, ...CODE_TAXONOMIES, ...made);
  for (const k of Object.keys(TAXONOMY_BASES)) delete TAXONOMY_BASES[k];
  for (const t of config.taxonomies) if (t.base) TAXONOMY_BASES[t.name] = t.base;
  ADDED_TO_CODE = added;
  FEATURED_TYPES = new Set(featuredTypesFrom(siteSettings?.featured_types) ?? []);
  ADDED_TYPES = { ...added, ...Object.fromEntries(MADE_TAXONOMIES.map((t) => [t.name, t.types])) };
}
/** What window.__siteTypes carries: the settings applyTypeSettings reads, as applied now. */
export const appliedTypeSettings = () => ({ taxonomies: MADE_TAXONOMIES, taxonomy_types: ADDED_TO_CODE, featured_types: [...FEATURED_TYPES] });
/** Whether a taxonomy's terms are a flat list (tags, and made ones set so), not nested. */
export const isFlat = (name: string) => name === 'tag' || !!config.taxonomies.find((t) => t.name === name)?.flat;
/** The types the site's code gives a taxonomy, which an admin can't take away. */
export const codeTypesOf = (taxonomy: string) => config.types.filter((t) => [t.category, ...(t.taxonomies ?? [])].includes(taxonomy)).map((t) => t.type);

export const taxonomyLabel = (name: string) => config.taxonomies.find((t) => t.name === name)?.label ?? name;
/** One term of a taxonomy, as suggestions and filters name it. */
export const taxonomySingular = (name: string) => { const t = config.taxonomies.find((x) => x.name === name); return t?.singular ?? t?.label ?? name; };
export const isTaxonomy = (name: string) => config.taxonomies.some((t) => t.name === name);
/** The type a term page of a taxonomy lists: its `types`, the type it categorises, or every type ('any'). */
export function termPageType(taxonomy: string): string {
  const tax = config.taxonomies.find((t) => t.name === taxonomy);
  if (tax?.lists) return tax.lists;
  const typed = config.types.filter((t) => taxonomiesOf(t.type).includes(taxonomy));
  return typed.length === 1 ? typed[0].type : 'any';
}

/** The taxonomy collections filter a type by, with its label. */
export const categoryOf = (type: string): [string, string] | undefined => {
  const tax = typeDef(type)?.category ?? typeDef(type)?.taxonomies?.[0];
  return tax ? [tax, taxonomyLabel(tax)] : undefined;
};

/** A type's taxonomies, its main one first (tags, which every type has, aside): the site's code's, then
 *  those an admin gave it (Content > Taxonomies). */
export function taxonomiesOf(type: string): string[] {
  const t = typeDef(type);
  const added = Object.entries(ADDED_TYPES).filter(([, types]) => types.includes(type)).map(([tax]) => tax);
  return [...new Set([t?.category, ...(t?.taxonomies ?? []), ...added])].filter((x): x is string => !!x && x !== 'tag' && config.taxonomies.some((c) => c.name === x));
}

/** The types a taxonomy belongs to. */
export const typesOfTaxonomy = (taxonomy: string) => config.types.filter((t) => taxonomiesOf(t.type).includes(taxonomy)).map((t) => t.type);

// In the admin's browser: the settings the page was served with.
if (typeof window !== 'undefined' && (window as any).__siteTypes) applyTypeSettings((window as any).__siteTypes);
