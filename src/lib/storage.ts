// The site's files (server only): one private bucket on an S3-compatible store (Cloudflare R2 in
// production), reached with STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID and
// STORAGE_SECRET_ACCESS_KEY. What were Supabase Storage buckets are folders in it: `media/` (the media
// library, served by the site at /media/, src/pages/media/[...path].ts), `compose/` (Compose's
// documents) and `sync-backups/` (Settings > Backups). The calls are the ones the code made of
// Supabase Storage (`storage.from(folder).upload/download/list/remove`), answering { data, error }.
import { AwsClient } from 'aws4fetch';

export interface StorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export interface StorageError { message: string; statusCode?: string }
type Res<T> = { data: T; error: null } | { data: null; error: StorageError };

/** A file or folder in a listing, as Supabase Storage listed them (folders have no id). */
export interface ListedFile {
  name: string;
  id: string | null;
  created_at: string | null;
  updated_at: string | null;
  metadata: { size: number; mimetype?: string } | null;
}

const env = (k: string) => (import.meta.env?.[k] as string | undefined) ?? process.env[k];

/** This site's store, from the environment. */
export function storageConfig(prefix = 'STORAGE'): StorageConfig | null {
  const endpoint = env(`${prefix}_ENDPOINT`);
  const bucket = env(`${prefix}_BUCKET`);
  const accessKeyId = env(`${prefix}_ACCESS_KEY_ID`);
  const secretAccessKey = env(`${prefix}_SECRET_ACCESS_KEY`);
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint: endpoint.replace(/\/$/, ''), bucket, accessKeyId, secretAccessKey, region: env(`${prefix}_REGION`) || 'auto' };
}

const xmlText = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => decodeXml(m[1]));
const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

/** The store: objects by key, path-style (`<endpoint>/<bucket>/<key>`). */
export class Storage {
  private client: AwsClient;

  constructor(readonly config: StorageConfig) {
    this.client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: 's3', region: config.region ?? 'auto' });
  }

  private url(key = '', query = '') {
    return `${this.config.endpoint}/${this.config.bucket}${key ? `/${encodeKey(key)}` : ''}${query ? `?${query}` : ''}`;
  }

  /** A folder of the bucket (what were Supabase Storage buckets). */
  from(folder: string): Folder {
    return new Folder(this, folder.replace(/\/+$/, ''));
  }

  /** Folders need no making; kept so callers that made a bucket first still read the same. */
  async createBucket(_name: string, _options?: unknown): Promise<Res<null>> {
    return { data: null, error: null };
  }

  async put(key: string, body: BodyInit, options: { contentType?: string; cacheControl?: string; upsert?: boolean } = {}): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': options.contentType || 'application/octet-stream' };
    if (options.cacheControl) headers['Cache-Control'] = /^\d+$/.test(options.cacheControl) ? `max-age=${options.cacheControl}` : options.cacheControl;
    if (options.upsert === false) headers['If-None-Match'] = '*';
    return this.client.fetch(this.url(key), { method: 'PUT', headers, body });
  }

  /** An object, passing on the request's Range and validators (for serving it). */
  get(key: string, headers: Record<string, string> = {}): Promise<Response> {
    return this.client.fetch(this.url(key), { headers });
  }

  delete(key: string): Promise<Response> {
    return this.client.fetch(this.url(key), { method: 'DELETE' });
  }

  /** Every key under a prefix, with its folders at the next level when `delimit` (ListObjectsV2, every page). */
  async listKeys(prefix: string, delimit: boolean): Promise<{ keys: { key: string; size: number; modified: string }[]; folders: string[] }> {
    const keys: { key: string; size: number; modified: string }[] = [];
    const folders: string[] = [];
    let token = '';
    for (;;) {
      const q = new URLSearchParams({ 'list-type': '2', prefix, ...(delimit ? { delimiter: '/' } : {}), ...(token ? { 'continuation-token': token } : {}) });
      const res = await this.client.fetch(this.url('', q.toString()));
      const xml = await res.text();
      if (!res.ok) throw new Error(xmlText(xml, 'Message')[0] || `listing failed (${res.status})`);
      for (const c of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
        keys.push({ key: xmlText(c, 'Key')[0], size: Number(xmlText(c, 'Size')[0] ?? 0), modified: new Date(xmlText(c, 'LastModified')[0] ?? 0).toISOString() });
      }
      for (const p of xml.match(/<CommonPrefixes>[\s\S]*?<\/CommonPrefixes>/g) ?? []) folders.push(xmlText(p, 'Prefix')[0]);
      token = xmlText(xml, 'NextContinuationToken')[0] ?? '';
      if (xmlText(xml, 'IsTruncated')[0] !== 'true' || !token) break;
    }
    return { keys, folders };
  }
}

