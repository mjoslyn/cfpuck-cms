// Compose with Claude, as a saved conversation per page (compose_sessions). A turn runs as a job
// (src/lib/compose/job.ts) on the jobs queue: the build takes longer than an answer should wait.
// POST (multipart): sessionId?, entryId?, type (a composable content type), message, docs (files), media (library
//   ids, repeated), links (one per line), current (outline of the composed sections as they are now
//   in the editor), other (outline of the rest of the page), entryFields (the editor's field form),
//   targetId/targetLabel/targetJson (a block selected in the editor, for a targeted edit). Reads the
//   materials, queues the turn and answers 202 { jobId, sessionId, prefix, notes }.
// GET ?job=<id>: the job's progress { status, progress, say, notes, result?, error? }, polled by the
//   panel; result is { reply, entryId? (a new draft), items? + prefix (blocks to put on the page), edit?
//   {targetId, items} (replacement for the selected block), fields? (field form patch), title? }.
// GET ?entryId= (latest session for a page) or ?sessionId=: the conversation, for display.
import type { APIRoute } from 'astro';
import { COMPOSABLE_TYPES } from '../../../lib/site';
import type { EditorFields } from '../../../lib/compose/entry-fields';
import { serviceClient } from '../../../lib/db/site';
import { emptyRegistry, ingest, type Registry } from '../../../lib/compose/materials';
import type { Turn } from '../../../lib/compose/claude';
import { queueJob, runJob, SILENT_MS, STALE_MS, type JobInput } from '../../../lib/compose/job';
import { enqueue } from '../../../lib/jobs';
import { afterAnswer } from '../../../lib/platform';

interface Session {
  id: string;
  entry_id: number | null;
  entry_type: string;
  turns: Turn[];
  materials: Registry;
  plan: any;
  block_prefix: string;
}

/** The conversation as the composer panel shows it. */
function view(s: Session) {
  const label = (ref: string) => {
    const r = s.materials;
    const img = r.images.find((x) => x.ref === ref);
    if (img) return { ref, kind: 'image', label: img.title || img.src.split('/').pop(), src: img.src };
    const vid = r.videos.find((x) => x.ref === ref);
    if (vid) return { ref, kind: 'video', label: vid.title || (vid.kind === 'embed' ? vid.url : vid.src) };
    const doc = r.docs.find((x) => x.ref === ref);
    if (doc) return { ref, kind: 'doc', label: doc.name };
    const link = r.links.find((x) => x.ref === ref);
    if (link) return { ref, kind: 'link', label: link.title || link.url };
    return { ref, kind: 'other', label: ref };
  };
  return {
    id: s.id,
    entryId: s.entry_id,
    entryType: s.entry_type,
    prefix: s.block_prefix,
    turns: s.turns.map((t) =>
      t.role === 'user'
        ? { role: 'user', text: t.text, at: t.at, attachments: t.added.map(label), target: t.target?.label }
        : { role: 'assistant', text: t.text, at: t.at, built: t.plan ? { title: t.plan.title, sections: t.plan.sections.length } : null, edited: t.edit ? true : undefined, fields: t.fields ? Object.keys(t.fields) : undefined },
    ),
  };
}

