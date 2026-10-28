// Rename a template, part or pattern: its name in the lists and pickers, and its address (slug). A new
// address is written wherever the site names the old one (pages and their unpublished changes, other
// templates, Settings > Types, terms, Compose conversations), and the old one is kept in former_slugs,
// so anything that still names it (a revision, a site's code, another copy) finds the template.
import type { Db } from '../db/query';
import type { PuckItem } from '../puck/types';
import { slugify } from '../slug';

/** The longest name a template takes. */
export const TEMPLATE_TITLE_MAX = 120;

type Kind = 'template' | 'part' | 'pattern';
type Doc = { content?: unknown; root?: { props?: Record<string, unknown> }; zones?: Record<string, unknown> };

/** A template's address as typed: lowercase letters, digits and hyphens. */
export const templateSlug = (s: string) => slugify(s);

/**
 * A page document with blocks placing part or pattern `from` placing `to` instead, or null when it has
 * none. A header or footer part keeps its role (`area`: the element and how its images load) under its
 * new address.
 */
export function renameInDoc(doc: Doc | null | undefined, kind: 'part' | 'pattern', from: string, to: string): Doc | null {
  if (!doc || typeof doc !== 'object') return null;
  let changed = false;
  const walk = (items: unknown): unknown => {
    if (!Array.isArray(items)) return items;
    return (items as PuckItem[]).map((i) => {
      if (!i || typeof i !== 'object' || !i.props) return i;
      let next = i;
      const attrs = (i.props as any).attrs;
      if (i.type === kind && attrs?.slug === from) {
        changed = true;
        const area = kind === 'part' && !attrs.area && (from === 'header' || from === 'footer') ? { area: from } : {};
        next = { ...i, props: { ...i.props, attrs: { ...attrs, ...area, slug: to } } } as PuckItem;
      }
      return next.props.children ? ({ ...next, props: { ...next.props, children: walk(next.props.children) as PuckItem[] } } as PuckItem) : next;
    });
  };
  const content = walk(doc.content);
  const props = doc.root?.props ? Object.fromEntries(Object.entries(doc.root.props).map(([k, v]) => [k, k.startsWith('area-') ? walk(v) : v])) : undefined;
  const zones = doc.zones ? Object.fromEntries(Object.entries(doc.zones).map(([k, v]) => [k, walk(v)])) : undefined;
  if (!changed) return null;
  return { ...doc, content, ...(props ? { root: { ...doc.root, props } } : {}), ...(zones ? { zones } : {}) };
}

/** Settings > Types' choices with template `from` chosen as `to`, or null when none chose it. */
export function renameInSiteSettings(site: Record<string, any> | null | undefined, from: string, to: string): Record<string, any> | null {
  if (!site) return null;
  let changed = false;
  const swap = (v: unknown) => (v === from ? ((changed = true), to) : v);
  const templates = site.templates && typeof site.templates === 'object' ? Object.fromEntries(Object.entries(site.templates as Record<string, Record<string, unknown>>).map(([type, m]) => [type, m && typeof m === 'object' ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, swap(v)])) : m])) : site.templates;
  const taxonomy = site.taxonomy_templates && typeof site.taxonomy_templates === 'object' ? Object.fromEntries(Object.entries(site.taxonomy_templates as Record<string, unknown>).map(([k, v]) => [k, swap(v)])) : site.taxonomy_templates;
  return changed ? { ...site, templates, taxonomy_templates: taxonomy } : null;
}

export interface Renamed {
  title: string;
  slug: string;
  /** Rows that named the old address and now name the new one. */
  updated: number;
  /** Rows that couldn't be changed (they still find the template by its former address). */
  failed: number;
}

/**
 * Rename template `kind`/`slug` to `title`, at address `nextSlug` (default: as it is). `db` changes the
 * template itself (the person's own access); `refs`, the server's, writes the new address where the site
 * names the old one, which may be settings an editor can't change otherwise.
 */
