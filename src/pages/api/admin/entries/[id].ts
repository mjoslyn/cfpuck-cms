import type { APIRoute } from 'astro';
import { eventDates, mediaIdForUrl, renderedExcerpt, renderedTitle, setEntryTerms, setEntryTags, uniqueSlug, isStale, STALE } from '../../../../lib/admin/save';
import { isPlaceholderSlug, slugify } from '../../../../lib/slug';
import { Loader } from '../../../../lib/data';
import { permalink } from '../../../../lib/permalink';
import { redirectMovedEntry } from '../../../../lib/redirects';
import { siteDb } from '../../../../lib/db/site';
import { uniqueAreas } from '../../../../lib/content/areas';
import { taxonomiesOf, typeLabel, typesSharingAddresses } from '../../../../lib/site';

/**
 * Save an entry. Body: { action, content?, entry?, template? }.
 * - draft: on a published entry, keep the changes aside (entry_drafts) and leave the live page as it
 *   is; on an unpublished one, save in place as a draft.
 * - publish: save and make it live (pending draft changes are applied and cleared).
 * - unpublish: take it off the site (pending changes are applied first; drafts have no separate copy).
 * - discard: drop pending draft changes.
 * - save (default): save in place with the status in `entry` (venue forms, template layout mode).
 */
/**
 * The slug to store: the one given, cleaned; but while it is the "New ..." placeholder, or empty, one
 * made from the title (unique within the type), so a page never goes live at /new-page-m1ab2c/.
 */
