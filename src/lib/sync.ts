// Sync between this site and another copy of it (production and a local copy, say): entries of chosen
// types, terms of chosen taxonomies, files (the media library and its storage objects), templates,
// forms, settings and redirects, in either direction. The other copy is reached at its address with the
// secret both copies share (SYNC_REMOTE_URL, SYNC_SECRET, SYNC_REMOTE_NAME; src/lib/sync-remote.ts), so a
// sync runs from the copy that has the address set.
//
// Rows match by id (entries, terms, media, forms: copies of one site share ids, and a sync keeps them
// so), by kind and slug (templates), by key (settings) and by old address (redirects). A sync adds and
// overwrites; it never deletes. A site whose settings say `sync_protected` refuses any sync into it.
// `plan` compares and lists what would change; `apply` writes one batch of it, checking again.
import type { Db } from './db/query';
import { remoteDb, syncSecret } from './sync-remote';
import { allRows } from './rows';
import { site as config, fieldsFor, taxonomyLabel, typesSharingAddresses } from './site';
import { serviceClient } from './db/site';
import { env } from './env';

export type Direction = 'push' | 'pull';

export interface SyncItem {
  key: string;
  label: string;
}
export interface SyncConflict extends SyncItem {
  reason: string;
}
export interface GroupPlan {
  id: string;
  label: string;
  added: SyncItem[];
  changed: SyncItem[];
  same: number;
  conflicts: SyncConflict[];
  warnings: string[];
}
export interface SyncPlan {
  source: string;
  target: string;
  protected: boolean;
  groups: GroupPlan[];
}

/** The other copy, from the environment, or null when none is set. */
export function remoteConfig(): { name: string; url: string; key: string } | null {
  const url = env('SYNC_REMOTE_URL');
  const key = syncSecret();
  if (!url || !key) return null;
  let host = 'the other copy';
  try {
    host = new URL(url).host;
  } catch {}
  return { name: env('SYNC_REMOTE_NAME') || host, url: url.replace(/\/$/, ''), key };
}

/** Source and target clients for a direction: push writes to the other copy, pull to this one. */
export function endpoints(direction: Direction): { source: Db; target: Db; sourceName: string; targetName: string } {
  const remote = remoteConfig();
  if (!remote) throw new Error('No other copy is set up (SYNC_REMOTE_URL, and SYNC_SECRET of at least 32 characters).');
  const here = (env('SITE_URL') ?? '').replace(/\/$/, '');
  if (remote.url === here) throw new Error('SYNC_REMOTE_URL is this site’s own address.');
  const local = serviceClient();
  const other = remoteDb(remote.url, remote.key);
  return direction === 'push'
    ? { source: local, target: other, sourceName: 'this site', targetName: remote.name }
    : { source: other, target: local, sourceName: remote.name, targetName: 'this site' };
}

/** Whether a copy refuses syncs into it (its settings.site.sync_protected). */
export async function isProtected(db: Db): Promise<boolean> {
  const { data, error } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  if (error) throw new Error(`Could not read the settings: ${error.message}`);
  return !!(data?.value as any)?.sync_protected;
}

/** What can be synced, in the order a sync applies them (files and terms before the entries using them). */
export function syncGroups(): { id: string; label: string; kind: 'files' | 'taxonomy' | 'forms' | 'templates' | 'type' | 'settings' | 'redirects' }[] {
  return [
    { id: 'media', label: 'Files (media library)', kind: 'files' as const },
    ...config.taxonomies.map((t) => ({ id: `taxonomy:${t.name}`, label: taxonomyLabel(t.name), kind: 'taxonomy' as const })),
    { id: 'forms', label: 'Forms', kind: 'forms' as const },
    { id: 'templates', label: 'Templates, parts and patterns', kind: 'templates' as const },
    ...config.types.map((t) => ({ id: `type:${t.type}`, label: t.label, kind: 'type' as const })),
    { id: 'settings', label: 'Settings and menu', kind: 'settings' as const },
    { id: 'redirects', label: 'Redirects', kind: 'redirects' as const },
  ];
}

// ---- comparing ------------------------------------------------------------------------------------

/** JSON with object keys sorted, so equal values compare equal whatever their key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const omit = <T extends Record<string, any>>(row: T, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));

async function must<T = any>(q: any, what: string): Promise<T[]> {
  const { data, error } = await allRows<T>(q);
  if (error) throw new Error(`Could not read ${what}: ${error.message}`);
  return data;
}
/** Rows whose `column` is one of `ids`, 200 ids a request, each read in pages (ordered by `order`,
 *  which must end on a unique column) so none past PostgREST's 1000-row limit are lost. */
async function byIds<T = any>(db: Db, table: string, select: string, column: string, ids: (number | string)[], order: string[] = [column]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    let q = db.from(table).select(select).in(column, ids.slice(i, i + 200));
    for (const o of order) q = q.order(o);
    out.push(...(await must<T>(q, table)));
  }
  return out;
}

const LINK_ORDER = ['entry_id', 'term_id'];

/** Parents before children, so each row's parent exists when it is written. */
function parentsFirst<T extends { id: number; parent_id: number | null }>(rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: T[] = [];
  const seen = new Set<number>();
  const visit = (r: T, depth = 0) => {
    if (seen.has(r.id) || depth > 50) return;
    const p = r.parent_id != null ? byId.get(r.parent_id) : undefined;
    if (p) visit(p, depth + 1);
    seen.add(r.id);
    out.push(r);
  };
  rows.forEach((r) => visit(r));
  return out;
}

