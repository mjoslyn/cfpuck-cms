// Copy a site's files into its store (STORAGE_* when set, else the local bucket astro dev uses), each
// folder (media, compose, sync-backups) from its source. The source is an S3-compatible store:
// SOURCE_STORAGE_ENDPOINT, SOURCE_STORAGE_ACCESS_KEY_ID, SOURCE_STORAGE_SECRET_ACCESS_KEY and
// SOURCE_STORAGE_REGION. For Supabase Storage (a site moving off it) that is the project's S3 endpoint
// (https://<ref>.supabase.co/storage/v1/s3, keys from Storage > S3 Connection), whose buckets are the
// folders; with SOURCE_STORAGE_BUCKET, one bucket holding the folders (another copy's store). Resumable:
// objects already in the store are skipped.
//   npx tsx --env-file=.env scripts/copy-storage.ts [folder...]
import { Storage, siteStorage, storageConfig } from '../src/lib/storage';
import { closeLocalBindings } from '../src/lib/local-bindings';

const folders = process.argv.slice(2).length ? process.argv.slice(2) : ['media', 'compose', 'sync-backups'];
const env = process.env;
if (!env.SOURCE_STORAGE_ENDPOINT || !env.SOURCE_STORAGE_ACCESS_KEY_ID || !env.SOURCE_STORAGE_SECRET_ACCESS_KEY) {
  throw new Error('Set SOURCE_STORAGE_ENDPOINT, SOURCE_STORAGE_ACCESS_KEY_ID and SOURCE_STORAGE_SECRET_ACCESS_KEY.');
}
const one = env.SOURCE_STORAGE_BUCKET;
const store = siteStorage();
const source = (folder: string) => {
  const config = storageConfig('SOURCE_STORAGE') ?? { endpoint: env.SOURCE_STORAGE_ENDPOINT!.replace(/\/$/, ''), bucket: folder, accessKeyId: env.SOURCE_STORAGE_ACCESS_KEY_ID!, secretAccessKey: env.SOURCE_STORAGE_SECRET_ACCESS_KEY!, region: env.SOURCE_STORAGE_REGION || 'auto' };
  return { from: new Storage(one ? config : { ...config, bucket: folder }), prefix: one ? `${folder}/` : '' };
};

try {
  for (const folder of folders) {
    const src = source(folder);
    const objects = (await src.from.listKeys(src.prefix, false).catch((e: Error) => (/NoSuchBucket|not found/i.test(e.message) ? { keys: [] } : Promise.reject(e)))).keys.map((k) => k.key.slice(src.prefix.length));
    const have = new Set((await store.listKeys(`${folder}/`, false)).keys.map((k) => k.key.slice(folder.length + 1)));
    const todo = objects.filter((p) => p && !have.has(p));
    console.log(`${folder}: ${objects.length} objects, ${todo.length} to copy`);
    let done = 0;
    for (const path of todo) {
      const res = await src.from.get(`${src.prefix}${path}`);
      if (!res.ok) throw new Error(`${folder}/${path}: ${res.status}`);
      const type = res.headers.get('content-type') || undefined;
      const { error } = await store.from(folder).upload(path, await res.arrayBuffer(), { contentType: type, cacheControl: '31536000', upsert: true });
      if (error) throw new Error(`${folder}/${path}: ${error.message}`);
      if (++done % 100 === 0) console.log(`  ${done}/${todo.length}`);
    }
    console.log(`${folder}: done`);
  }
} finally {
  await closeLocalBindings();
}
