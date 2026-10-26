// How one copy of the site reaches the other for Settings > Sync (server only): the copy that starts a
// sync sends its queries to the other's /api/sync/remote and its file calls to /api/sync/files, signed
// with the secret both share (SYNC_SECRET). The other copy checks the signature and runs them as the
// server, on the tables and folders a sync uses only. A signature covers the route, the time, a nonce
// and the body; the receiving copy takes each nonce once (`sync_nonces`), so a captured request can't
// be sent again, to either route or to either copy. A copy from before nonces refuses these requests
// (and this copy refuses its), so both copies need this code.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Db, type CallSpec, type Executor, type QuerySpec, type Result } from './db/query';
import { parseSelect } from './db/sqlite';
import { siteDb } from './db/site';
import type { FolderCalls, Files, ListedFile, Res } from './storage';
import { env } from './env';

/** The tables a sync reads and writes, and the one function it calls. */
export const SYNC_TABLES = ['entries', 'entry_drafts', 'entry_terms', 'form_submissions', 'forms', 'media', 'redirects', 'settings', 'templates', 'terms'];
export const SYNC_FUNCTIONS = ['sync_reset_ids'];
/** The folders a sync copies files to and keeps backups in. */
export const SYNC_FOLDERS = ['media', 'sync-backups'];