/** Media ids that entry content and image fields point at. */
function mediaRefs(e: any): number[] {
  const ids = new Set<number>();
  if (e.featured_media_id) ids.add(Number(e.featured_media_id));
  const text = typeof e.content === 'string' ? e.content : JSON.stringify(e.content ?? null);
  for (const m of text.matchAll(/"mediaId":\s*"?(\d+)/g)) ids.add(Number(m[1]));
  for (const f of fieldsFor(e.type)) if (f.type === 'image' && Number(e.fields?.[f.key])) ids.add(Number(e.fields[f.key]));
  return [...ids];
}

// Columns a target works out for itself (trigger-made or touched on write), left out of comparing and writing.
const ENTRY_DERIVED = ['updated_at', 'body_text'];
const MEDIA_DERIVED = ['updated_at'];
const FORM_FIELDS = ['title', 'definition', 'notifications', 'is_active'];
// `wildcard` is generated from the old address, so it is neither compared nor written.
const REDIRECT_FIELDS = ['to_url', 'status', 'note'];

interface Context {
  source: Db;
  target: Db;
  /** The groups chosen for this sync. */
  chosen: Set<string>;
  /** Comparing: rows the chosen groups bring count as on the target. Writing: only what is there. */
  planning?: boolean;
}

type Planner = (ctx: Context, group: string) => Promise<Omit<GroupPlan, 'id' | 'label'>>;
type Applier = (ctx: Context, group: string, keys: string[]) => Promise<{ written: number; skipped: SyncConflict[] }>;

// ---- entries --------------------------------------------------------------------------------------

async function entryState(ctx: Context, type: string, ids?: number[]) {
  const src = ids ? await byIds(ctx.source, 'entries', '*', 'id', ids) : await must(ctx.source.from('entries').select('*').eq('type', type).order('id'), 'entries');
  const srcIds = src.map((e) => e.id);
  const [tgtKeys, tgtRows, srcTerms, tgtTerms, srcDrafts, tgtDrafts, tgtTermIds, tgtMedia] = await Promise.all([
    must<{ id: number; type: string; slug: string }>(ctx.target.from('entries').select('id, type, slug').order('id'), 'entries'),
    byIds(ctx.target, 'entries', '*', 'id', srcIds),
    byIds<{ entry_id: number; term_id: number; sort: number | null }>(ctx.source, 'entry_terms', 'entry_id, term_id, sort', 'entry_id', srcIds, LINK_ORDER),
    byIds<{ entry_id: number; term_id: number; sort: number | null }>(ctx.target, 'entry_terms', 'entry_id, term_id, sort', 'entry_id', srcIds, LINK_ORDER),
    byIds<{ entry_id: number; draft: any }>(ctx.source, 'entry_drafts', 'entry_id, draft', 'entry_id', srcIds),
    byIds<{ entry_id: number; draft: any }>(ctx.target, 'entry_drafts', 'entry_id, draft', 'entry_id', srcIds),
    must<{ id: number; taxonomy: string; slug: string }>(ctx.target.from('terms').select('id, taxonomy, slug').order('id'), 'terms'),
    must<{ id: number; path: string }>(ctx.target.from('media').select('id, path').order('id'), 'media'),
  ]);
  const [srcTermRows, srcMediaRows] = await Promise.all([
    must<{ id: number; taxonomy: string; slug: string }>(ctx.source.from('terms').select('id, taxonomy, slug').order('id'), 'terms'),
    must<{ id: number; path: string }>(ctx.source.from('media').select('id, path').order('id'), 'media'),
  ]);
  const termsThere = available(srcTermRows, tgtTermIds, (t) => `${t.taxonomy}/${t.slug}`, ctx.planning ? (t) => ctx.chosen.has(`taxonomy:${t.taxonomy}`) : null);
  const mediaThere = available(srcMediaRows, tgtMedia, (m) => m.path, ctx.planning && ctx.chosen.has('media') ? () => true : null);
  const group = <T extends { entry_id: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) m.set(r.entry_id, [...(m.get(r.entry_id) ?? []), r]);
    return m;
  };
  return { src, tgtKeys, tgt: new Map(tgtRows.map((r) => [r.id, r])), srcTerms: group(srcTerms), tgtTerms: group(tgtTerms), srcDrafts: new Map(srcDrafts.map((d) => [d.entry_id, d.draft])), tgtDrafts: new Map(tgtDrafts.map((d) => [d.entry_id, d.draft])), termsThere, mediaThere };
}

/**
 * Source ids that are the same thing on the target: the target has the id for the same key (a term's
 * taxonomy and slug, a file's path). When comparing, rows the sync brings (`brings`) count too, unless
 * they would conflict there; when writing, only what is on the target counts, since what was unticked,
 * conflicted or failed isn't.
 */
function available<T extends { id: number }>(src: T[], tgt: T[], key: (r: T) => string, brings: ((r: T) => boolean) | null): Set<number> {
  const tgtById = new Map(tgt.map((r) => [r.id, key(r)]));
  const tgtKeys = new Map(tgt.map((r) => [key(r), r.id]));
  const out = new Set<number>();
  for (const r of src) {
    const k = key(r);
    const there = tgtById.get(r.id);
    if (there === k) out.add(r.id);
    else if (there === undefined && brings?.(r) && (tgtKeys.get(k) ?? r.id) === r.id) out.add(r.id);
  }
  return out;
}

const termList = (rows: { term_id: number; sort: number | null }[] | undefined, keep?: Set<number>) =>
  (rows ?? []).filter((r) => !keep || keep.has(r.term_id)).map((r) => [r.term_id, r.sort ?? 0]).sort((a, b) => a[0] - b[0]);

function entryConflict(e: any, s: Awaited<ReturnType<typeof entryState>>, syncing: Set<number>): string | null {
  const there = s.tgtKeys.find((t) => t.id === e.id);
  if (there && there.type !== e.type) return `id ${e.id} is a ${there.type} (${there.slug}) there`;
  // Types without a URL base share one set of addresses (/<slug>/).
  const sharing = typesSharingAddresses(e.type);
  const slugTaken = s.tgtKeys.find((t) => sharing.includes(t.type) && t.slug === e.slug && t.id !== e.id);
  if (slugTaken) return `the address ${e.slug} belongs to another ${slugTaken.type} there (id ${slugTaken.id})`;
  if (e.parent_id && !syncing.has(e.parent_id) && !s.tgtKeys.some((t) => t.id === e.parent_id)) return `its parent (id ${e.parent_id}) isn't there`;
  if (e.featured_media_id && !s.mediaThere.has(e.featured_media_id)) return `its featured image (file ${e.featured_media_id}) isn't on the target as the same file: include Files, or sort out that file's conflict`;
  return null;
}

const planEntries: Planner = async (ctx, group) => {
  const type = group.slice(5);
  const s = await entryState(ctx, type);
  const out = { added: [] as SyncItem[], changed: [] as SyncItem[], same: 0, conflicts: [] as SyncConflict[], warnings: [] as string[] };
  const syncing = new Set(s.src.map((e) => e.id));
  let missingTerms = 0;
  let missingMedia = 0;
  for (const e of parentsFirst(s.src)) {
    const item = { key: String(e.id), label: `${e.title?.replace(/<[^>]*>/g, '') || '(untitled)'} (${e.slug})` };
    const conflict = entryConflict(e, s, syncing);
    if (conflict) {
      out.conflicts.push({ ...item, reason: conflict });
      continue;
    }
    if ((s.srcTerms.get(e.id) ?? []).some((t) => !s.termsThere.has(t.term_id))) missingTerms++;
    if (mediaRefs(e).some((id) => !s.mediaThere.has(id))) missingMedia++;
    const t = s.tgt.get(e.id);
    if (!t) {
      out.added.push(item);
      continue;
    }
    const same =
      stable(omit(e, ENTRY_DERIVED)) === stable(omit(t, ENTRY_DERIVED)) &&
      stable(termList(s.srcTerms.get(e.id), s.termsThere)) === stable(termList(s.tgtTerms.get(e.id))) &&
      stable(s.srcDrafts.get(e.id) ?? null) === stable(s.tgtDrafts.get(e.id) ?? null);
    if (same) out.same++;
    else out.changed.push(item);
  }
  if (missingTerms) out.warnings.push(`${missingTerms} use terms that aren't there; those links are left out (include their taxonomies to bring them).`);
  if (missingMedia) out.warnings.push(`${missingMedia} show files that aren't there (include Files to bring them).`);
  return out;
};

const applyEntries: Applier = async (ctx, group, keys) => {
  const type = group.slice(5);
  const ids = keys.map(Number);
  const s = await entryState(ctx, type, ids);
  const syncing = new Set(ids);
  const skipped: SyncConflict[] = [];
  let written = 0;
  for (const e of parentsFirst(s.src.filter((r) => r.type === type))) {
    const conflict = entryConflict(e, s, syncing);
    if (conflict) {
      skipped.push({ key: String(e.id), label: e.slug, reason: conflict });
      continue;
    }
    const { error } = await ctx.target.from('entries').upsert(omit(e, ENTRY_DERIVED), { onConflict: 'id' });
    if (error) {
      skipped.push({ key: String(e.id), label: e.slug, reason: error.message });
      continue;
    }
    // Its terms: the source's that are on the target. The new links go in first and only then do the
    // others go, so a failure leaves the old links rather than none.
    const wanted = s.srcTerms.get(e.id) ?? [];
    const links = wanted.filter((t) => s.termsThere.has(t.term_id));
    const ins = links.length ? await ctx.target.from('entry_terms').upsert(links, { onConflict: 'entry_id,term_id' }) : { error: null };
    const keepIds = links.map((t) => t.term_id);
    const del = ins.error ? { error: null } : keepIds.length ? await ctx.target.from('entry_terms').delete().eq('entry_id', e.id).not('term_id', 'in', `(${keepIds.join(',')})`) : await ctx.target.from('entry_terms').delete().eq('entry_id', e.id);
    // Its unpublished changes: the source's, or none (the target's own would otherwise load over the sync).
    const draft = s.srcDrafts.get(e.id);
    const dr = draft !== undefined ? await ctx.target.from('entry_drafts').upsert({ entry_id: e.id, draft }, { onConflict: 'entry_id' }) : s.tgtDrafts.has(e.id) ? await ctx.target.from('entry_drafts').delete().eq('entry_id', e.id) : { error: null };
    const err = ins.error ?? del.error ?? dr.error;
    if (err) skipped.push({ key: String(e.id), label: e.slug, reason: `saved, but its terms or unpublished changes failed: ${err.message}` });
    else if (links.length < wanted.length) skipped.push({ key: String(e.id), label: e.slug, reason: `saved without ${wanted.length - links.length} of its terms, which aren't there` });
    written++;
  }
  return { written, skipped };
};

// ---- terms ----------------------------------------------------------------------------------------

async function termState(ctx: Context, taxonomy: string, ids?: number[]) {
  const src = ids ? await byIds(ctx.source, 'terms', '*', 'id', ids) : await must(ctx.source.from('terms').select('*').eq('taxonomy', taxonomy).order('id'), 'terms');
  const tgt = await must(ctx.target.from('terms').select('*').order('id'), 'terms');
  return { src: src.filter((t) => t.taxonomy === taxonomy), tgt: new Map(tgt.map((t) => [t.id, t])), tgtAll: tgt };
}

function termConflict(t: any, s: Awaited<ReturnType<typeof termState>>, syncing: Set<number>): string | null {
  const there = s.tgt.get(t.id);
  if (there && there.taxonomy !== t.taxonomy) return `id ${t.id} is ${there.taxonomy} "${there.name}" there`;
  const slugTaken = s.tgtAll.find((x) => x.taxonomy === t.taxonomy && x.slug === t.slug && x.id !== t.id);
  if (slugTaken) return `the address ${t.slug} belongs to another term there (id ${slugTaken.id})`;
  if (t.parent_id && !syncing.has(t.parent_id) && !s.tgt.has(t.parent_id)) return `its parent (id ${t.parent_id}) isn't there`;
  return null;
}

const planTerms: Planner = async (ctx, group) => {
  const s = await termState(ctx, group.slice(9));
  const out = { added: [] as SyncItem[], changed: [] as SyncItem[], same: 0, conflicts: [] as SyncConflict[], warnings: [] as string[] };
  const syncing = new Set(s.src.map((t) => t.id));
  for (const t of parentsFirst(s.src)) {
    const item = { key: String(t.id), label: `${t.name} (${t.slug})` };
    const conflict = termConflict(t, s, syncing);
    if (conflict) out.conflicts.push({ ...item, reason: conflict });
    else if (!s.tgt.has(t.id)) out.added.push(item);
    else if (stable(t) === stable(s.tgt.get(t.id))) out.same++;
    else out.changed.push(item);
  }
  return out;
};

const applyTerms: Applier = async (ctx, group, keys) => {
  const s = await termState(ctx, group.slice(9), keys.map(Number));
  const syncing = new Set(keys.map(Number));
  const skipped: SyncConflict[] = [];
  let written = 0;
  for (const t of parentsFirst(s.src)) {
    const conflict = termConflict(t, s, syncing);
    const { error } = conflict ? { error: { message: conflict } } : await ctx.target.from('terms').upsert(t, { onConflict: 'id' });
    if (error) skipped.push({ key: String(t.id), label: t.slug, reason: error.message });
    else written++;
  }
  return { written, skipped };
};

// ---- files ----------------------------------------------------------------------------------------

/** Every storage object of a media item: the file, its sizes (the kept original among them) and their AVIF/WebP copies. */
export function mediaObjects(m: { path: string; sizes?: any; formats?: any }): string[] {
  const out = new Set<string>([m.path]);
  for (const p of Object.values(m.formats ?? {})) if (typeof p === 'string') out.add(p);
  for (const s of Object.values(m.sizes ?? {}) as any[]) {
    if (s?.path) out.add(s.path);
    for (const p of Object.values(s?.formats ?? {})) if (typeof p === 'string') out.add(p);
  }
  return [...out];
}

/** The size of a file stored on a copy (in the media folder), or null. */
async function storedSize(db: Db, path: string): Promise<number | null> {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  const { data, error } = await db.storage.from('media').list(slash > 0 ? path.slice(0, slash) : '', { search: name, limit: 1000 });
  if (error) throw new Error(`${path}: ${error.message}`);
  return data?.find((f) => f.name === name)?.metadata?.size ?? null;
}

/**
 * Copy storage objects, six at a time; the first failure, or null. Only `own` (the files the target's
 * library row lists for this item) may be written over. Any other path is written only where nothing
 * is stored, since stored images are never overwritten: a file there that the target's library doesn't
 * list (one whose row a restore removed) stops the copy, unless it is the same size as the source's,
 * which is taken as the same file (left there by a sync that stopped halfway).
 */
async function copyObjects(ctx: Context, paths: string[], own: Set<string> = new Set()): Promise<string | null> {
  const todo = [...paths];
  let failed: string | null = null;
  const worker = async () => {
    for (let path = todo.shift(); path && !failed; path = todo.shift()) {
      const { data, error } = await ctx.source.storage.from('media').download(path);
      if (error) failed = `${path}: ${error.message || 'not found'}`;
      else {
        const { error: up } = await ctx.target.storage.from('media').upload(path, data, { contentType: data.type || undefined, cacheControl: '31536000', upsert: own.has(path) });
        if (up?.statusCode === '409') {
          const size = await storedSize(ctx.target, path).catch((e: Error) => e);
          if (size instanceof Error) failed = size.message;
          else if (size !== data.size) failed = `${path} is already stored there, as a file its library doesn't list (such as one a restore removed): not overwritten`;
        } else if (up) failed = `${path}: ${up.message}`;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return failed;
}

async function mediaState(ctx: Context, ids?: number[]) {
  const src = ids ? await byIds(ctx.source, 'media', '*', 'id', ids) : await must(ctx.source.from('media').select('*').order('id'), 'media');
  const tgt = ids ? await byIds(ctx.target, 'media', '*', 'id', ids) : await must(ctx.target.from('media').select('*').order('id'), 'media');
  const paths = ids ? await byIds<{ id: number; path: string }>(ctx.target, 'media', 'id, path', 'path', src.map((m) => m.path)) : tgt;
  return { src, tgt: new Map(tgt.map((m) => [m.id, m])), pathOwner: new Map(paths.map((m) => [m.path, m.id])) };
}

function mediaConflict(m: any, s: Awaited<ReturnType<typeof mediaState>>): string | null {
  const there = s.tgt.get(m.id);
  if (there && there.path !== m.path) return `id ${m.id} is ${there.path} there`;
  const owner = s.pathOwner.get(m.path);
  if (owner != null && owner !== m.id) return `${m.path} is file ${owner} there`;
  return null;
}

const planMedia: Planner = async (ctx) => {
  const s = await mediaState(ctx);
  const out = { added: [] as SyncItem[], changed: [] as SyncItem[], same: 0, conflicts: [] as SyncConflict[], warnings: [] as string[] };
  for (const m of s.src) {
    const item = { key: String(m.id), label: m.path };
    const conflict = mediaConflict(m, s);
    if (conflict) out.conflicts.push({ ...item, reason: conflict });
    else if (!s.tgt.has(m.id)) out.added.push(item);
    else if (stable(omit(m, MEDIA_DERIVED)) === stable(omit(s.tgt.get(m.id), MEDIA_DERIVED))) out.same++;
    else out.changed.push(item);
  }
  return out;
};

const applyMedia: Applier = async (ctx, _group, keys) => {
  const s = await mediaState(ctx, keys.map(Number));
  const skipped: SyncConflict[] = [];
  let written = 0;
  for (const m of s.src) {
    const conflict = mediaConflict(m, s);
    // The files first, so the row never points at files that aren't there.
    const there = s.tgt.get(m.id);
    const failed = conflict ?? (await copyObjects(ctx, mediaObjects(m), new Set(there ? mediaObjects(there) : [])));
    const { error } = failed ? { error: { message: failed } } : await ctx.target.from('media').upsert(omit(m, MEDIA_DERIVED), { onConflict: 'id' });
    if (error) skipped.push({ key: String(m.id), label: m.path, reason: error.message });
    else written++;
  }
  return { written, skipped };
};

// ---- templates, forms, settings, redirects ----------------------------------------------------------

const templateKey = (t: { kind: string; slug: string }) => `${t.kind}/${t.slug}`;

const planTemplates: Planner = async (ctx) => {
  const [src, tgt] = await Promise.all([
    must(ctx.source.from('templates').select('kind, slug, title, content, former_slugs, trashed_at').order('id'), 'templates'),
    must(ctx.target.from('templates').select('kind, slug, title, content, former_slugs, trashed_at').order('id'), 'templates'),
  ]);
  const there = new Map(tgt.map((t) => [templateKey(t), t]));
  const out = { added: [] as SyncItem[], changed: [] as SyncItem[], same: 0, conflicts: [] as SyncConflict[], warnings: [] as string[] };
  for (const t of src) {
    const item = { key: templateKey(t), label: `${t.title || t.slug} (${t.kind}: ${t.slug})` };
    const o = there.get(item.key);
    if (!o) out.added.push(item);
    else if (stable(t) === stable(o)) out.same++;
    else out.changed.push(item);
  }
  return out;
};

const applyTemplates: Applier = async (ctx, _group, keys) => {
  const skipped: SyncConflict[] = [];
  let written = 0;
  for (const key of keys) {
    const [kind, ...rest] = key.split('/');
    const slug = rest.join('/');
    const { data, error } = await ctx.source.from('templates').select('kind, slug, title, content, former_slugs, trashed_at').eq('kind', kind).eq('slug', slug).maybeSingle();
    const { error: e2 } = error || !data ? { error: error ?? { message: 'gone from the source' } } : await ctx.target.from('templates').upsert(data, { onConflict: 'kind,slug' });
    if (e2) skipped.push({ key, label: key, reason: e2.message });
    else written++;
  }
  return { written, skipped };
};

const planForms: Planner = async (ctx) => {
  const [src, tgt] = await Promise.all([must(ctx.source.from('forms').select('*').order('id'), 'forms'), must(ctx.target.from('forms').select('*').order('id'), 'forms')]);
  const there = new Map(tgt.map((f) => [f.id, f]));
  const out = { added: [] as SyncItem[], changed: [] as SyncItem[], same: 0, conflicts: [] as SyncConflict[], warnings: [] as string[] };
  const pick = (f: any) => Object.fromEntries(FORM_FIELDS.map((k) => [k, f[k]]));
  for (const f of src) {
    const item = { key: String(f.id), label: f.title || `Form ${f.id}` };
    const o = there.get(f.id);
    if (!o) out.added.push(item);
    else if (stable(pick(f)) === stable(pick(o))) out.same++;
    else out.changed.push(item);
  }
  return out;
};

const applyForms: Applier = async (ctx, _group, keys) => {
  const rows = await byIds(ctx.source, 'forms', '*', 'id', keys.map(Number));
  const skipped: SyncConflict[] = [];
  let written = 0;
  for (const f of rows) {
    const { error } = await ctx.target.from('forms').upsert({ id: f.id, ...Object.fromEntries(FORM_FIELDS.map((k) => [k, f[k]])) }, { onConflict: 'id' });
    if (error) skipped.push({ key: String(f.id), label: f.title, reason: error.message });
    else written++;
  }
  return { written, skipped };
};

// Settings that stay each copy's own: whether it accepts syncs, and what backups it keeps and when.
const OWN_SETTINGS = ['sync_protected', 'sync_backups_keep', 'sync_snapshots'];
const settingsValue = (v: any) => omit(v ?? {}, OWN_SETTINGS);
const SETTINGS_KEYS = ['site', 'options'];

const planSettings: Planner = async (ctx) => {
  const [src, tgt] = await Promise.all([ctx.source.from('settings').select('key, value').in('key', SETTINGS_KEYS), ctx.target.from('settings').select('key, value').in('key', SETTINGS_KEYS)]);
  if (src.error || tgt.error) throw new Error(`Could not read the settings: ${(src.error ?? tgt.error)!.message}`);
  const there = new Map((tgt.data ?? []).map((r) => [r.key, r.value]));
  const out = { added: [] as SyncItem[], changed: [] as SyncItem[], same: 0, conflicts: [] as SyncConflict[], warnings: [] as string[] };
  for (const r of src.data ?? []) {
    const item = { key: r.key, label: r.key === 'site' ? 'Site settings (name, front page, timezone, types, search, social, icon)' : 'Options (menu and the site’s own options)' };
    if (!there.has(r.key)) out.added.push(item);
    else if (stable(settingsValue(r.value)) === stable(settingsValue(there.get(r.key)))) out.same++;
    else out.changed.push(item);
  }
  if (out.added.length + out.changed.length) out.warnings.push('Each site keeps its own sync protection and backup count. Ids in settings (front page, share image) point at entries and files, which should be there too.');
  return out;
};

const applySettings: Applier = async (ctx, _group, keys) => {
  const skipped: SyncConflict[] = [];
  let written = 0;
  for (const key of keys.filter((k) => SETTINGS_KEYS.includes(k))) {
    const [srcRes, tgtRes] = await Promise.all([ctx.source.from('settings').select('value').eq('key', key).maybeSingle(), ctx.target.from('settings').select('value').eq('key', key).maybeSingle()]);
    // Never write a value made from a failed or missing read: it would replace the whole row.
    const readError = srcRes.error ?? tgtRes.error ?? (srcRes.data ? null : { message: 'not on the source' });
    if (readError) {
      skipped.push({ key, label: key, reason: `not written: ${readError.message}` });
      continue;
    }
    const src = srcRes.data;
    const tgt = tgtRes.data;
    const own = Object.fromEntries(OWN_SETTINGS.filter((k) => (tgt?.value as any)?.[k] != null).map((k) => [k, (tgt?.value as any)[k]]));
    const value = { ...settingsValue(src?.value), ...own };
    // The site icon's files (site-icon/...), which aren't media library items.
    const iconPaths = (v: any) => Object.values(v?.icons ?? {}).map((u) => String(u).replace(/^\/media\//, '').replace(/\?.*$/, '')).filter((p) => p.startsWith('site-icon/'));
    const icons = key === 'site' ? iconPaths(value) : [];
    // The target's own icon files may be written over; others only where nothing is stored.
    const failed = await copyObjects(ctx, icons, new Set(key === 'site' ? iconPaths(tgt?.value) : []));
    const { error } = failed ? { error: { message: `the site icon: ${failed}` } } : await ctx.target.from('settings').upsert({ key, value }, { onConflict: 'key' });
    if (error) skipped.push({ key, label: key, reason: error.message });
    else written++;
  }
  return { written, skipped };
};

const planRedirects: Planner = async (ctx) => {
  const [src, tgt] = await Promise.all([must(ctx.source.from('redirects').select('*').order('id'), 'redirects'), must(ctx.target.from('redirects').select('*').order('id'), 'redirects')]);
  const there = new Map(tgt.map((r) => [r.from_path, r]));
  const pick = (r: any) => Object.fromEntries(REDIRECT_FIELDS.map((k) => [k, r[k]]));
  const out = { added: [] as SyncItem[], changed: [] as SyncItem[], same: 0, conflicts: [] as SyncConflict[], warnings: [] as string[] };
  for (const r of src) {
    const item = { key: r.from_path, label: `${r.from_path} → ${r.to_url}` };
    const o = there.get(r.from_path);
    if (!o) out.added.push(item);
    else if (stable(pick(r)) === stable(pick(o))) out.same++;
    else out.changed.push(item);
  }
  return out;
};

const applyRedirects: Applier = async (ctx, _group, keys) => {
  const rows = await byIds(ctx.source, 'redirects', '*', 'from_path', keys);
  const skipped: SyncConflict[] = [];
  let written = 0;
  for (const r of rows) {
    const { error } = await ctx.target.from('redirects').upsert({ from_path: r.from_path, ...Object.fromEntries(REDIRECT_FIELDS.map((k) => [k, r[k]])) }, { onConflict: 'from_path' });
    if (error) skipped.push({ key: r.from_path, label: r.from_path, reason: error.message });
    else written++;
  }
  return { written, skipped };
};

// ---- one row, for the diff ------------------------------------------------------------------------

/** A row as a sync compares it (what it would write), on one copy, or null when it isn't there. */
async function record(db: Db, kind: string, group: string, key: string): Promise<unknown> {
  const one = async (q: any) => {
    const { data, error } = await q.maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };
  switch (kind) {
    case 'type': {
      const e = await one(db.from('entries').select('*').eq('id', Number(key)));
      if (!e) return null;
      const [terms, draft] = await Promise.all([db.from('entry_terms').select('term_id, sort').eq('entry_id', e.id), one(db.from('entry_drafts').select('draft').eq('entry_id', e.id))]);
      const names = new Map((await byIds<{ id: number; taxonomy: string; slug: string }>(db, 'terms', 'id, taxonomy, slug', 'id', (terms.data ?? []).map((t) => t.term_id))).map((t) => [t.id, `${t.taxonomy}/${t.slug}`]));
      const content = typeof e.content === 'string' ? JSON.parse(e.content) : e.content;
      return { ...omit(e, [...ENTRY_DERIVED, 'content']), terms: (terms.data ?? []).map((t) => names.get(t.term_id) ?? `term ${t.term_id}`).sort(), unpublished_changes: draft?.draft ?? null, content };
    }
    case 'taxonomy':
      return one(db.from('terms').select('*').eq('id', Number(key)));
    case 'files': {
      const m = await one(db.from('media').select('*').eq('id', Number(key)));
      return m && omit(m, MEDIA_DERIVED);
    }
    case 'templates': {
      const [kindName, ...rest] = key.split('/');
      const t = await one(db.from('templates').select('kind, slug, title, content, former_slugs, trashed_at').eq('kind', kindName).eq('slug', rest.join('/')));
      return t && { ...t, content: typeof t.content === 'string' ? JSON.parse(t.content) : t.content };
    }
    case 'forms': {
      const f = await one(db.from('forms').select('*').eq('id', Number(key)));
      return f && Object.fromEntries(FORM_FIELDS.map((k) => [k, f[k]]));
    }
    case 'settings': {
      const r = await one(db.from('settings').select('value').eq('key', key));
      return r && settingsValue(r.value);
    }
    case 'redirects': {
      const r = await one(db.from('redirects').select('*').eq('from_path', key));
      return r && Object.fromEntries(REDIRECT_FIELDS.map((k) => [k, r[k]]));
    }
  }
  return null;
}

/** JSON laid out with sorted keys, one value per line, for a line diff. */
function pretty(v: unknown): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sort((x as any)[k])])) : x;
  return v == null ? '' : JSON.stringify(sort(v), null, 2);
}

/** One row on both copies, as text: what the target has now and what the sync would write. */
export async function diff(direction: Direction, group: string, key: string): Promise<{ target: string; source: string; sourceName: string; targetName: string }> {
  const { source, target, sourceName, targetName } = endpoints(direction);
  const g = groupDef(group);
  const [s, t] = await Promise.all([record(source, g.kind, group, key), record(target, g.kind, group, key)]);
  return { source: pretty(s), target: pretty(t), sourceName, targetName };
}

// ---- backups --------------------------------------------------------------------------------------
//
// Each copy keeps its backups in its own private `sync-backups` bucket. Two kinds, by name:
//   <time>-from-<source>.json / <time>-before-restore.json: what a sync (or a restore) overwrote and added;
//   <time>-snapshot-<trigger>.json: everything a sync covers, taken on a schedule, by hand or before
//   restoring a snapshot.
// Neither holds stored images: files are backed up as their library rows only.

const BACKUP_BUCKET = 'sync-backups';
// The marker only right after the time and with a trigger after it, so a sync backup whose source is
// named like one (`-from-snapshot-scheduled.json`) is never taken for a snapshot.
const SNAPSHOT = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-snapshot-(scheduled|manual|before-restore)\.json$/;
const isSnapshot = (name: string) => SNAPSHOT.test(name);

/** A copy that keeps backups: this site, or the other copy. */
export type Site = 'here' | 'remote';

export interface BackupInfo {
  path: string;
  created_at: string;
  size: number;
  snapshot: boolean;
}

/** The database and display name of a copy. */
export function siteClient(site: Site): { db: Db; name: string } {
  if (site === 'here') return { db: serviceClient(), name: 'this site' };
  return { db: endpoints('push').target, name: remoteConfig()!.name };
}
const capital = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/** The target's rows a sync is about to overwrite, as they are now: whole rows, as stored. */
async function currentRows(target: Db, kind: string, keys: string[]): Promise<Record<string, unknown>> {
  if (!keys.length) return {};
  const ids = keys.map(Number);
  switch (kind) {
    case 'type': {
      const [entries, terms, drafts] = await Promise.all([byIds(target, 'entries', '*', 'id', ids), byIds(target, 'entry_terms', '*', 'entry_id', ids, LINK_ORDER), byIds(target, 'entry_drafts', '*', 'entry_id', ids)]);
      return { entries, entry_terms: terms, entry_drafts: drafts };
    }
    case 'taxonomy':
      return { terms: await byIds(target, 'terms', '*', 'id', ids) };
    case 'files':
      return { media: await byIds(target, 'media', '*', 'id', ids) };
    case 'forms':
      return { forms: await byIds(target, 'forms', '*', 'id', ids) };
    case 'templates': {
      const rows = [];
      for (const key of keys) {
        const [k, ...rest] = key.split('/');
        const { data, error } = await target.from('templates').select('*').eq('kind', k).eq('slug', rest.join('/')).maybeSingle();
        if (error) throw new Error(`Could not read templates: ${error.message}`);
        if (data) rows.push(data);
      }
      return { templates: rows };
    }
    case 'settings':
      return { settings: await byIds(target, 'settings', '*', 'key', keys) };
    case 'redirects':
      return { redirects: await byIds(target, 'redirects', '*', 'from_path', keys) };
  }
  return {};
}

/** Whether a copy can take writes from this tool: not protected, and with its migrations. Throws if not. */
async function checkWritable(db: Db, name: string): Promise<void> {
  if (await isProtected(db)) throw new Error(`${capital(name)} is protected from syncs.`);
  // The id counters are moved after writing; without the function there, stop before writing.
  const { error } = await db.rpc('sync_reset_ids');
  if (error) throw new Error(`${capital(name)} can't take a sync yet: ${error.message}. Apply the migrations there first (npx wrangler d1 migrations apply DB --remote).`);
}

async function saveFile(db: Db, path: string, body: unknown, upsert = false): Promise<void> {
  const { error: bucketError } = await db.storage.createBucket(BACKUP_BUCKET, { public: false });
  if (bucketError && !/exists|duplicate/i.test(bucketError.message)) throw new Error(`Could not make the backup bucket: ${bucketError.message}`);
  const { error } = await db.storage.from(BACKUP_BUCKET).upload(path, new Blob([JSON.stringify(body, null, 1)], { type: 'application/json' }), { contentType: 'application/json', upsert });
  if (error) throw new Error(`Could not save the backup: ${error.message}`);
}
/** A small JSON file beside the backups (in a folder, so the backup list leaves it out), or null. */
async function readFile(db: Db, path: string): Promise<any | null> {
  const { data } = await db.storage.from(BACKUP_BUCKET).download(path);
  return data ? JSON.parse(await data.text()) : null;
}
// The keys a sync really added (group -> keys), kept beside its backup as the batches are written: a
// restore deletes only these, not everything the plan meant to add (a sync can stop halfway, and the
// ids it never reached then go to rows made by hand).
const writtenPath = (backup: string) => `written/${backup}`;
/** Which of these keys are rows on the target now. */
const presentKeys = async (target: Db, kind: string, keys: string[]) => backupKeys(kind, (await currentRows(target, kind, keys)) as Record<string, any[]>);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

async function saveRowsBackup(db: Db, meta: { source: string; target: string; direction?: Direction }, items: { group: string; added: string[]; changed: string[] }[], label: string, spare?: string) {
  const groups: Record<string, { added: string[]; overwritten: Record<string, unknown> }> = {};
  for (const it of items) groups[it.group] = { added: it.added, overwritten: await currentRows(db, groupDef(it.group).kind, it.changed) };
  const path = `${stamp()}-${label}.json`;
  await saveFile(db, path, { created_at: new Date().toISOString(), ...meta, groups });
  // Older backups beyond the number kept go now (never `spare`, the one being restored); a failure here doesn't stop the sync.
  await pruneBackups(db, spare).catch(() => []);
  return path;
}

/**
 * Before a sync writes anything: check the target can take it (its migrations, its protection), then,
 * unless `save` is off, save a backup there: the current version of every row the sync will
 * overwrite, and the keys of the rows it will add. Stored images aren't in it (files' library rows
 * are). Throws, so the sync doesn't start, if any of that fails.
 */
export async function backup(direction: Direction, items: { group: string; added: string[]; changed: string[] }[], save = true): Promise<{ path: string | null; overwritten: number; added: number }> {
  const { target, sourceName, targetName } = endpoints(direction);
  await checkWritable(target, targetName);
  // A row made on the target since Compare under a key the sync means to add would be overwritten, and
  // the backup (which holds the rows the plan called changed) wouldn't have it.
  for (const it of items) {
    const there = await presentKeys(target, groupDef(it.group).kind, it.added);
    if (there.length) throw new Error(`${capital(targetName)} changed since Compare: ${there.length} of the new rows in ${groupDef(it.group).label} now exist there (${there.slice(0, 5).join(', ')}). Compare again.`);
  }
  const overwritten = items.reduce((n, it) => n + it.changed.length, 0);
  const added = items.reduce((n, it) => n + it.added.length, 0);
  if (!save) return { path: null, overwritten, added };
  const path = await saveRowsBackup(target, { source: sourceName, target: targetName, direction }, items, `from-${sourceName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
  await saveFile(target, writtenPath(path), {});
  return { path, overwritten, added };
}

// What a copy keeps: settings.site.sync_backups_keep (sync backups) and sync_snapshots (schedule and
// how many snapshots). Each copy's own: settings syncs and restores never change them.
export const DEFAULT_BACKUPS_KEPT = 10;
export const DEFAULT_SNAPSHOTS_KEPT = 14;
export interface SnapshotSchedule {
  enabled: boolean;
  every: 'daily' | 'weekly';
  keep: number;
}
async function siteSettings(db: Db): Promise<Record<string, any>> {
  const { data, error } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  if (error) throw new Error(`Could not read the settings: ${error.message}`);
  return (data?.value as Record<string, any>) ?? {};
}
async function setSiteSettings(db: Db, patch: Record<string, unknown>): Promise<void> {
  const value = { ...(await siteSettings(db)), ...patch };
  const { error } = await db.from('settings').upsert({ key: 'site', value }, { onConflict: 'key' });
  if (error) throw new Error(`Could not save: ${error.message}`);
}
const whole = (n: unknown, fallback: number) => (Number.isInteger(n) && (n as number) >= 0 ? (n as number) : fallback);
function retention(v: Record<string, any>): { backups: number; schedule: SnapshotSchedule } {
  const s = v.sync_snapshots ?? {};
  return { backups: whole(v.sync_backups_keep, DEFAULT_BACKUPS_KEPT), schedule: { enabled: !!s.enabled, every: s.every === 'weekly' ? 'weekly' : 'daily', keep: whole(s.keep, DEFAULT_SNAPSHOTS_KEPT) } };
}

async function listFiles(db: Db): Promise<BackupInfo[]> {
  const { data, error } = await db.storage.from(BACKUP_BUCKET).list('', { limit: 1000, sortBy: { column: 'name', order: 'desc' } });
  if (error) {
    if (/not found/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).filter((o) => o.id).map((o) => ({ path: o.name, created_at: o.created_at ?? '', size: Number((o.metadata as any)?.size ?? 0), snapshot: isSnapshot(o.name) }));
}

/** Delete the oldest backups and snapshots beyond the numbers a copy keeps (each counted apart; 0 keeps
 *  all), except `spare`: a restore's own backup is never deleted by the backup the restore saves first. */
async function pruneBackups(db: Db, spare?: string): Promise<string[]> {
  const { backups: keepBackups, schedule } = retention(await siteSettings(db));
  const files = await listFiles(db);
  const old = [
    ...(keepBackups ? files.filter((f) => !f.snapshot).slice(keepBackups) : []),
    ...(schedule.keep ? files.filter((f) => f.snapshot).slice(schedule.keep) : []),
  ]
    .map((f) => f.path)
    .filter((p) => p !== spare);
  if (old.length) {
    const { error } = await db.storage.from(BACKUP_BUCKET).remove([...old, ...old.map(writtenPath)]);
    if (error) throw new Error(`Could not delete old backups: ${error.message}`);
  }
  return old;
}

/** A copy's backups and snapshots, newest first, and what it keeps. */
export async function backups(site: Site): Promise<{ list: BackupInfo[]; keep: number; schedule: SnapshotSchedule }> {
  const { db } = siteClient(site);
  const r = retention(await siteSettings(db));
  return { list: await listFiles(db), keep: r.backups, schedule: r.schedule };
}

/** Set what a copy keeps (and its snapshot schedule), and delete what goes beyond it now. */
export async function setRetention(site: Site, patch: { keep?: number; schedule?: Partial<SnapshotSchedule> }): Promise<{ keep: number; schedule: SnapshotSchedule; deleted: string[] }> {
  const { db } = siteClient(site);
  const current = retention(await siteSettings(db));
  const keep = patch.keep ?? current.backups;
  const schedule = { ...current.schedule, ...patch.schedule };
  for (const n of [keep, schedule.keep]) if (!Number.isInteger(n) || n < 0 || n > 1000) throw new Error('Keep between 0 (all) and 1000.');
  if (schedule.every !== 'daily' && schedule.every !== 'weekly') throw new Error('Snapshots run daily or weekly.');
  await setSiteSettings(db, { sync_backups_keep: keep, sync_snapshots: { enabled: !!schedule.enabled, every: schedule.every, keep: schedule.keep } });
  return { keep, schedule, deleted: await pruneBackups(db) };
}

const safeName = (path: string) => {
  if (!/^[\w.-]+\.json$/.test(path)) throw new Error('Not a backup.');
  return path;
};

/** Delete one backup or snapshot. */
export async function deleteBackup(site: Site, path: string): Promise<void> {
  const { db } = siteClient(site);
  const { error } = await db.storage.from(BACKUP_BUCKET).remove([safeName(path), writtenPath(safeName(path))]);
  if (error) throw new Error(`Could not delete the backup: ${error.message}`);
}

/** One backup or snapshot's file. */
export async function backupFile(site: Site, path: string): Promise<Blob> {
  const { db } = siteClient(site);
  const { data, error } = await db.storage.from(BACKUP_BUCKET).download(safeName(path));
  if (error || !data) throw new Error(`Could not read the backup: ${error?.message ?? 'not found'}`);
  return data;
}

// ---- snapshots ------------------------------------------------------------------------------------

// The tables a snapshot holds, each read whole, in an order that pages safely.
const SNAPSHOT_TABLES: [string, string[]][] = [
  ['media', ['id']],
  ['terms', ['id']],
  ['forms', ['id']],
  ['templates', ['id']],
  ['entries', ['id']],
  ['entry_terms', LINK_ORDER],
  ['entry_drafts', ['entry_id']],
  ['redirects', ['id']],
];

/** Everything a sync covers on one copy, as stored (settings `site` and `options`); not stored images. */
async function readSnapshot(db: Db): Promise<Record<string, any[]>> {
  const tables: Record<string, any[]> = {};
  for (const [table, order] of SNAPSHOT_TABLES) {
    let q = db.from(table).select('*');
    for (const o of order) q = q.order(o);
    tables[table] = await must(q, table);
  }
  const { data, error } = await db.from('settings').select('key, value').in('key', SETTINGS_KEYS);
  if (error) throw new Error(`Could not read the settings: ${error.message}`);
  tables.settings = data ?? [];
  return tables;
}

/** Take a snapshot of a copy and keep it there; older snapshots beyond the number kept go. */
export async function takeSnapshot(db: Db, trigger: 'scheduled' | 'manual' | 'before-restore', spare?: string): Promise<{ path: string; rows: number }> {
  const tables = await readSnapshot(db);
  const path = `${stamp()}-snapshot-${trigger}.json`;
  await saveFile(db, path, { kind: 'snapshot', created_at: new Date().toISOString(), trigger, note: 'Stored images are not included: files are backed up as their library rows only.', tables });
  await pruneBackups(db, spare).catch(() => []);
  return { path, rows: Object.values(tables).reduce((n, t) => n + t.length, 0) };
}

/** Back up a copy now (Back up now). */
export async function snapshotNow(site: Site): Promise<{ path: string; rows: number }> {
  return takeSnapshot(siteClient(site).db, 'manual');
}

/**
 * The scheduled run (src/worker.ts, daily): on this site, take a snapshot
 * if they are on and the last scheduled one is older than the schedule allows.
 */
export async function scheduledSnapshot(): Promise<string> {
  const db = serviceClient();
  const { schedule } = retention(await siteSettings(db));
  if (!schedule.enabled) return 'off';
  const last = (await listFiles(db)).find((f) => f.snapshot && f.path.endsWith('-snapshot-scheduled.json'));
  const age = last ? Date.now() - new Date(last.created_at).getTime() : Infinity;
  // A little short of the period, so a run that starts a few minutes early still takes one.
  if (age < (schedule.every === 'weekly' ? 7 * 24 - 2 : 24 - 2) * 3600_000) return `not due (last ${last!.path})`;
  return `took ${(await takeSnapshot(db, 'scheduled')).path}`;
}

/** Settings rows to restore, with the copy's own sync settings (protection, retention, schedule) as they are now. */
function keepOwnSettings(rows: any[], own: Record<string, any>): any[] {
  return rows.map((r) => (r.key === 'site' ? { ...r, value: { ...settingsValue(r.value), ...Object.fromEntries(OWN_SETTINGS.filter((k) => own[k] != null).map((k) => [k, own[k]])) } } : r));
}

const tableKey: Record<string, (r: any) => string> = {
  media: (r) => String(r.id),
  terms: (r) => String(r.id),
  forms: (r) => String(r.id),
  templates: (r) => `${r.kind}/${r.slug}`,
  entries: (r) => String(r.id),
  redirects: (r) => r.from_path,
};

/** What restoring a snapshot would do: per table, rows it puts back and rows made since (deleted only if asked). */
export async function snapshotPreview(site: Site, path: string): Promise<{ created_at: string; tables: { table: string; restore: number; since: number }[] }> {
  const { db } = siteClient(site);
  const file = JSON.parse(await (await backupFile(site, path)).text());
  if (file.kind !== 'snapshot') throw new Error('Not a snapshot.');
  const now = await readSnapshot(db);
  return {
    created_at: file.created_at,
    tables: Object.keys(tableKey).map((table) => {
      const had = new Set((file.tables[table] ?? []).map(tableKey[table]));
      return { table, restore: had.size, since: (now[table] ?? []).filter((r) => !had.has(tableKey[table](r))).length };
    }),
  };
}

/**
 * Put a copy back as a snapshot has it: every row it holds is written back, entries with exactly their
 * terms and unpublished changes, settings keeping the copy's own sync settings. With `deleteSince`, rows
 * made since the snapshot are deleted too (files: their library rows; stored images stay). A snapshot
 * of the current state is taken first, so the restore can be undone the same way.
 */
async function restoreSnapshot(db: Db, name: string, file: any, path: string, deleteSince: boolean, onBackup?: (path: string) => Promise<void>): Promise<{ restored: number; removed: number; problems: string[]; backup: string }> {
  await checkWritable(db, name);
  const saved = await takeSnapshot(db, 'before-restore', path);
  await onBackup?.(saved.path);
  const t = file.tables as Record<string, any[]>;
  const problems: string[] = [];
  const own = await siteSettings(db);
  const rows = {
    media: t.media ?? [],
    terms: t.terms ?? [],
    forms: t.forms ?? [],
    templates: t.templates ?? [],
    entries: t.entries ?? [],
    entry_terms: t.entry_terms ?? [],
    entry_drafts: t.entry_drafts ?? [],
    settings: keepOwnSettings(t.settings ?? [], own),
    redirects: t.redirects ?? [],
  };
  // Rows made since go first, so the rows written back don't clash with them (an address one of them
  // took since). Entries first (their terms and drafts go with them), then what they could point at.
  let removed = 0;
  if (deleteSince) {
    const now = await readSnapshot(db);
    for (const [table, kind] of [['entries', 'type'], ['terms', 'taxonomy'], ['media', 'files'], ['forms', 'forms'], ['templates', 'templates'], ['redirects', 'redirects']] as const) {
      const had = new Set(rows[table].map(tableKey[table]));
      const since = (now[table] ?? []).map(tableKey[table]).filter((k) => !had.has(k));
      problems.push(...(await removeAdded(db, kind, since)));
      removed += since.length;
    }
  }
  // The same writers a sync backup's restore uses, group by group, files and terms before entries.
  problems.push(...(await putBack(db, 'files', { media: rows.media })));
  problems.push(...(await putBack(db, 'taxonomy', { terms: rows.terms })));
  problems.push(...(await putBack(db, 'forms', { forms: rows.forms })));
  problems.push(...(await putBack(db, 'templates', { templates: rows.templates })));
  problems.push(...(await putBack(db, 'type', { entries: rows.entries, entry_terms: rows.entry_terms, entry_drafts: rows.entry_drafts })));
  problems.push(...(await putBack(db, 'settings', { settings: rows.settings })));
  problems.push(...(await putBack(db, 'redirects', { redirects: rows.redirects })));
  const { error } = await db.rpc('sync_reset_ids');
  if (error) problems.push(`The id counters could not be moved on: ${error.message}`);
  return { restored: Object.values(rows).reduce((n, r) => n + r.length, 0), removed, problems, backup: saved.path };
}

// ---- restoring a backup ----------------------------------------------------------------------------

/** The keys of the rows a backup holds for a group (as its plan named them). */
function backupKeys(kind: string, rows: Record<string, any[]>): string[] {
  switch (kind) {
    case 'type':
      return (rows.entries ?? []).map((r) => String(r.id));
    case 'taxonomy':
      return (rows.terms ?? []).map((r) => String(r.id));
    case 'files':
      return (rows.media ?? []).map((r) => String(r.id));
    case 'forms':
      return (rows.forms ?? []).map((r) => String(r.id));
    case 'templates':
      return (rows.templates ?? []).map((r) => templateKey(r));
    case 'settings':
      return (rows.settings ?? []).map((r) => r.key);
    case 'redirects':
      return (rows.redirects ?? []).map((r) => r.from_path);
  }
  return [];
}

/** A batch's rows go to the database as one JSON value, which D1 takes up to 2 MB: well under that. */
const BATCH_BYTES = 1_000_000;

/** Rows in batches of up to 100 whose JSON stays within BATCH_BYTES (a larger row goes on its own). */
function batches<T>(data: T[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const r of data) {
    const bytes = new TextEncoder().encode(JSON.stringify(r)).length;
    if (cur.length && (cur.length >= 100 || size + bytes > BATCH_BYTES)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += bytes;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Upsert rows in batches (`batches`). A batch that fails is retried row by row, so one row that can't go
 * back (an address another row has now) is reported on its own and the rest are written. Returns the
 * keys written and the problems.
 */
async function writeRows(db: Db, table: string, data: any[], onConflict: string, key: (r: any) => string): Promise<{ written: Set<string>; problems: string[] }> {
  const written = new Set<string>();
  const problems: string[] = [];
  for (const batch of batches(data)) {
    const { error } = await db.from(table).upsert(batch, { onConflict });
    if (!error) {
      batch.forEach((r) => written.add(key(r)));
      continue;
    }
    for (const r of batch) {
      const { error: e } = await db.from(table).upsert(r, { onConflict });
      if (e) problems.push(`${table} ${key(r)}: ${e.message}`);
      else written.add(key(r));
    }
  }
  return { written, problems };
}

/**
 * Entries' terms and unpublished changes exactly as saved, in bulk: the saved links and drafts are
 * upserted, then those of the entries that aren't in the saved set are deleted (only entries with any
 * get a request of their own).
 */
async function putBackLinks(db: Db, ids: number[], links: any[], drafts: any[]): Promise<string[]> {
  const problems: string[] = [];
  const want = new Set(links.map((l) => `${l.entry_id}:${l.term_id}`));
  for (let i = 0; i < links.length; i += 500) {
    const { error } = await db.from('entry_terms').upsert(links.slice(i, i + 500), { onConflict: 'entry_id,term_id' });
    if (error) problems.push(`entry terms: ${error.message}`);
  }
  if (!problems.length) {
    const stale = new Map<number, number[]>();
    for (const l of await byIds<{ entry_id: number; term_id: number }>(db, 'entry_terms', 'entry_id, term_id', 'entry_id', ids, LINK_ORDER))
      if (!want.has(`${l.entry_id}:${l.term_id}`)) stale.set(l.entry_id, [...(stale.get(l.entry_id) ?? []), l.term_id]);
    for (const [entry, terms] of stale) {
      const { error } = await db.from('entry_terms').delete().eq('entry_id', entry).in('term_id', terms);
      if (error) problems.push(`entry ${entry}'s terms: ${error.message}`);
    }
  }
  problems.push(...(await writeRows(db, 'entry_drafts', drafts, 'entry_id', (d) => String(d.entry_id))).problems);
  const hasDraft = new Set(drafts.map((d) => d.entry_id));
  const extra = (await byIds<{ entry_id: number }>(db, 'entry_drafts', 'entry_id', 'entry_id', ids)).map((d) => d.entry_id).filter((id) => !hasDraft.has(id));
  for (let i = 0; i < extra.length; i += 200) {
    const { error } = await db.from('entry_drafts').delete().in('entry_id', extra.slice(i, i + 200));
    if (error) problems.push(`unpublished changes: ${error.message}`);
  }
  return problems;
}

/** Put a group's saved rows back as they were. Returns problems, if any. */
async function putBack(db: Db, kind: string, rows: Record<string, any[]>): Promise<string[]> {
  const byId = (r: any) => String(r.id);
  switch (kind) {
    case 'type': {
      const entries = rows.entries ?? [];
      const { written, problems } = await writeRows(db, 'entries', parentsFirst(entries).map((e) => omit(e, ['body_text'])), 'id', byId);
      // Terms and unpublished changes only for the entries that went back.
      const ids = entries.filter((e) => written.has(byId(e))).map((e) => e.id);
      const keep = new Set(ids);
      problems.push(...(await putBackLinks(db, ids, (rows.entry_terms ?? []).filter((l) => keep.has(l.entry_id)), (rows.entry_drafts ?? []).filter((d) => keep.has(d.entry_id)))));
      return problems;
    }
    case 'taxonomy':
      return (await writeRows(db, 'terms', parentsFirst(rows.terms ?? []), 'id', byId)).problems;
    case 'files':
      return (await writeRows(db, 'media', rows.media ?? [], 'id', byId)).problems;
    case 'forms':
      return (await writeRows(db, 'forms', rows.forms ?? [], 'id', byId)).problems;
    case 'templates':
      return (await writeRows(db, 'templates', (rows.templates ?? []).map((t) => ({ kind: t.kind, slug: t.slug, title: t.title, content: t.content })), 'kind,slug', templateKey)).problems;
    case 'settings':
      return (await writeRows(db, 'settings', (rows.settings ?? []).map((r) => ({ key: r.key, value: r.value })), 'key', (r) => r.key)).problems;
    case 'redirects':
      return (await writeRows(db, 'redirects', (rows.redirects ?? []).map((r) => ({ from_path: r.from_path, ...Object.fromEntries(REDIRECT_FIELDS.map((k) => [k, r[k]])) })), 'from_path', (r) => r.from_path)).problems;
  }
  return [];
}

/**
 * Delete the rows a sync added (an added file's library row, not its stored images). Rows that other
 * rows came to depend on stay, since deleting them would take those along or cut them loose, and no
 * backup holds them: entries with ticket orders, waitlist places or emails of their own, or pages
 * under them; terms entries still use, or with terms under them; files entries still feature.
 * Returns problems, if any (the rows kept among them).
 */
export async function removeAdded(db: Db, kind: string, keys: string[]): Promise<string[]> {
  if (!keys.length) return [];
  const problems: string[] = [];
  const del = async (table: string, column: string, values: (string | number)[]) => {
    for (let i = 0; i < values.length; i += 200) {
      const { error } = await db.from(table).delete().in(column, values.slice(i, i + 200));
      if (error) problems.push(`${table}: ${error.message}`);
    }
  };
  const ids = keys.map(Number);
  const among = new Set(ids);
  // Of `ids`, those a row of `table` points at through `column` (rows that are themselves among `ids` aside).
  const usedBy = async (table: string, column: string, notAmong = false): Promise<Set<number>> => {
    const used = new Set<number>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from(table).select(notAmong ? `id, ${column}` : column).in(column, ids.slice(i, i + 200));
      if (error) {
        problems.push(`${table}: ${error.message}`);
        ids.slice(i, i + 200).forEach((id) => used.add(id));
        continue;
      }
      for (const r of (data ?? []) as Record<string, number>[]) if (!notAmong || !among.has(r.id)) used.add(r[column]);
    }
    return used;
  };
  const keeping = async (what: string, why: [string, string, boolean?][]) => {
    const keep = new Set<number>();
    for (const [table, column, notAmong] of why) for (const id of await usedBy(table, column, notAmong)) keep.add(id);
    if (keep.size) problems.push(`Kept ${what} ${[...keep].join(', ')}: other rows use ${keep.size === 1 ? 'it' : 'them'}.`);
    return ids.filter((id) => !keep.has(id));
  };
  switch (kind) {
    case 'type':
      await del('entries', 'id', await keeping('entries', [['ticket_orders', 'entry_id'], ['ticket_waitlist', 'entry_id'], ['ticket_emails', 'entry_id'], ['entries', 'parent_id', true]]));
      break;
    case 'taxonomy':
      await del('terms', 'id', await keeping('terms', [['entry_terms', 'term_id'], ['terms', 'parent_id', true]]));
      break;
    case 'files':
      // The library rows only: their stored images stay, since backups don't hold images and undoing
      // this restore would otherwise bring back rows without them.
      await del('media', 'id', await keeping('files', [['entries', 'featured_media_id']]));
      break;
    case 'forms': {
      // Deleting a form detaches its submissions for good (backups don't hold them), so those forms stay.
      const { data: used, error } = await db.from('form_submissions').select('form_id').in('form_id', ids);
      if (error) return [`forms: ${error.message}`];
      const keep = new Set((used ?? []).map((r) => r.form_id));
      if (keep.size) problems.push(`Kept ${keep.size === 1 ? 'form' : 'forms'} ${[...keep].join(', ')}: ${keep.size === 1 ? 'it has' : 'they have'} submissions.`);
      await del('forms', 'id', ids.filter((id) => !keep.has(id)));
      break;
    }
    case 'templates':
      for (const key of keys) {
        const [k, ...rest] = key.split('/');
        const { error } = await db.from('templates').delete().eq('kind', k).eq('slug', rest.join('/'));
        if (error) problems.push(`${key}: ${error.message}`);
      }
      break;
    case 'settings':
      await del('settings', 'key', keys);
      break;
    case 'redirects':
      await del('redirects', 'from_path', keys);
      break;
  }
  return problems;
}

