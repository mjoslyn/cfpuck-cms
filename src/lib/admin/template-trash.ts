// Templates, parts and patterns in the trash: a trashed one (templates.trashed_at) doesn't render and
// isn't offered in pickers, keeps its address and content, and comes back with Restore; Delete
// permanently removes it from the trash. Before trashing, the list says what uses it.
import type { Db } from '../db/query';
import { renameInDoc, renameInSiteSettings } from './rename-template';

type Kind = 'template' | 'part' | 'pattern';

/** What uses a template, part or pattern: pages (and other templates) by title, and settings that chose it. */
export interface TemplateUses {
  /** Titles of the entries that place or chose it (not those in the trash). */
  entries: string[];
  /** Names of the templates, parts and patterns that place it. */
  templates: string[];
  /** Whether Settings > Types chose it for a type or a taxonomy. */
  settings: boolean;
  /** Names of the terms that chose it. */
  terms: string[];
}

/** Whether a page document places part or pattern `slug`. */
const places = (doc: unknown, kind: 'part' | 'pattern', slug: string) => renameInDoc(doc as any, kind, slug, `${slug}\u0000`) !== null;

export async function templateUses(db: Db, kind: Kind, slug: string): Promise<TemplateUses> {
  const uses: TemplateUses = { entries: [], templates: [], settings: false, terms: [] };
  const quoted = `%${JSON.stringify(slug)}%`;
  if (kind === 'part' || kind === 'pattern') {
    const { data: tpls } = await db.from('templates').select('kind, slug, title, content').like('content', quoted).is('trashed_at', null);
    for (const t of tpls ?? []) if (!(t.kind === kind && t.slug === slug) && places(t.content, kind, slug)) uses.templates.push(t.title || t.slug);
    const { data: entries } = await db.from('entries').select('title, content').like('content', quoted).neq('status', 'trash');
    for (const e of entries ?? []) if (places(e.content, kind, slug)) uses.entries.push(e.title || '(untitled)');
    return uses;
  }
  const { data: entries } = await db.from('entries').select('title').eq('template', slug).neq('status', 'trash');
  uses.entries = (entries ?? []).map((e) => e.title || '(untitled)');
  const { data: site } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  uses.settings = renameInSiteSettings(site?.value as Record<string, any> | undefined, slug, `${slug}\u0000`) !== null;
  const { data: terms } = await db.from('terms').select('name, fields').like('fields', quoted);
  uses.terms = (terms ?? []).filter((t) => (t.fields as Record<string, unknown> | null)?.template === slug).map((t) => t.name);
  return uses;
}

/** The row, or an error saying it's gone. */
async function row(db: Db, kind: Kind, slug: string) {
  const { data, error } = await db.from('templates').select('id, updated_at, trashed_at').eq('kind', kind).eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That template no longer exists.');
  return data;
}

/** Move a template, part or pattern to the trash (its stored version stays, so restoring needs no reload). */
export async function trashTemplate(db: Db, kind: Kind, slug: string): Promise<void> {
  const t = await row(db, kind, slug);
  const { error } = await db.from('templates').update({ trashed_at: new Date().toISOString(), updated_at: t.updated_at }).eq('id', t.id);
  if (error) throw new Error(error.message);
}

/** Take a template, part or pattern out of the trash. */
export async function restoreTemplate(db: Db, kind: Kind, slug: string): Promise<void> {
  const t = await row(db, kind, slug);
  const { error } = await db.from('templates').update({ trashed_at: null, updated_at: t.updated_at }).eq('id', t.id);
  if (error) throw new Error(error.message);
}

/** Delete a template, part or pattern for good; only one in the trash. */
export async function deleteTemplate(db: Db, kind: Kind, slug: string): Promise<void> {
  const t = await row(db, kind, slug);
  if (!t.trashed_at) throw new Error('Move it to the trash first.');
  const { error } = await db.from('templates').delete().eq('id', t.id);
  if (error) throw new Error(error.message);
}