export const GET: APIRoute = async ({ url, locals }) => {
  const jobId = url.searchParams.get('job');
  if (jobId) {
    const { data: j } = await locals.db.from('compose_jobs').select('status, progress, say, notes, result, error, created_at, updated_at').eq('id', jobId).maybeSingle();
    if (!j) return new Response('No such job', { status: 404 });
    // A worker that was killed never writes an outcome: call it after its ceiling, or after silence.
    const now = Date.now();
    const dead = (j.status === 'queued' || j.status === 'running') && (now - Date.parse(j.created_at) > STALE_MS || now - Date.parse(j.updated_at) > SILENT_MS);
    const error = 'Claude stopped responding before finishing. Try again.';
    // Said in the row too, so a job reported failed is never claimed or finished later (runJob).
    if (dead)
      await locals.db
        .from('compose_jobs')
        .update({ status: 'error', error })
        .eq('id', jobId)
        .in('status', ['queued', 'running'])
        .or(`created_at.lt.${new Date(now - STALE_MS).toISOString()},updated_at.lt.${new Date(now - SILENT_MS).toISOString()}`);
    const out = dead ? { ...j, status: 'error', error } : j;
    return Response.json({ status: out.status, progress: out.progress, say: out.say, notes: out.notes, result: out.result, error: out.error }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const entryId = Number(url.searchParams.get('entryId')) || 0;
  const sessionId = url.searchParams.get('sessionId');
  let q = locals.db.from('compose_sessions').select('*');
  q = sessionId ? q.eq('id', sessionId) : q.eq('entry_id', entryId);
  const { data } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return Response.json(data ? view(data as Session) : null);
};

export const POST: APIRoute = async ({ request, locals }) => {
  const form = await request.formData();
  const db = locals.db;
  const message = String(form.get('message') ?? '').slice(0, 20_000);
  const docs = form.getAll('docs').filter((f): f is File => f instanceof File && f.size > 0).slice(0, 10);
  const mediaIds = form.getAll('media').map(Number).filter(Boolean).slice(0, 40);
  const links = String(form.get('links') ?? '').split(/\s+/).map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l)).slice(0, 20);
  if (!message.trim() && !docs.length && !mediaIds.length && !links.length) return new Response('Write a message or add some materials.', { status: 400 });
  const targetJson = String(form.get('targetJson') ?? '');
  // Cut short, the block couldn't be read back after Claude's (paid) answer; so it is refused whole.
  if (targetJson.length > 60_000) return new Response('That block is too large to change in one go. Select a smaller block inside it.', { status: 400 });
  const target = targetJson ? { id: String(form.get('targetId') ?? ''), label: String(form.get('targetLabel') ?? 'selected block').slice(0, 200), json: targetJson } : undefined;
  // A person runs a turn or two at once (two conversations); more is a script spending the API key.
  const { count: running } = await db.from('compose_jobs').select('id', { count: 'exact', head: true }).eq('author_id', locals.user.id).in('status', ['queued', 'running']).gte('updated_at', new Date(Date.now() - SILENT_MS).toISOString());
  if ((running ?? 0) >= 2) return new Response('You already have two Compose turns running. Wait for one to finish.', { status: 429 });

  // The session: continued, the page's latest, or new.
  const sessionId = String(form.get('sessionId') ?? '');
  const entryId = Number(form.get('entryId')) || 0;
  let session: Session | null = null;
  if (sessionId) session = (await db.from('compose_sessions').select('*').eq('id', sessionId).maybeSingle()).data as Session | null;
  if (!session) {
    const { data, error } = await db
      .from('compose_sessions')
      .insert({ entry_id: entryId || null, entry_type: COMPOSABLE_TYPES.some((c) => c.type === form.get('type')) ? String(form.get('type')) : 'page', author_id: locals.user.id, materials: emptyRegistry() })
      .select('*')
      .single();
    if (error) return new Response(error.message, { status: 400 });
    session = data as Session;
  }
  const s = session;
  // One turn at a time per conversation (both would rewrite the same turns). The job is reserved
  // before the message is added: the database allows one active job per conversation
  // (compose_jobs_one_active), so a second submit is refused here instead of racing the first.
  // Jobs that stopped reporting are retired first.
  const now = Date.now();
  await db
    .from('compose_jobs')
    .update({ status: 'error', error: 'Stopped: no progress.' })
    .eq('session_id', s.id)
    .in('status', ['queued', 'running'])
    .or(`created_at.lt.${new Date(now - STALE_MS).toISOString()},updated_at.lt.${new Date(now - SILENT_MS).toISOString()}`);
  let job: { id: string; token: string };
  try {
    job = await queueJob(db, s.id, locals.user.id, {});
  } catch (e: any) {
    if (e?.code === '23505') return Response.json({ error: 'Claude is still working on the last message in this conversation.' }, { status: 409 });
    throw e;
  }
  const current = String(form.get('current') ?? '').slice(0, 30_000);
  const other = String(form.get('other') ?? '').slice(0, 20_000);
  let liveFields: EditorFields | null = null;
  try {
    liveFields = form.get('entryFields') ? JSON.parse(String(form.get('entryFields'))) : null;
  } catch {}

  // Materials are read here (uploads, link text), so the job only needs the session.
  let notes: string[] = [];
  try {
    const { added, notes: n } = await ingest(serviceClient(), s.id, s.materials, { docs, mediaIds, links });
    notes = n;
    s.turns.push({ role: 'user', text: message, added, ...(target ? { target } : {}), at: new Date().toISOString() });
    await db.from('compose_sessions').update({ turns: s.turns, materials: s.materials }).eq('id', s.id);
  } catch (e) {
    // Free the conversation for the next message.
    await db.from('compose_jobs').update({ status: 'error', error: (e as Error).message ?? String(e) }).eq('id', job.id);
    return Response.json({ error: (e as Error).message ?? String(e), sessionId: s.id }, { status: 400 });
  }
  const input: JobInput = { current: current || undefined, other: other || undefined, liveFields };
  await db.from('compose_jobs').update({ input }).eq('id', job.id);

  // The jobs queue runs it (src/lib/jobs.ts), with up to 15 minutes; without one it runs after this
  // answer. The browser polls either way.
  const queued = await enqueue({ kind: 'compose', jobId: job.id, token: job.token }).catch((e: Error) => (console.warn(`[compose] couldn't queue the job (${e.message}); running it here`), false));
  if (!queued) afterAnswer(runJob(job.id, job.token));
  return Response.json({ jobId: job.id, sessionId: s.id, prefix: s.block_prefix, notes }, { status: 202 });
};