/**
 * Restore a backup on the copy that holds it. A sync's backup undoes that sync: the rows it overwrote
 * go back as they were, the rows it added are deleted (files' library rows; their stored images stay).
 * A snapshot puts the copy back as the snapshot has it (`deleteSince`: rows made since go too). Either
 * way the current state is saved first, so the restore can itself be undone; changes made since to
 * those rows are lost, and stored images are never restored (backups don't hold them). `onBackup` is
 * told the saved state's name before anything is changed.
 */
export async function restore(site: Site, path: string, opts: { deleteSince?: boolean; onBackup?: (path: string) => Promise<void> } = {}): Promise<{ restored: number; removed: number; problems: string[]; backup: string | null }> {
  const { db, name } = siteClient(site);
  const file = JSON.parse(await (await backupFile(site, path)).text());
  if (file.kind === 'snapshot') return restoreSnapshot(db, name, file, path, !!opts.deleteSince, opts.onBackup);
  const groups = file.groups as Record<string, { added: string[]; overwritten: Record<string, any[]> }>;
  // The rows the sync really added; a backup from before those were recorded has only the planned ones.
  const { data: listed, error: listError } = await db.storage.from(BACKUP_BUCKET).list('written', { search: path });
  if (listError) throw new Error(`Could not read the backup: ${listError.message}`);
  const recorded = (listed ?? []).some((o) => o.name === path);
  const written: Record<string, string[]> | null = recorded ? await readFile(db, writtenPath(path)) : null;
  if (recorded && !written) throw new Error('Could not read which rows that sync added. Try again.');
  const plans = syncGroups()
    .filter((g) => groups?.[g.id])
    .map((g) => ({ g, rows: groups[g.id].overwritten ?? {}, added: (written ? written[g.id] : groups[g.id].added) ?? [] }));
  await checkWritable(db, name);
  // The current state of everything the restore changes or deletes, saved first.
  const saved = await saveRowsBackup(db, { source: name, target: name }, plans.map(({ g, rows, added }) => ({ group: g.id, added: [], changed: [...backupKeys(g.kind, rows), ...added] })), 'before-restore', path);
  await opts.onBackup?.(saved);
  const own = await siteSettings(db);
  const problems: string[] = [];
  let restored = 0;
  let removed = 0;
  // The rows the sync added go first (entries before the terms and files they use), so the rows written
  // back don't clash with them; then files and terms back before the entries pointing at them.
  for (const { g, added } of [...plans].reverse()) {
    problems.push(...(await removeAdded(db, g.kind, added)));
    removed += added.length;
  }
  for (const { g, rows } of plans) {
    // Settings go back with this copy's own sync settings as they are now.
    problems.push(...(await putBack(db, g.kind, g.kind === 'settings' ? { settings: keepOwnSettings(rows.settings ?? [], own) } : rows)));
    restored += backupKeys(g.kind, rows).length;
  }
  const { error } = await db.rpc('sync_reset_ids');
  if (error) problems.push(`The id counters could not be moved on: ${error.message}`);
  return { restored, removed, problems, backup: saved };
}

