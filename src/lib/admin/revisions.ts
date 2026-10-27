// Saved versions of an entry (the revisions table), listed in the editor's Revisions panel. Each manual
// save (Save draft, Publish, Unpublish, a record's form) is a checkpoint, a row of its own. Autosaves
// between them keep one row per stretch of editing: an autosave writes over the newest row while that row
// is the same person's autosave, begun less than AUTOSAVE_SPAN ago, so the history keeps a version every
// ten minutes of editing rather than one every few seconds. A save in layout mode keeps the template's
// content too (`template`), since that is what the page is edited as.
import type { Db } from '../db/query';
import { areaItems, areaProp, MAIN_AREA } from '../content/areas';

export const AUTOSAVE_SPAN = 10 * 60 * 1000;
export const AUTOSAVE = 'autosave';

export interface RevisionInput {
  entry_id: number;
  title: string;
  content: unknown;
  fields: unknown;
  entry: unknown;
  action: string;
  author_id: string;
  restored_from?: number;
  restored_edited?: boolean;
  /** Said with the save (a page published with accessibility problems left open, and why). */
  note?: string | null;
  /** Layout mode: the template as saved with the page. */
  template?: { kind: string; slug: string; content: unknown } | null;
}

export async function recordRevision(db: Db, row: RevisionInput, autosave: boolean, now = new Date()): Promise<{ error: { message: string } | null }> {
  const saved_at = now.toISOString();
  const values = { ...row, action: autosave ? AUTOSAVE : row.action, restored_from: row.restored_from ?? null, restored_edited: row.restored_from ? !!row.restored_edited : null, template: row.template ?? null, note: row.note ?? null, saved_at };
  if (autosave) {
    const { data: last } = await db.from('revisions').select('id, action, author_id, created_at').eq('entry_id', row.entry_id).order('id', { ascending: false }).limit(1).maybeSingle();
    if (last && last.action === AUTOSAVE && last.author_id === row.author_id && now.getTime() - Date.parse(last.created_at) < AUTOSAVE_SPAN) {
      const { error } = await db.from('revisions').update(values).eq('id', last.id);
      return { error };
    }
  }
  const { error } = await db.from('revisions').insert({ ...values, created_at: saved_at });
  return { error };
}

type Doc = { content?: unknown[]; root?: { props?: Record<string, unknown> } };

/**
 * The editor's document as a saved version had it: its main content and, for each of the template's
 * other content areas, its blocks there (none where it had none), patterns expanded by `inline`. The
 * document's other root props (accessibility marks) stay as they are now.
 */
export async function versionDoc<D extends Doc>(current: D, saved: Doc, areas: string[], inline: (items: any[]) => Promise<any[]>): Promise<D> {
  const props: Record<string, unknown> = { ...(current.root?.props ?? {}) };
  for (const area of areas) if (area !== MAIN_AREA) props[areaProp(area)] = await inline(areaItems(saved, area));
  return { ...current, root: { ...current.root, props }, content: await inline(areaItems(saved, MAIN_AREA)) };
}
