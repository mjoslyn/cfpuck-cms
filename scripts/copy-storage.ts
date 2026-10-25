// Copy a site's files from Supabase Storage (its media, compose and sync-backups buckets) into the
// site's store (STORAGE_*, Cloudflare R2), each bucket into the folder of the same name. Resumable:
// objects already in the store are skipped. The source is SOURCE_SUPABASE_URL and
// SOURCE_SERVICE_ROLE_KEY (else PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).
//   npx tsx --env-file=.env scripts/copy-storage.ts [bucket...]
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { siteStorage } from '../src/lib/storage';

const buckets = process.argv.slice(2).length ? process.argv.slice(2) : ['media', 'compose', 'sync-backups'];
const url = process.env.SOURCE_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SOURCE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set SOURCE_SUPABASE_URL and SOURCE_SERVICE_ROLE_KEY.');
const src = createClient(url, key, { auth: { persistSession: false } });
const store = siteStorage();

/** Every object path in a bucket, walking folders (list() is one level at a time). */
async function listAll(db: SupabaseClient, bucket: string, prefix = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) {
      if (/not found/i.test(error.message)) return out;
      throw error;
    }
    for (const o of data) {
      const path = prefix ? `${prefix}/${o.name}` : o.name;
      if (o.id === null) for (const [p, t] of await listAll(db, bucket, path)) out.set(p, t);
      else out.set(path, String(o.metadata?.mimetype ?? ''));
    }
    if (data.length < 1000) return out;
  }
}

for (const bucket of buckets) {
  const objects = await listAll(src, bucket);
  const have = new Set((await store.listKeys(`${bucket}/`, false)).keys.map((k) => k.key.slice(bucket.length + 1)));
  const todo = [...objects].filter(([p]) => !have.has(p));
  console.log(`${bucket}: ${objects.size} objects, ${todo.length} to copy`);
  let done = 0;
  for (const [path, type] of todo) {
    const { data, error } = await src.storage.from(bucket).download(path);
    if (error || !data) throw new Error(`${bucket}/${path}: ${error?.message}`);
    const { error: up } = await store.from(bucket).upload(path, data, { contentType: type || data.type || undefined, cacheControl: '31536000', upsert: true });
    if (up) throw new Error(`${bucket}/${path}: ${up.message}`);
    if (++done % 100 === 0) console.log(`  ${done}/${todo.length}`);
  }
  console.log(`${bucket}: done`);
}