// ---- restore jobs ---------------------------------------------------------------------------------
//
// A restore deletes rows and then writes thousands back, longer than a request may run; cut off
// halfway it would leave the copy half restored. So it runs as a job: the API queues it and hands its
// id to the jobs queue (src/lib/jobs.ts; without one it runs in the request), and the screen polls. The job is a file in this site's backup bucket, named by an id only
// the API and the signed-in admin's browser know. One run claims it (a claim file made only where there
// is none) and writes the time to it every HEARTBEAT_MS; a running job silent for RESTORE_SILENT_MS was
// cut off (the Worker's time limit, or the Worker stopped), and the poll says so. The queue doesn't run
// a job again (max_retries 0): a restore cut off halfway is the admin's to undo or run again.

export type RestoreJob = {
  status: 'queued' | 'running' | 'done' | 'error';
  site: Site;
  path: string;
  deleteSince: boolean;
  queued_at?: string;
  started_at?: string;
  /** The last time the run was heard from. */
  heartbeat_at?: string;
  /** The state saved before the restore changed anything. */
  backup?: string;
  result?: Awaited<ReturnType<typeof restore>>;
  error?: string;
};
const HEARTBEAT_MS = 30_000;
const RESTORE_SILENT_MS = 3 * 60_000;
/** A queued restore not started by then never will be (its run failed before claiming it). */
const RESTORE_UNSTARTED_MS = 16 * 60_000;
const jobPath = (id: string, ending = 'json') => {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Not a restore.');
  return `jobs/${id}.${ending}`;
};