async function entrySlug(db: any, current: { id: number; type: string; slug: string }, e: { slug?: string; title?: string }): Promise<string> {
  const given = slugify(String(e.slug ?? ''));
  if (!isPlaceholderSlug(given, current.type)) return given;
  const fromTitle = slugify(String(e.title ?? ''));
  if (fromTitle) return uniqueSlug(db, current.type, fromTitle, current.id);
  return given || current.slug;
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const db = locals.db;
  const id = Number(params.id);
  const body = await request.json();
  const action: string = body.action ?? 'save';
  // Set when this save keeps an earlier version the editor restored.
  const restored = Number(body.restoredFrom) > 0 ? { restored_from: Number(body.restoredFrom), restored_edited: !!body.restoredEdited } : {};
  const { data: current, error: readErr } = await db.from('entries').select('id, type, slug, title, status, content, fields, excerpt, updated_at').eq('id', id).single();
  if (readErr) return new Response(readErr.message, { status: 404 });
  // Two editors on one page: the second to save is told, instead of silently replacing the first's work.
  // shortcut: checked at read, not in the update itself; two saves within the same moment can still cross.
  if (isStale(body.base, current.updated_at)) return new Response(STALE, { status: 409 });
  if (body.template && isStale(body.templateBase, (await db.from('templates').select('updated_at').eq('kind', body.template.kind).eq('slug', body.template.slug).maybeSingle()).data?.updated_at)) return new Response(STALE, { status: 409 });
  const stamp = async () => (await db.from('entries').select('updated_at').eq('id', id).single()).data?.updated_at;
  const { data: kept, error: draftErr } = await db.from('entry_drafts').select('draft').eq('entry_id', id).maybeSingle();
  if (draftErr) return new Response(draftErr.message, { status: 400 });
  const pending = (kept?.draft ?? null) as { content?: any; entry?: any } | null;

  if (action === 'discard') {
    const { error } = await db.from('entry_drafts').delete().eq('entry_id', id).then((r) => (r.error ? r : db.from('entries').update({ draft_saved_at: null }).eq('id', id)));
    return error ? new Response(error.message, { status: 400 }) : Response.json({ ok: true, status: current.status, pending: false, updated_at: await stamp() });
  }

  // Changes aside, while the published page stays live.
  if (action === 'draft' && current.status === 'publish') {
    const draft = { content: body.content ?? pending?.content ?? current.content, entry: body.entry ?? pending?.entry ?? null };
    const { error } = await db.from('entry_drafts').upsert({ entry_id: id, draft }).then((r) => (r.error ? r : db.from('entries').update({ draft_saved_at: new Date().toISOString() }).eq('id', id)));
    if (error) return new Response(error.message, { status: 400 });
    await db.from('revisions').insert({ entry_id: id, title: body.entry?.title ?? current.title, content: draft.content, fields: body.entry?.fields ?? current.fields, entry: draft.entry, action: 'draft', author_id: locals.user.id, ...restored });
    return Response.json({ ok: true, status: 'publish', pending: true, updated_at: await stamp() });
  }

  // Everything else writes the entry itself. Unpublish without new content applies pending changes.
  const e = body.entry ?? (action === 'unpublish' ? pending?.entry : undefined) ?? {};
  const newContent = body.content ?? (action === 'unpublish' || action === 'publish' ? pending?.content : undefined);
  const content = newContent ?? current.content;
  const status = action === 'publish' ? 'publish' : action === 'unpublish' || action === 'draft' ? 'draft' : e.status ?? current.status;
  const patch: Record<string, any> = { status, draft_saved_at: null };
  if (newContent) patch.content = newContent;
  if (Object.keys(e).length) {
    Object.assign(patch, {
      title: e.title,
      title_rendered: renderedTitle(e.title ?? ''),
      slug: await entrySlug(db, current, e),
      excerpt: e.excerpt ?? '',
      excerpt_rendered: renderedExcerpt(e.excerpt ?? '', content?.content),
      template: e.template || null,
      fields: e.fields ?? {},
      featured_media_id: await mediaIdForUrl(db, e.featured_image),
    });
    if (current.type === 'event') Object.assign(patch, eventDates(e, patch.fields));
  }
  // A typed address another type already has at the same URL (a page and a post both live at /<slug>/).
  const others = typesSharingAddresses(current.type).filter((t) => t !== current.type);
  if (patch.slug && patch.slug !== current.slug && others.length) {
    const { data: clash } = await db.from('entries').select('type, title').in('type', others).eq('slug', patch.slug).limit(1).maybeSingle();
    if (clash) return new Response(`The address “${patch.slug}” is used by the ${typeLabel(clash.type).toLowerCase()} “${clash.title}”. Choose another.`, { status: 400 });
  }
  // A published entry's address before the save, for a redirect if it changes.
  const wasLive = current.status === 'publish' ? await new Loader(db).entryById(id, false) : null;
  const { error } = await db.from('entries').update(patch).eq('id', id);
  if (error) return new Response(error.message, { status: 400 });
  if (pending) {
    const { error: dropErr } = await db.from('entry_drafts').delete().eq('entry_id', id);
    if (dropErr) return new Response(dropErr.message, { status: 400 });
  }
  if (wasLive && status === 'publish') {
    const now = await new Loader(db).entryById(id, false);
    // As the server: redirects are admins' to write, and this one follows from an edit the editor may make.
    if (now && permalink(now) !== permalink(wasLive)) await redirectMovedEntry(siteDb(), permalink(wasLive), permalink(now));
  }
  if (Array.isArray(e.tags)) {
    try {
      await setEntryTags(db, id, e.tags.map(String));
    } catch (err: any) {
      return new Response(err.message ?? String(err), { status: 400 });
    }
  }
  // The type's other taxonomies, as chosen in the entry's settings.
  if (e.terms && typeof e.terms === 'object') {
    try {
      for (const tax of taxonomiesOf(current.type)) if (Array.isArray(e.terms[tax])) await setEntryTerms(db, id, tax, e.terms[tax]);
    } catch (err: any) {
      return new Response(err.message ?? String(err), { status: 400 });
    }
  }

  let templateUpdatedAt: string | undefined;
  if (body.template) {
    if (Array.isArray(body.template.content?.content)) body.template.content.content = uniqueAreas(body.template.content.content);
    const { data: tpl, error: tErr } = await db.from('templates').update({ content: body.template.content }).eq('kind', body.template.kind).eq('slug', body.template.slug).select('updated_at').maybeSingle();
    if (tErr) return new Response(tErr.message, { status: 400 });
    templateUpdatedAt = tpl?.updated_at;
  }
  const { error: revErr } = await db.from('revisions').insert({ entry_id: id, title: patch.title ?? current.title, content: patch.content ?? current.content, fields: patch.fields ?? current.fields, entry: Object.keys(e).length ? e : null, action, author_id: locals.user.id, ...restored });
  // The entry is saved either way; a version that couldn't be kept is said, not hidden.
  if (revErr) console.error(`entry ${id}: revision not saved: ${revErr.message}`);
  return Response.json({ ok: true, status, pending: false, ...(patch.slug ? { slug: patch.slug } : {}), updated_at: await stamp(), templateUpdatedAt, ...(revErr ? { warning: 'Saved, but this version could not be added to the history.' } : {}) });
};
