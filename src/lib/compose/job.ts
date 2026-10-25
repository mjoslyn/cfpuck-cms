// A compose turn as a job. A build takes 30-90s or more (longer with site searches), past what a request
// may run on Netlify, so the API queues the turn in compose_jobs and hands it to the background function
// (netlify/functions/compose-background.mts, up to 15 minutes); where there is none (astro dev) it runs
// in-process. The runner writes progress to the job row and the panel polls it.
import type { Db } from '../db/query';
import { refreshSiteTimezone } from '../site/timezone';
import { serviceClient } from '../supabase';
import { MediaStore } from '../media/process';
import { permalink } from '../permalink';
import { renderedTitle } from '../admin/save';
import type { PuckItem } from '../puck/types';
import { blocksFor, briefBlocksFor, buildMaterials, type Registry } from './materials';

/**
 * What one turn sends of the conversation's materials in full, newest first: well inside the API's
 * limits on images and request size, which a long conversation re-sending everything went past.
 */
export const MATERIAL_BUDGET = { images: 20, pdfs: 5, bytes: 20 * 1024 * 1024, text: 400_000 };

/** Which turns' materials go in full: newest first, while the running totals stay within the budget. */
export function turnsInFull(turns: { images: number; pdfs: number; bytes: number; text?: number }[], budget = MATERIAL_BUDGET): boolean[] {
  const used = { images: 0, pdfs: 0, bytes: 0, text: 0 };
  const full = turns.map(() => false);
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (used.images + t.images > budget.images || used.pdfs + t.pdfs > budget.pdfs || used.bytes + t.bytes > budget.bytes || used.text + (t.text ?? 0) > budget.text) continue;
    used.images += t.images;
    used.pdfs += t.pdfs;
    used.bytes += t.bytes;
    used.text += t.text ?? 0;
    full[i] = true;
  }
  return full;
}
import { converse, type Turn, type UserTurn } from './claude';
import { buildPage } from './build';
import { outline, isComposed } from './outline';
import { sanitizeBlocks } from './edit';
import { searchSite } from './site';
import { describeFields, editorPatch, entryColumns, entryFields, type EditorFields } from './entry-fields';
import { SEO_LIMITS, seoOf, type Seo } from '../seo';
import type { PagePlan } from './spec';

/** The plan's SEO as the entry keeps it (share image as a media id), marked as written by Compose. */
function planSeo(plan: PagePlan, images: Map<string, { mediaId: number; src: string }>): Seo | undefined {
  const p = plan.seo;
  if (!p?.title && !p?.description) return undefined;
  const picked = p.image ? images.get(p.image) : undefined;
  return { title: p.title?.trim().slice(0, SEO_LIMITS.title + 20), description: p.description?.trim().slice(0, SEO_LIMITS.description + 40), ...(picked ? { image: picked.mediaId, image_url: picked.src } : {}), generated: true };
}

/** What the editor sent with the message, besides the message itself (which is in the session's turns). */
export interface JobInput {
  /** Outline of the composed sections as they are now in the editor. */
  current?: string;
  /** Outline of the rest of the page. */
  other?: string;
  /** The entry's own fields as the editor's form holds them. */
  liveFields?: EditorFields | null;
}

interface Session {
  id: string;
  entry_id: number | null;
  entry_type: string;
  turns: Turn[];
  materials: Registry;
  block_prefix: string;
}

/** A job older than the worker's ceiling is over, whatever its row says: a killed worker never wrote one. */
export const STALE_MS = 16 * 60 * 1000;
/** A running job that has not written progress (heartbeat every 10s) for this long has died. */
export const SILENT_MS = 3 * 60 * 1000;

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'composed-page';

/** Queue a turn; returns the job id and the token the worker must present. */
export async function queueJob(db: Db, sessionId: string, authorId: string, input: JobInput) {
  const { data, error } = await db.from('compose_jobs').insert({ session_id: sessionId, author_id: authorId, input }).select('id, token').single();
  if (error) throw error;
  return data as { id: string; token: string };
}

/** Record the outcome. The row is the only way a worker nobody is awaiting can report anything. */
async function finish(db: Db, id: string, patch: { status: 'done' | 'error'; result?: unknown; error?: string }) {
  await db.from('compose_jobs').update(patch).eq('id', id);
}

/**
 * Run a queued job: claim it (queued -> running, only with its token, so it runs once), run the turn,
 * write progress as it goes and the result at the end. Never throws; failures are written to the job.
 */