const failed = async (res: Response): Promise<StorageError> => {
  const xml = await res.text().catch(() => '');
  return { message: xmlText(xml, 'Message')[0] || xmlText(xml, 'Code')[0] || res.statusText || `HTTP ${res.status}`, statusCode: String(res.status) };
};

/** A folder: Supabase Storage's bucket calls, on keys under `<folder>/`. */
export class Folder {
  constructor(private store: Storage, private folder: string) {}

  private key(path: string) {
    return `${this.folder}/${path.replace(/^\/+/, '')}`;
  }

  async upload(path: string, body: Blob | ArrayBuffer | Uint8Array | string, options: { contentType?: string; cacheControl?: string; upsert?: boolean } = {}): Promise<Res<{ path: string }>> {
    try {
      const res = await this.store.put(this.key(path), body as BodyInit, { ...options, contentType: options.contentType || (body instanceof Blob ? body.type : undefined) });
      if (res.status === 412) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
      if (!res.ok) return { data: null, error: await failed(res) };
      return { data: { path }, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }

  async download(path: string): Promise<Res<Blob>> {
    try {
      const res = await this.store.get(this.key(path));
      if (!res.ok) return { data: null, error: await failed(res) };
      const type = res.headers.get('content-type') ?? '';
      return { data: new Blob([await res.arrayBuffer()], { type }), error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }

  async remove(paths: string[]): Promise<Res<{ name: string }[]>> {
    try {
      const results = await Promise.all(paths.map(async (p) => ({ p, res: await this.store.delete(this.key(p)) })));
      const bad = results.find((r) => !r.res.ok && r.res.status !== 404);
      if (bad) return { data: null, error: await failed(bad.res) };
      return { data: paths.map((name) => ({ name })), error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }

  /**
   * The files and folders directly in `prefix`, as Supabase Storage listed them: names relative to it,
   * `search` keeping those whose name starts with it, sorted by name (or time), paged by limit and offset.
   */
  async list(prefix = '', options: { limit?: number; offset?: number; search?: string; sortBy?: { column?: string; order?: string } } = {}): Promise<Res<ListedFile[]>> {
    try {
      const dir = prefix.replace(/^\/+|\/+$/g, '');
      const base = `${this.folder}/${dir ? `${dir}/` : ''}`;
      const { keys, folders } = await this.store.listKeys(base, true);
      let items: ListedFile[] = [
        ...folders.map((f) => ({ name: f.slice(base.length).replace(/\/$/, ''), id: null, created_at: null, updated_at: null, metadata: null })),
        ...keys.map((k) => ({ name: k.key.slice(base.length), id: k.key, created_at: k.modified, updated_at: k.modified, metadata: { size: k.size } })),
      ];
      const search = options.search?.toLowerCase();
      if (search) items = items.filter((i) => i.name.toLowerCase().startsWith(search));
      const column = options.sortBy?.column ?? 'name';
      const desc = options.sortBy?.order === 'desc';
      items.sort((a, b) => {
        const x = column === 'name' ? a.name : (a[column as 'created_at'] ?? '');
        const y = column === 'name' ? b.name : (b[column as 'created_at'] ?? '');
        return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
      });
      const offset = options.offset ?? 0;
      return { data: items.slice(offset, offset + (options.limit ?? 100)), error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }
}

let site: Storage | null = null;
/** This site's store (STORAGE_*). */
export function siteStorage(): Storage {
  if (site) return site;
  const config = storageConfig();
  if (!config) throw new Error('Storage is not set up (STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY)');
  return (site = new Storage(config));
}