export async function queueRestore(site: Site, path: string, deleteSince: boolean): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '');
  await saveFile(serviceClient(), jobPath(id), { status: 'queued', site, path: safeName(path), deleteSince, queued_at: new Date().toISOString() } satisfies RestoreJob);
  return id;
}

/** Run a queued restore, once: a second run for the same job (a retried or doubled worker) finds it claimed and does nothing. */
export async function runRestore(id: string): Promise<RestoreJob | null> {
  const db = serviceClient();
  const job: RestoreJob | null = await readFile(db, jobPath(id));
  if (job?.status !== 'queued') return null;
  // The claim: made only if there is none (412, as 409, otherwise), so only one run goes on.
  const { error: claim } = await db.storage.from(BACKUP_BUCKET).upload(jobPath(id, 'claim'), new Blob([new Date().toISOString()], { type: 'text/plain' }), { contentType: 'text/plain', upsert: false });
  if (claim?.statusCode === '409') return null;
  const now = () => new Date().toISOString();
  if (claim) {
    const failed: RestoreJob = { ...job, status: 'error', error: `The restore could not start (${claim.message}). Nothing was changed: try it again.` };
    await saveFile(db, jobPath(id), failed, true);
    return failed;
  }
  let state: RestoreJob = { ...job, status: 'running', started_at: now(), heartbeat_at: now() };
  await saveFile(db, jobPath(id), state, true);
  // Heartbeats in turn, never over the final state (each waits for the one before).
  let writing: Promise<void> = Promise.resolve();
  const beat = (patch: Partial<RestoreJob> = {}) => {
    state = { ...state, ...patch, heartbeat_at: now() };
    const next = { ...state };
    writing = writing.then(() => saveFile(db, jobPath(id), next, true)).catch((e: Error) => console.error(`restore ${id}: heartbeat not saved: ${e.message}`));
    return writing;
  };
  const timer = setInterval(() => beat(), HEARTBEAT_MS);
  let done: RestoreJob;
  try {
    // The backup's name is in the job before the restore changes anything.
    const result = await restore(job.site, job.path, { deleteSince: job.deleteSince, onBackup: (backup) => beat({ backup }) });
    done = { ...state, status: 'done', result };
  } catch (e) {
    done = { ...state, status: 'error', error: (e as Error).message };
  } finally {
    clearInterval(timer);
    await writing;
  }
  done.heartbeat_at = now();
  await saveFile(db, jobPath(id), done, true);
  return done;
}

