// Content types an admin made (Settings > Types: Add a type), kept in the site settings
// (settings.site.types) beside the site's own (src/site/config.ts), which win: a made type with the
// name of one in the code is left out. Checked here, with no other imports, so the server, the admin's
// browser and src/lib/site share it.
import type { ContentType, FieldDef } from './types';
import { cleanBase, taxonomyName } from './taxonomy-settings';

/** The kinds of field the types editor offers. */
export const FIELD_KINDS: [FieldKind, string][] = [
  ['text', 'Text'],
  ['textarea', 'Longer text'],
  ['html', 'Formatted text'],
  ['url', 'Web address'],
  ['email', 'Email address'],
  ['number', 'Number'],
  ['bool', 'Yes or no'],
  ['image', 'Image'],
  ['select', 'Choice from a list'],
];
export type FieldKind = 'text' | 'textarea' | 'html' | 'url' | 'email' | 'number' | 'bool' | 'image' | 'select';

/** A type an admin made: what the code's types say, kept to what the editor sets. */
export interface MadeType {
  /** Stored in entries.type; made from the singular name when it is first saved, then kept. */
  type: string;
  label: string;
  singular: string;
  /** URL segment for its entries ("products" serves /products/<slug>/). None: they live at /<slug>/. */
  base?: string;
  /** Its listing page ("/products/"). */
  archive?: string;
  /** Data only, with no page of its own (a plain form). */
  record?: boolean;
  /** For Compose: what an entry of this type is. */
  describe?: string;
  /** Default order of its listings: newest first or by name. */
  order?: 'date' | 'title';
  fields: FieldDef[];
}

/** Field keys the core keeps for itself in entries.fields. */
export const RESERVED_FIELD_KEYS = ['seo', 'access', 'template', 'featured', 'tickets', 'recurrence', 'timezone', 'imported_from'];
/** Type names the core uses for other things. */
export const RESERVED_TYPES = ['page', 'post', 'global', 'event', 'venue', 'any', 'terms', 'tags', 'tag', 'search', 'all'];

const text = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A made type's fields as stored: known kinds, keys from their labels (unique, not the core's), select options. */
export function fieldsFrom(v: unknown): FieldDef[] {
  if (!Array.isArray(v)) return [];
  const keys = new Set(RESERVED_FIELD_KEYS);
  const out: FieldDef[] = [];
  for (const raw of v.slice(0, 40)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const label = text(r.label, 60);
    const kind = FIELD_KINDS.find(([k]) => k === r.type)?.[0];
    if (!label || !kind) continue;
    let key = typeof r.key === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(r.key) ? r.key : taxonomyName(label);
    if (!key) continue;
    for (let n = 2; keys.has(key); n++) key = `${taxonomyName(label).slice(0, 36)}_${n}`;
    keys.add(key);
    const compose = r.compose ? text(r.compose, 120) : '';
    if (kind === 'select') {
      const options = (Array.isArray(r.options) ? r.options : String(r.options ?? '').split('\n'))
        .map((o) => (Array.isArray(o) ? [text(o[0], 60), text(o[1] ?? o[0], 60)] : [text(o, 60), text(o, 60)]))
        .filter(([value]) => value)
        .slice(0, 50) as [string, string][];
      if (!options.length) continue;
      out.push({ key, label, type: 'select', options, ...(compose ? { compose } : {}) });
    } else out.push({ key, label, type: kind, ...(compose ? { compose } : {}) });
  }
  return out;
}

/**
 * The types an admin made, as stored: each with a known name, names to show and its fields, never a
 * name the site's code uses (`taken`, which wins) or the core keeps, and no two with one name.
 */
export function madeTypesFrom(v: unknown, taken: string[]): MadeType[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set([...taken, ...RESERVED_TYPES]);
  const out: MadeType[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const type = typeof r.type === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(r.type) ? r.type : '';
    const label = text(r.label, 60);
    const singular = text(r.singular, 60) || label;
    if (!type || !label || seen.has(type)) continue;
    seen.add(type);
    const t: MadeType = { type, label, singular, fields: fieldsFrom(r.fields) };
    const record = r.record === true;
    if (record) t.record = true;
    const base = cleanBase(r.base);
    if (base && !record) t.base = base;
    const archive = cleanBase(r.archive);
    if (archive && !record) t.archive = archive;
    const describe = text(r.describe, 300);
    if (describe) t.describe = describe;
    if (r.order === 'title') t.order = 'title';
    out.push(t);
  }
  return out;
}

/** A made type as the site's types are: a record's address is its base, its listing path in slashes. */
export function asContentType(t: MadeType): ContentType {
  return {
    type: t.type,
    label: t.label,
    singular: t.singular,
    ...(t.base ? { base: t.base } : {}),
    ...(t.archive ? { archive: `/${t.archive}/` } : {}),
    ...(t.record ? { record: true } : {}),
    ...(t.describe ? { describe: t.describe } : {}),
    ...(t.order ? { order: t.order } : {}),
    fields: t.fields,
    made: true,
  };
}
