// Rename a template, part or pattern: its name in the lists and pickers. The address-like slug stays,
// since pages, settings, terms and placed parts and patterns refer to it.
import type { Db } from '../db/query';

/** The longest name a template takes. */
export const TEMPLATE_TITLE_MAX = 120;

/** Set the name of template `kind`/`slug`; returns the name as saved. */
export async function renameTemplate(db: Db, kind: string, slug: string, title: string): Promise<string> {
  const name = title.replace(/\s+/g, ' ').trim().slice(0, TEMPLATE_TITLE_MAX);
  if (!name) throw new Error('Give it a name.');
  const { data: t } = await db.from('templates').select('updated_at').eq('kind', kind).eq('slug', slug).maybeSingle();
  if (!t) throw new Error('That template no longer exists.');
  // The stored version is unchanged: an editor open on it saves without being asked about a newer one.
  const { error } = await db.from('templates').update({ title: name, updated_at: t.updated_at }).eq('kind', kind).eq('slug', slug);
  if (error) throw new Error(error.message);
  return name;
}