const since = (t: string | undefined) => Date.now() - (t ? Date.parse(t) : 0);

/** A restore job's state, for the screen: a run silent too long (or never started) reads as failed. */
export async function restoreJob(id: string): Promise<RestoreJob | null> {
  const job: RestoreJob | null = await readFile(serviceClient(), jobPath(id));
  if (job?.status === 'running' && since(job.heartbeat_at ?? job.started_at) > RESTORE_SILENT_MS) {
    const error = job.backup
      ? `The restore was cut off before it finished (nothing heard from it for ${RESTORE_SILENT_MS / 60_000} minutes), so the copy may be partly restored. Its state from before the restore is saved as ${job.backup}: restore that to put it back as it was, or run this restore again.`
      : `The restore was cut off before it changed anything (nothing heard from it for ${RESTORE_SILENT_MS / 60_000} minutes). Try it again.`;
    return { ...job, status: 'error', error };
  }
  if (job?.status === 'queued' && job.queued_at && since(job.queued_at) > RESTORE_UNSTARTED_MS) return { ...job, status: 'error', error: 'The restore never started. Nothing was changed: try it again.' };
  return job;
}

// ---- entry points ---------------------------------------------------------------------------------

const PLANNERS: Record<string, Planner> = { files: planMedia, taxonomy: planTerms, forms: planForms, templates: planTemplates, type: planEntries, settings: planSettings, redirects: planRedirects };
const APPLIERS: Record<string, Applier> = { files: applyMedia, taxonomy: applyTerms, forms: applyForms, templates: applyTemplates, type: applyEntries, settings: applySettings, redirects: applyRedirects };
// Groups whose rows are written with their ids: the id counters then move past them.
const KEEPS_IDS = new Set(['files', 'taxonomy', 'forms', 'type']);

