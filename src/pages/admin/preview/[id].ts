// Preview a page as it will look, for signed-in editors (the /admin middleware applies).
// GET: the saved version (unpublished changes of a live page included); ?revision=<id>: that revision.
// POST (form field `payload`: { content, entry, template? }): the editor's current, unsaved state.
import type { APIRoute } from 'astro';
import { SITE_TZ } from '../../../lib/site';
import { Loader } from '../../../lib/data';
import { permalink } from '../../../lib/permalink';
import { renderRequest } from '../../../render/page';
import { eventDates, mediaIdForUrl, renderedExcerpt, renderedTitle } from '../../../lib/admin/save';
import type { Entry } from '../../../lib/types';
import type { PuckItem } from '../../../lib/puck/types';


async function render(db: any, id: number, origin: string, override?: { content?: any; entry?: any; template?: PuckItem[] }, what?: string) {
  const loader = new Loader(db);
  const settings = await loader.settings();
  const base = await loader.entryById(id, true);
  if (!base) return new Response('Not found', { status: 404 });
  const { data: d } = await db.from('entry_drafts').select('draft').eq('entry_id', id).maybeSingle();
  const e: Entry = { ...base };
  const content = override?.content ?? d?.draft?.content;
  const form = override?.entry ?? d?.draft?.entry;
  if (content) e.content = content;
  if (form) {
    Object.assign(e, {
      title: form.title ?? e.title,
      title_rendered: renderedTitle(form.title ?? e.title),
      excerpt: form.excerpt ?? e.excerpt,
      excerpt_rendered: renderedExcerpt(form.excerpt ?? '', e.content?.content as PuckItem[]),
      template: form.template ?? e.template,
      fields: form.fields ?? e.fields,
      featured_media_id: form.featured_image !== undefined ? await mediaIdForUrl(db, form.featured_image) : e.featured_media_id,
    });
    if (e.type === 'event' && form.event_start) Object.assign(e, eventDates(form, e.fields));
  }
  const path = settings.site?.front_page_id === e.id ? '/' : permalink(e);
  // Shown as an editor sees the site: members-only pages and blocks included.
  const viewer = { id: '', email: '', name: '', editor: true, member: null };
  const { status, html } = await renderRequest(new URL(path, origin), db, undefined, { entry: e, template: override?.template }, viewer);
  const live = base.status === 'publish';
  const bar =
    `<div style="position:sticky;top:0;z-index:100000;display:flex;gap:1rem;align-items:center;justify-content:center;padding:.5rem 1rem;background:#b87333;color:#fff;font:600 13px/1.4 system-ui,sans-serif">` +
    `<span>Preview${what ? ` of ${what}` : override ? ' of unsaved changes' : d?.draft ? ' of unpublished changes' : ''}: ${live ? 'the live page is unchanged until you publish' : 'this page is not published'}</span>` +
    `<a href="/admin/edit/${e.id}/" style="color:#fff;text-decoration:underline">Back to the editor</a></div>`;
  const out = html
    .replace('<head>', '<head>\n\t<meta name="robots" content="noindex, nofollow" />')
    .replace(/<title>/, '<title>Preview · ')
    .replace(/(<body[^>]*>)/, `$1\n${bar}`);
  return new Response(out, { status: status === 404 ? 200 : status, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

export const GET: APIRoute = async ({ params, locals, url }) => {
  const revisionId = Number(url.searchParams.get('revision')) || 0;
  if (!revisionId) return render(locals.db, Number(params.id), url.origin);
  const { data: rev } = await locals.db.from('revisions').select('entry_id, title, content, fields, entry, created_at, saved_at').eq('id', revisionId).single();
  if (!rev || rev.entry_id !== Number(params.id)) return new Response('Revision not found', { status: 404 });
  const entry = rev.entry ?? { title: rev.title, fields: rev.fields };
  return render(locals.db, Number(params.id), url.origin, { content: rev.content, entry }, `the version saved ${new Date(rev.saved_at ?? rev.created_at).toLocaleString('en-US', { timeZone: SITE_TZ, dateStyle: 'medium', timeStyle: 'short' })}`);
};

export const POST: APIRoute = async ({ params, locals, request, url }) => {
  const form = await request.formData();
  let payload: any = {};
  try {
    payload = JSON.parse(String(form.get('payload') ?? '{}'));
  } catch {
    return new Response('Bad preview data', { status: 400 });
  }
  return render(locals.db, Number(params.id), url.origin, { content: payload.content, entry: payload.entry, template: Array.isArray(payload.template) ? payload.template : undefined });
};