export async function renameTemplate(db: Db, kind: Kind, slug: string, input: { title: string; slug?: string }, refs: Db = db): Promise<Renamed> {
  const name = input.title.replace(/\s+/g, ' ').trim().slice(0, TEMPLATE_TITLE_MAX);
  if (!name) throw new Error('Give it a name.');
  const next = input.slug === undefined ? slug : templateSlug(input.slug);
  if (!next) throw new Error('Give it an address: letters, numbers and hyphens.');
  const { data: t } = await db.from('templates').select('updated_at, former_slugs').eq('kind', kind).eq('slug', slug).maybeSingle();
  if (!t) throw new Error('That template no longer exists.');
  if (next !== slug) {
    const { data: taken } = await db.from('templates').select('id, trashed_at').eq('kind', kind).eq('slug', next).maybeSingle();
    if (taken) throw new Error(`Another ${kind} has the address ${next}${taken.trashed_at ? ' (in the trash: delete it there first)' : ''}.`);
  }
  // Its former addresses, the one it leaves included, never the one it takes.
  const former = [...new Set([...((t.former_slugs as string[] | null) ?? []), ...(next !== slug ? [slug] : [])])].filter((s) => s !== next);
  // The stored version is unchanged: an editor open on it saves without being asked about a newer one.
  const { error } = await db.from('templates').update({ title: name, slug: next, former_slugs: former, updated_at: t.updated_at }).eq('kind', kind).eq('slug', slug);
  if (error) throw new Error(error.message);
  const result: Renamed = { title: name, slug: next, updated: 0, failed: 0 };
  if (next !== slug) await renameReferences(refs, kind, slug, next, result);
  return result;
}

/** Write template `to` wherever the site names `from`, counting the rows changed and those that failed. */
async function renameReferences(db: Db, kind: Kind, from: string, to: string, count: { updated: number; failed: number }) {
  const done = (error: { message: string } | null) => (error ? count.failed++ : count.updated++);
  // Another template of this kind that had the address before keeps no claim on it.
  const { data: others } = await db.from('templates').select('id, former_slugs').eq('kind', kind).neq('slug', to);
  for (const o of others ?? []) {
    const f = (o.former_slugs as string[] | null) ?? [];
    if (f.includes(to)) done((await db.from('templates').update({ former_slugs: f.filter((s) => s !== to) }).eq('id', o.id)).error);
  }
  // Compose conversations about it.
  const { data: sessions } = await db.from('compose_sessions').select('id').eq('template', `${kind}:${from}`);
  for (const s of sessions ?? []) done((await db.from('compose_sessions').update({ template: `${kind}:${to}` }).eq('id', s.id)).error);
  // Only rows whose text names the address at all are read.
  const quoted = `%${JSON.stringify(from)}%`;
  if (kind === 'part' || kind === 'pattern') {
    const { data: tpls } = await db.from('templates').select('id, content, updated_at').like('content', quoted);
    for (const r of tpls ?? []) {
      const doc = renameInDoc(r.content as Doc, kind, from, to);
      if (doc) done((await db.from('templates').update({ content: doc, updated_at: r.updated_at }).eq('id', r.id)).error);
    }
    const { data: entries } = await db.from('entries').select('id, content, updated_at').like('content', quoted);
    for (const r of entries ?? []) {
      const doc = renameInDoc(r.content as Doc, kind, from, to);
      if (doc) done((await db.from('entries').update({ content: doc, updated_at: r.updated_at }).eq('id', r.id)).error);
    }
    const { data: drafts } = await db.from('entry_drafts').select('entry_id, draft').like('draft', quoted);
    for (const r of drafts ?? []) {
      const draft = r.draft as { content?: Doc } | null;
      const doc = renameInDoc(draft?.content, kind, from, to);
      if (doc) done((await db.from('entry_drafts').update({ draft: { ...draft, content: doc } }).eq('entry_id', r.entry_id)).error);
    }
    return;
  }
  // A template: the entries that chose it, their unpublished changes, Settings > Types and terms.
  const { data: entries } = await db.from('entries').select('id, updated_at').eq('template', from);
  for (const r of entries ?? []) done((await db.from('entries').update({ template: to, updated_at: r.updated_at }).eq('id', r.id)).error);
  const { data: drafts } = await db.from('entry_drafts').select('entry_id, draft').like('draft', quoted);
  for (const r of drafts ?? []) {
    const draft = r.draft as { entry?: Record<string, unknown> } | null;
    if (draft?.entry?.template === from) done((await db.from('entry_drafts').update({ draft: { ...draft, entry: { ...draft.entry, template: to } } }).eq('entry_id', r.entry_id)).error);
  }
  const { data: site } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  const nextSite = renameInSiteSettings(site?.value as Record<string, any> | undefined, from, to);
  if (nextSite) done((await db.from('settings').update({ value: nextSite }).eq('key', 'site')).error);
  const { data: terms } = await db.from('terms').select('id, fields').like('fields', quoted);
  for (const r of terms ?? []) {
    const fields = r.fields as Record<string, unknown> | null;
    if (fields?.template === from) done((await db.from('terms').update({ fields: { ...fields, template: to } }).eq('id', r.id)).error);
  }
}