const groupDef = (id: string) => {
  const g = syncGroups().find((x) => x.id === id);
  if (!g) throw new Error(`Unknown sync group: ${id}`);
  return g;
};

/** Compare the chosen groups between the two copies. */
export async function plan(direction: Direction, groups: string[]): Promise<SyncPlan> {
  const { source, target, sourceName, targetName } = endpoints(direction);
  const ctx: Context = { source, target, chosen: new Set(groups), planning: true };
  const order = syncGroups().filter((g) => groups.includes(g.id));
  const results: GroupPlan[] = [];
  for (const g of order) results.push({ id: g.id, label: g.label, ...(await PLANNERS[g.kind](ctx, g.id)) });
  return { source: sourceName, target: targetName, protected: await isProtected(target), groups: results };
}

/** Write one batch of a group's rows (keys from a plan), checking each again. */
export async function apply(direction: Direction, groups: string[], group: string, keys: string[], backupPath?: string): Promise<{ written: number; skipped: SyncConflict[] }> {
  const { source, target, targetName } = endpoints(direction);
  if (await isProtected(target)) throw new Error(`${capital(targetName)} is protected from syncs.`);
  const g = groupDef(group);
  const before = backupPath ? new Set(await presentKeys(target, g.kind, keys)) : null;
  const result = await APPLIERS[g.kind]({ source, target, chosen: new Set(groups) }, group, keys);
  if (before && backupPath) {
    const added = (await presentKeys(target, g.kind, keys)).filter((k) => !before.has(k));
    if (added.length) {
      const written = (await readFile(target, writtenPath(safeName(backupPath)))) ?? {};
      await saveFile(target, writtenPath(safeName(backupPath)), { ...written, [group]: [...(written[group] ?? []), ...added] }, true);
    }
  }
  if (result.written && KEEPS_IDS.has(g.kind)) {
    const { error } = await target.rpc('sync_reset_ids');
    if (error) result.skipped.push({ key: '', label: '', reason: `Written, but the id counters could not be moved on: ${error.message}` });
  }
  return result;
}
