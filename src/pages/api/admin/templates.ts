import type { APIRoute } from 'astro';
import { duplicateTemplate, entryFromTemplate } from '../../../lib/admin/duplicate';
import { uniqueAreas } from '../../../lib/content/areas';
import { slugify } from '../../../lib/slug';
import { isStale, STALE } from '../../../lib/admin/save';
import { renameTemplate } from '../../../lib/admin/rename-template';
import { serviceClient } from '../../../lib/db/site';
import { deleteTemplate, restoreTemplate, templateUses, trashTemplate } from '../../../lib/admin/template-trash';

/**
 * Duplicate a template, part or pattern (form post { kind, slug } from the list), then open the copy; with
 * action=make-page { type, title, keep }, make a draft entry of its blocks and open that; with
 * action=restore or delete, take it out of the trash or delete it for good.
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  // JSON from the editor and the templates list.
  if (request.headers.get('content-type')?.includes('application/json')) {
    const body = await request.json().catch(() => ({}));
    // Rename: { action: 'rename', kind, slug, title, newSlug? } -> { title, slug, updated, failed }. The
    // server's access writes the new address where the site names the old one (Settings > Types too).
    if (body.action === 'rename') {
      if (!['template', 'part', 'pattern'].includes(body.kind) || !body.slug) return new Response('Bad request', { status: 400 });
      try {
        return Response.json(await renameTemplate(locals.db, body.kind, String(body.slug), { title: String(body.title ?? ''), slug: typeof body.newSlug === 'string' ? body.newSlug : undefined }, serviceClient()));
      } catch (e) {
        return new Response((e as Error).message, { status: 400 });
      }
    }
    // What uses it, before it goes to the trash: { action: 'uses', kind, slug } -> TemplateUses; then
    // { action: 'trash', kind, slug }.
    if (body.action === 'uses' || body.action === 'trash') {
      if (!['template', 'part', 'pattern'].includes(body.kind) || !body.slug) return new Response('Bad request', { status: 400 });
      try {
        if (body.action === 'uses') return Response.json(await templateUses(locals.db, body.kind, String(body.slug)));
        await trashTemplate(locals.db, body.kind, String(body.slug));
        return Response.json({ ok: true });
      } catch (e) {
        return new Response((e as Error).message, { status: 400 });
      }
    }
    // Save as pattern: { action: 'create-pattern', title, linked, content } -> { slug }.
    const title = String(body.title ?? '').trim().slice(0, 120);
    if (body.action !== 'create-pattern' || !title || !Array.isArray(body.content) || !body.content.length) return new Response('Bad request', { status: 400 });
    const base = slugify(title) || 'pattern';
    const { data: same } = await locals.db.from('templates').select('slug').eq('kind', 'pattern').like('slug', `${base}%`);
    const used = new Set((same ?? []).map((r) => r.slug));
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    const content = { root: { props: body.linked ? { linked: true } : {} }, content: body.content, zones: {} };
    const { error } = await locals.db.from('templates').insert({ kind: 'pattern', slug, title, content });
    if (error) return new Response(error.message, { status: 400 });
    return Response.json({ slug });
  }
  const form = await request.formData();
  const kind = String(form.get('kind') ?? '');
  const slug = String(form.get('slug') ?? '');
  if (!['template', 'part', 'pattern'].includes(kind) || !slug) return new Response('Bad request', { status: 400 });
  // From the list's Trash: Restore, or Delete permanently.
  if (form.get('action') === 'restore' || form.get('action') === 'delete') {
    try {
      await (form.get('action') === 'restore' ? restoreTemplate : deleteTemplate)(locals.db, kind as 'template', slug);
      return redirect(form.get('action') === 'restore' ? '/admin/templates/' : '/admin/templates/#trash', 303);
    } catch (e) {
      return new Response((e as Error).message, { status: 400 });
    }
  }
  if (form.get('action') === 'make-page') {
    try {
      const id = await entryFromTemplate(locals.db, kind, slug, String(form.get('type') ?? ''), String(form.get('title') ?? ''), form.get('keep') !== 'on');
      return redirect(`/admin/edit/${id}/`, 303);
    } catch (e) {
      return new Response((e as Error).message, { status: 400 });
    }
  }
  try {
    return redirect(`/admin/templates/${kind}/${await duplicateTemplate(locals.db, kind, slug)}/`, 303);
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const { kind, slug, content, base } = await request.json();
  if (!['template', 'part', 'pattern'].includes(kind) || !slug) return new Response('Bad request', { status: 400 });
  if (isStale(base, (await locals.db.from('templates').select('updated_at').eq('kind', kind).eq('slug', slug).maybeSingle()).data?.updated_at)) return new Response(STALE, { status: 409 });
  // A pattern stays linked (or not) through edits that don't say otherwise.
  if (kind === 'pattern' && content?.root && !('linked' in (content.root.props ?? {}))) {
    const { data: was } = await locals.db.from('templates').select('content').eq('kind', kind).eq('slug', slug).maybeSingle();
    if ((was?.content as any)?.root?.props?.linked) content.root = { ...content.root, props: { ...(content.root.props ?? {}), linked: true } };
  }
  // Each Page content block shows its own area (a repeat gets the next free name).
  if (Array.isArray(content?.content)) content.content = uniqueAreas(content.content);
  const { data, error } = await locals.db.from('templates').update({ content }).eq('kind', kind).eq('slug', slug).select('updated_at').maybeSingle();
  if (error) return new Response(error.message, { status: 400 });
  // Gone, or renamed since the editor opened it: nothing was saved.
  if (!data) return new Response('This template is no longer at this address (it may have been renamed). Copy your changes, then open it again from Templates.', { status: 404 });
  return Response.json({ ok: true, updated_at: data?.updated_at });
};
