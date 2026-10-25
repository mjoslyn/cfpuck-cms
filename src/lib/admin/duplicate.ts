// Duplicate an entry or a template. A copy is a new, unpublished draft titled "<title> (copy)" with its
// own address; it has the original's content (with any unpublished changes), fields, tags and other
// terms, template, featured image and dates. Revisions and publish dates stay
// with the original.
import type { Db } from '../db/query';
import { renderedTitle, uniqueSlug } from './save';
import { slugify } from '../slug';

const copyTitle = (title: string) => (title ? `${title} (copy)` : '');

/** Copy entry `id`; returns the copy's id. */
export async function duplicateEntry(db: Db, id: number): Promise<number> {
  const { data: e, error } = await db.from('entries').select('*').eq('id', id).single();
  if (error || !e) throw new Error('That entry no longer exists.');
  // Unpublished changes are what the editor shows: the copy starts from them.
  const { data: pending } = await db.from('entry_drafts').select('draft').eq('entry_id', id).maybeSingle();
  const draft = (pending?.draft ?? null) as { content?: unknown; entry?: Record<string, any> | null } | null;
  const title = copyTitle(String(draft?.entry?.title ?? e.title ?? ''));
  const slug = await uniqueSlug(db, e.type, slugify(title) || `${e.slug}-copy`);
  const row = {
    type: e.type,
    slug,
    title,
    title_rendered: renderedTitle(title),
    excerpt: draft?.entry?.excerpt ?? e.excerpt,
    excerpt_rendered: e.excerpt_rendered,
    status: 'draft',
    template: draft?.entry?.template ?? e.template,
    parent_id: e.parent_id,
    menu_order: e.menu_order,
    featured_media_id: draft?.entry?.featured_media_id ?? e.featured_media_id,
    fields: draft?.entry?.fields ?? e.fields,
    content: draft?.content ?? e.content,
    event_start: e.event_start,
    event_end: e.event_end,
    event_all_day: e.event_all_day,
  };
  const { data: copy, error: insErr } = await db.from('entries').insert(row).select('id').single();
  if (insErr || !copy) throw new Error(insErr?.message ?? 'Could not copy the entry.');
  const { data: terms } = await db.from('entry_terms').select('term_id, sort').eq('entry_id', id);
  if (terms?.length) {
    const { error: tErr } = await db.from('entry_terms').insert(terms.map((t) => ({ entry_id: copy.id, term_id: t.term_id, sort: t.sort })));
    if (tErr) throw new Error(tErr.message);
  }
  return copy.id;
}

/** Copy a template, part or pattern; returns the copy's slug. */
export async function duplicateTemplate(db: Db, kind: string, slug: string): Promise<string> {
  const { data: t, error } = await db.from('templates').select('kind, slug, title, content').eq('kind', kind).eq('slug', slug).single();
  if (error || !t) throw new Error('That template no longer exists.');
  const { data: same } = await db.from('templates').select('slug').eq('kind', kind).like('slug', `${slug}-copy%`);
  const used = new Set((same ?? []).map((r) => r.slug));
  let next = `${slug}-copy`;
  for (let n = 2; used.has(next); n++) next = `${slug}-copy-${n}`;
  const { error: insErr } = await db.from('templates').insert({ kind, slug: next, title: copyTitle(t.title || t.slug), content: t.content });
  if (insErr) throw new Error(insErr.message);
  return next;
}
