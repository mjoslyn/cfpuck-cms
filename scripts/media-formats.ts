// Backfill AVIF/WebP copies for media that don't have them yet (imported or older uploads).
//   npx tsx --env-file=.env scripts/media-formats.ts [--limit N] [--concurrency 4] [--all]
import { siteDb } from '../src/lib/supabase';
import { MediaStore, addFormats } from '../src/lib/media/process';
import type { Media } from '../src/lib/types';

const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const limit = Number(arg('--limit', '100000'));
const concurrency = Number(arg('--concurrency', '4'));
const db = siteDb();
const store = new MediaStore(db);

// The API returns at most 1000 rows per request; page through.
const todo: (Media & { focal_point: any })[] = [];
for (let from = 0; todo.length < limit; from += 1000) {
  let q = db.from('media').select('*').order('id').range(from, from + 999);
  if (!process.argv.includes('--all')) q = q.is('processed_at', null);
  const { data, error } = await q;
  if (error) throw error;
  todo.push(...((data ?? []) as typeof todo));
  if ((data ?? []).length < 1000) break;
}
todo.splice(limit);
console.log(`${todo.length} media to process`);

let done = 0;
let failed = 0;
const started = Date.now();
async function work() {
  for (let m = todo.shift(); m; m = todo.shift()) {
    try {
      const out = await addFormats(store, m);
      const { error: e } = await db.from('media').update({ ...out, processed_at: new Date().toISOString() }).eq('id', m.id);
      if (e) throw e;
    } catch (e) {
      failed++;
      console.warn(`#${m.id} ${m.path}: ${(e as Error).message}`);
    }
    if (++done % 25 === 0) console.log(`${done} done, ${failed} failed, ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
}
await Promise.all(Array.from({ length: concurrency }, work));
console.log(`finished: ${done} processed, ${failed} failed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
