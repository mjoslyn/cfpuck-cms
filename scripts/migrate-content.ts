// Content migrations: rewrite stored Puck documents (entries, unpublished drafts, templates, revisions)
// with the site's migrations (src/site/migrations). Idempotent; --dry-run only counts. Runs against the
// database in .env (DATABASE_URL), or another with TARGET_DATABASE_URL.
//   npx tsx --env-file=.env scripts/migrate-content.ts [--dry-run]
import { siteDb } from '../src/lib/supabase';
import type { PuckItem } from '../src/lib/puck/types';
import { MIGRATIONS as SITE_MIGRATIONS } from '../src/site/migrations';
import { migrateCollectionLayout } from '../src/lib/content/collections';

// The site's migrations (src/site/migrations/index.ts), then the core's (collection columns and gap).
const MIGRATIONS: ((items: PuckItem[]) => PuckItem[])[] = [...SITE_MIGRATIONS, migrateCollectionLayout];

const dry = process.argv.includes('--dry-run');
if (process.env.TARGET_DATABASE_URL) process.env.DATABASE_URL = process.env.TARGET_DATABASE_URL;
const db = siteDb();
console.log(`${dry ? 'Dry run on' : 'Migrating'} ${new URL(process.env.DATABASE_URL!).host}`);

/** A document with the migrations applied, or null when nothing changed. */
function migrate(doc: { content?: PuckItem[] } | null | undefined): typeof doc | null {
  if (!doc || !Array.isArray(doc.content)) return null;
  let items = doc.content;
  for (const m of MIGRATIONS) items = m(items);
  return items === doc.content ? null : { ...doc, content: items };
}

async function all(table: string, columns: string, key = 'id') {
  const rows: any[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from(table).select(columns).order(key).range(from, from + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

const counts: Record<string, number> = {};
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

for (const e of await all('entries', 'id, content, updated_at')) {
  const content = migrate(e.content);
  if (!content) continue;
  bump('entries');
  if (dry) continue;
  // Keep updated_at: a content migration is not an edit (the touch trigger keeps an explicit value).
  const { error } = await db.from('entries').update({ content, updated_at: e.updated_at }).eq('id', e.id);
  if (error) throw error;
}
for (const d of await all('entry_drafts', 'entry_id, draft', 'entry_id')) {
  const content = d.draft?.content ? migrate(d.draft.content) : null;
  if (!content) continue;
  bump('entry_drafts');
  if (dry) continue;
  const { error } = await db.from('entry_drafts').update({ draft: { ...d.draft, content } }).eq('entry_id', d.entry_id);
  if (error) throw error;
}
for (const t of await all('templates', 'id, content, updated_at')) {
  const content = migrate(t.content);
  if (!content) continue;
  bump('templates');
  if (dry) continue;
  const { error } = await db.from('templates').update({ content, updated_at: t.updated_at }).eq('id', t.id);
  if (error) throw error;
}
for (const r of await all('revisions', 'id, content')) {
  const content = migrate(r.content);
  if (!content) continue;
  bump('revisions');
  if (dry) continue;
  const { error } = await db.from('revisions').update({ content }).eq('id', r.id);
  if (error) throw error;
}
console.log(counts);