export async function runJob(jobId: string, token: string): Promise<void> {
  const db = serviceClient();
  await refreshSiteTimezone(db);
  const { data: job } = await db.from('compose_jobs').update({ status: 'running', progress: 'Starting' }).eq('id', jobId).eq('token', token).eq('status', 'queued').select('*').maybeSingle();
  if (!job) return;
  const { data: session } = await db.from('compose_sessions').select('*').eq('id', job.session_id).maybeSingle();
  if (!session) return finish(db, jobId, { status: 'error', error: 'The conversation is gone.' });
  const s = session as Session;
  const input = (job.input ?? {}) as JobInput;

  // Progress: kept in memory, written at most every 700ms (and every 10s as a heartbeat).
  const progress = { progress: 'Starting', say: '', notes: [] as string[] };
  let dirty = false;
  let writing: Promise<unknown> = Promise.resolve();
  const flush = () => {
    if (!dirty) return writing;
    dirty = false;
    const snapshot = { progress: progress.progress, say: progress.say, notes: progress.notes };
    writing = writing.then(() => db.from('compose_jobs').update(snapshot).eq('id', jobId));
    return writing;
  };
  const tick = setInterval(() => {
    dirty = true;
    flush();
  }, 10_000);
  const quick = setInterval(flush, 700);
  const set = (p: Partial<typeof progress>) => {
    Object.assign(progress, p);
    dirty = true;
  };

  try {
    const store = new MediaStore(db);
    const last = s.turns[s.turns.length - 1] as UserTurn | undefined;
    const target = last?.role === 'user' ? last.target : undefined;

    // Materials go with the turn they were added in. The whole conversation is sent each turn, so only
    // the newest go in full (up to MATERIAL_BUDGET: images, PDFs, bytes); older ones as their ids and
    // descriptions, which is enough to keep using them in the page.
    set({ progress: 'Reading the materials' });
    const materialBlocks = new Map<number, any[]>();
    const userTurns = [...s.turns.entries()].filter(([, t]) => t.role === 'user' && (t as UserTurn).added.length) as [number, UserTurn][];
    const built = await Promise.all(userTurns.map(([, t]) => blocksFor(db, store, s.materials, t.added)));
    const sizes = built.map((blocks) => ({
      images: blocks.filter((b: any) => b.type === 'image').length,
      pdfs: blocks.filter((b: any) => b.type === 'document').length,
      bytes: blocks.reduce((n: number, b: any) => n + (b.source?.data?.length ?? 0), 0),
      // Text documents and link text: characters (about four to a token).
      text: blocks.reduce((n: number, b: any) => n + (b.type === 'text' ? b.text?.length ?? 0 : 0), 0),
    }));
    const full = turnsInFull(sizes);
    userTurns.forEach(([i, t], k) => materialBlocks.set(i, full[k] ? built[k] : briefBlocksFor(s.materials, t.added)));

    // Without the editor's live view, describe the saved page.
    let other = input.other ?? '';
    const current = input.current ?? '';
    if (s.entry_id && !other && !current) {
      const { data: e } = await db.from('entries').select('content').eq('id', s.entry_id).maybeSingle();
      const items = (e?.content?.content ?? []) as PuckItem[];
      other = outline(items.filter((i) => !isComposed(i, s.block_prefix)));
    }
    // The entry's own fields: the editor's current form, or as saved.
    let liveFields = input.liveFields ?? null;
    if (s.entry_id && !liveFields) {
      const { data: e } = await db.from('entries').select('fields, event_start, event_end, event_all_day').eq('id', s.entry_id).maybeSingle();
      if (e) liveFields = e as EditorFields;
    }
    const currentFields = liveFields ? describeFields(s.entry_type, liveFields) : '';
    const { data: pages } = await db.from('entries').select('id, type, slug, title').eq('type', 'page').eq('status', 'publish').order('title').limit(60);
    const materials = await buildMaterials(db, s.materials);

    set({ progress: s.turns.length > 1 ? 'Claude is working on it' : 'Claude is laying out the page' });
    const result = await converse(
      { turns: s.turns, materialBlocks, entryType: s.entry_type, otherContent: other || undefined, currentSections: current || undefined, sitePages: (pages ?? []).map((p) => ({ title: p.title, path: permalink(p) })), tags: [...materials.tags.keys()], currentFields: currentFields || undefined },
      {
        status: (t) => set({ progress: t }),
        text: (chunk) => set({ say: progress.say + chunk }),
        // Site content: images found join the materials so the page can use them.
        search: async (q) => {
          const found = await searchSite(db, s.materials, q);
          await db.from('compose_sessions').update({ materials: s.materials }).eq('id', s.id);
          return found;
        },
      },
    );
    s.turns.push({ role: 'assistant', text: result.text, plan: result.plan, fields: result.fields, tool: result.tool, toolId: result.toolId, ...(result.edit && target ? { edit: { targetId: target.id, blocks: result.edit.blocks } } : {}), at: new Date().toISOString() });

    let items: PuckItem[] | undefined;
    let fieldsPatch: ReturnType<typeof editorPatch> | undefined;
    let newEntry: number | undefined;
    let edit: { targetId: string; items: PuckItem[] } | undefined;
    if (result.edit) {
      if (!target) throw new Error('Claude edited a block, but no block was selected.');
      const materialsNow = await buildMaterials(db, s.materials);
      const { items: blocks, dropped } = sanitizeBlocks(result.edit, JSON.parse(target.json), materialsNow, `${s.block_prefix}-e${s.turns.length}`);
      if (dropped.length) set({ notes: [...progress.notes, `Left out unknown block types: ${[...new Set(dropped)].join(', ')}.`] });
      if (!blocks.length) throw new Error('The edit came back empty.');
      edit = { targetId: target.id, items: blocks };
    }
    if (result.plan) {
      const built = await buildMaterials(db, s.materials);
      items = buildPage(result.plan, built, `${s.block_prefix}-t${s.turns.length}`);
      if (!s.entry_id) {
        // First build from the admin: a new draft.
        const base = slugify(result.plan.slug || result.plan.title);
        const { data: taken } = await db.from('entries').select('slug').eq('type', s.entry_type).like('slug', `${base}%`);
        const used = new Set((taken ?? []).map((r) => r.slug));
        let slug = base;
        for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
        const { data: row, error } = await db
          .from('entries')
          .insert({ type: s.entry_type, slug, title: result.plan.title, title_rendered: renderedTitle(result.plan.title), excerpt: result.plan.excerpt ?? '', status: 'draft', ...entryColumns(s.entry_type, { ...entryFields(s.entry_type, result.plan.fields, built.images), seo: planSeo(result.plan, built.images) ?? null }), content: { root: { props: {} }, content: items, zones: {} } })
          .select('id')
          .single();
        if (error) throw error;
        s.entry_id = newEntry = row.id;
      }
    }
    // Field changes to an existing entry go to the editor's form (saved with the page).
    const fieldUpdate = result.fields ?? (newEntry ? undefined : result.plan?.fields);
    if (fieldUpdate && s.entry_id && !newEntry) {
      const cleaned = entryFields(s.entry_type, fieldUpdate, (await buildMaterials(db, s.materials)).images);
      if (Object.keys(cleaned).length) fieldsPatch = editorPatch(s.entry_type, cleaned);
    }
    // SEO for an existing entry: rewritten on each build unless someone has edited it since.
    if (result.plan && s.entry_id && !newEntry) {
      const had = seoOf(liveFields?.fields);
      const seo = planSeo(result.plan, (await buildMaterials(db, s.materials)).images);
      if (seo && (!Object.keys(had).length || had.generated)) fieldsPatch = { ...(fieldsPatch ?? {}), fields: { ...(fieldsPatch?.fields ?? {}), seo: { ...seo, ...(had.noindex ? { noindex: true } : {}) } } };
    }
    await db.from('compose_sessions').update({ turns: s.turns, materials: s.materials, entry_id: s.entry_id, ...(result.plan ? { plan: result.plan } : {}) }).eq('id', s.id);
    clearInterval(quick);
    dirty = true;
    await flush();
    await finish(db, jobId, { status: 'done', result: { reply: result.text, entryId: newEntry, fields: fieldsPatch, items: newEntry ? undefined : items, edit, prefix: s.block_prefix, title: result.plan?.title } });
  } catch (e) {
    console.error('[compose job]', e);
    await db.from('compose_sessions').update({ turns: s.turns, materials: s.materials }).eq('id', s.id);
    clearInterval(quick);
    dirty = true;
    await flush().catch(() => {});
    await finish(db, jobId, { status: 'error', error: (e as Error).message ?? String(e) }).catch(() => {});
  } finally {
    clearInterval(tick);
    clearInterval(quick);
  }
}