/** A file call: which, on what (uploads carry the body's SHA-256, so the signature covers it). */
export interface FileCall {
  op: 'upload' | 'download' | 'list' | 'remove';
  folder: string;
  path?: string;
  paths?: string[];
  prefix?: string;
  options?: Record<string, unknown>;
  sha?: string;
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** How long a signed request stays good (clocks a little apart included). */
const WINDOW_MS = 5 * 60_000;

/** The shared secret, when this copy has one long enough to trust. */
export function syncSecret(): string | null {
  const s = env('SYNC_SECRET');
  return s && s.length >= 32 ? s : null;
}

/** The routes a signed request goes to; each signature names its own. */
export type SyncRoute = '/api/sync/remote' | '/api/sync/files';

const signature = (secret: string, route: SyncRoute, time: string, nonce: string, body: string) => createHmac('sha256', secret).update(`${route}\n${time}\n${nonce}\n${body}`).digest('hex');

/** The headers that sign a request to a route of the other copy. */
function signed(secret: string, route: SyncRoute, body: string): Record<string, string> {
  const time = String(Date.now());
  const nonce = randomBytes(16).toString('hex');
  return { 'X-Sync-Time': time, 'X-Sync-Nonce': nonce, 'X-Sync-Signature': signature(secret, route, time, nonce, body) };
}

/**
 * Whether a request from the other copy to `route` is signed, current and new: its signature (route,
 * time, nonce and `body`) checks out, and its nonce hasn't been used. The nonce is then kept until the
 * signature would have expired anyway; older ones are pruned now and then.
 */
export async function verified(route: SyncRoute, headers: Headers, body: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const secret = syncSecret();
  if (!secret) return { ok: false, status: 404, message: 'Not found' };
  const time = headers.get('x-sync-time');
  const nonce = headers.get('x-sync-nonce');
  const sig = headers.get('x-sync-signature');
  if (!time || !sig || !nonce || !/^\d+$/.test(time) || !/^[a-f0-9]{32}$/.test(nonce) || Math.abs(Date.now() - Number(time)) > WINDOW_MS) return { ok: false, status: 401, message: 'Unsigned or expired' };
  const want = Buffer.from(signature(secret, route, time, nonce, body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, status: 401, message: 'Bad signature' };
  const db = siteDb();
  const { error } = await db.from('sync_nonces').insert({ nonce, at: Number(time) });
  if (error) return error.code === '23505' ? { ok: false, status: 401, message: 'Already used' } : { ok: false, status: 503, message: `Could not check the request: ${error.message}` };
  if (Math.random() < 0.02) await db.from('sync_nonces').delete().lt('at', Date.now() - WINDOW_MS);
  return { ok: true };
}

/** A Blob's SHA-256, read in chunks rather than copied whole. */
async function blobSha(blob: Blob): Promise<string> {
  const hash = createHash('sha256');
  const reader = blob.stream().getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) hash.update(r.value);
  return hash.digest('hex');
}

/** Whether every relation a select string embeds, at any depth, is a sync's table. */
function embedsAllowed(items: ReturnType<typeof parseSelect>): boolean {
  return items.every((item) => item.kind !== 'embed' || (SYNC_TABLES.includes(item.name) && embedsAllowed(item.items)));
}

/** Whether a query or call is one a sync makes. Filters and orders on an embed's path apply only inside
 * that embed, so checking the select string's embeds covers them. */
export function allowed(body: { query?: QuerySpec; call?: CallSpec }): boolean {
  if (body.query) {
    const q = body.query;
    if (!SYNC_TABLES.includes(q.table) || typeof q.columns !== 'string' || !Array.isArray(q.filters) || !Array.isArray(q.order)) return false;
    try {
      return embedsAllowed(parseSelect(q.columns));
    } catch {
      return false;
    }
  }
  return typeof body.call?.fn === 'string' && SYNC_FUNCTIONS.includes(body.call.fn);
}

/** The other copy's files, through its /api/sync/files. */
function remoteFiles(url: string, secret: string): Files {
  const call = async (c: FileCall, body?: Uint8Array | Blob): Promise<Response> => {
    const head = JSON.stringify(c);
    return fetch(`${url}/api/sync/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Sync-Call': head, ...signed(secret, '/api/sync/files', head) },
      body: (body ?? null) as BodyInit | null,
    });
  };
  const json = async <T,>(c: FileCall, body?: Uint8Array | Blob): Promise<Res<T>> => {
    try {
      const res = await call(c, body);
      if (res.headers.get('content-type')?.includes('application/json')) return (await res.json()) as Res<T>;
      return { data: null, error: { message: `The other copy answered ${res.status}: ${(await res.text()).slice(0, 200)}`, statusCode: String(res.status) } };
    } catch (e) {
      return { data: null, error: { message: `Could not reach the other copy: ${(e as Error).message}` } };
    }
  };
  const folder = (name: string): FolderCalls => ({
    async upload(path, body, options = {}) {
      // Sent as it is: a Blob hashed in chunks, other bodies as bytes (a stream read once, to hash it).
      const data = body instanceof Blob ? body : body instanceof Uint8Array ? body : typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body instanceof ReadableStream ? await new Response(body).arrayBuffer() : body);
      const sha = data instanceof Blob ? await blobSha(data) : sha256(data);
      const { size: _, ...rest } = options;
      return json<{ path: string }>({ op: 'upload', folder: name, path, options: { ...rest, contentType: options.contentType || (data instanceof Blob ? data.type : '') || undefined }, sha }, data);
    },
    async download(path) {
      try {
        const res = await call({ op: 'download', folder: name, path });
        // A file comes with its own type (and X-Sync-File); anything else is an answer in JSON.
        if (res.ok && res.headers.get('x-sync-file')) return { data: await res.blob(), error: null };
        if (res.headers.get('content-type')?.includes('application/json')) return (await res.json()) as Res<Blob>;
        return { data: null, error: { message: `The other copy answered ${res.status}`, statusCode: String(res.status) } };
      } catch (e) {
        return { data: null, error: { message: `Could not reach the other copy: ${(e as Error).message}` } };
      }
    },
    list: (prefix = '', options = {}) => json<ListedFile[]>({ op: 'list', folder: name, prefix, options }),
    remove: (paths) => json<{ name: string }[]>({ op: 'remove', folder: name, paths }),
  });
  return { from: folder, createBucket: async () => ({ data: null, error: null }) };
}

/** The other copy as a Db: its rows through its /api/sync/remote, its files through /api/sync/files. */
export function remoteDb(url: string, secret: string): Db {
  const post = async (payload: { query?: QuerySpec; call?: CallSpec }): Promise<Result> => {
    const body = JSON.stringify(payload);
    try {
      const res = await fetch(`${url}/api/sync/remote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...signed(secret, '/api/sync/remote', body) },
        body,
      });
      if (res.headers.get('content-type')?.includes('application/json')) return (await res.json()) as Result;
      return { data: null, count: null, error: { message: `The other copy answered ${res.status}: ${(await res.text()).slice(0, 200)}`, code: String(res.status) } };
    } catch (e) {
      return { data: null, count: null, error: { message: `Could not reach the other copy: ${(e as Error).message}`, code: '' } };
    }
  };
  const exec: Executor = { query: (query) => post({ query }), call: (call) => post({ call }) };
  const files = remoteFiles(url, secret);
  return new Db(exec, () => files);
}
