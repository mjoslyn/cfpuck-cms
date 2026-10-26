// How one copy of the site reaches the other for Settings > Sync (server only): the copy that starts a
// sync sends its queries to the other's /api/sync/remote and its file calls to /api/sync/files, signed
// with the secret both share (SYNC_SECRET). The other copy checks the signature and runs them as the
// server, on the tables and folders a sync uses only.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Db, type CallSpec, type Executor, type QuerySpec, type Result } from './db/query';
import { parseSelect } from './db/sqlite';
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

const signature = (secret: string, time: string, body: string) => createHmac('sha256', secret).update(`${time}.${body}`).digest('hex');

/** The body of a signed request from the other copy, or why it is refused. */
export function verified(time: string | null, sig: string | null, body: string): { ok: true } | { ok: false; status: number; message: string } {
  const secret = syncSecret();
  if (!secret) return { ok: false, status: 404, message: 'Not found' };
  if (!time || !sig || !/^\d+$/.test(time) || Math.abs(Date.now() - Number(time)) > WINDOW_MS) return { ok: false, status: 401, message: 'Unsigned or expired' };
  const want = Buffer.from(signature(secret, time, body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, status: 401, message: 'Bad signature' };
  return { ok: true };
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
  const call = async (c: FileCall, body?: Uint8Array): Promise<Response> => {
    const head = JSON.stringify(c);
    const time = String(Date.now());
    return fetch(`${url}/api/sync/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Sync-Time': time, 'X-Sync-Call': head, 'X-Sync-Signature': signature(secret, time, head) },
      body: (body ?? null) as BodyInit | null,
    });
  };
  const json = async <T,>(c: FileCall, body?: Uint8Array): Promise<Res<T>> => {
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
      const blob = body instanceof Blob ? body : new Blob([body as BlobPart]);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return json<{ path: string }>({ op: 'upload', folder: name, path, options: { ...options, contentType: options.contentType || blob.type || undefined }, sha: sha256(bytes) }, bytes);
    },
    async download(path) {
      try {
        const res = await call({ op: 'download', folder: name, path });
        if (res.headers.get('content-type')?.includes('application/json')) return (await res.json()) as Res<Blob>;
        if (!res.ok) return { data: null, error: { message: `The other copy answered ${res.status}`, statusCode: String(res.status) } };
        return { data: new Blob([await res.arrayBuffer()], { type: res.headers.get('x-file-type') ?? '' }), error: null };
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
    const time = String(Date.now());
    try {
      const res = await fetch(`${url}/api/sync/remote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sync-Time': time, 'X-Sync-Signature': signature(secret, time, body) },
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
