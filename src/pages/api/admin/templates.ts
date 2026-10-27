import type { APIRoute } from 'astro';
import { duplicateTemplate, entryFromTemplate } from '../../../lib/admin/duplicate';
import { uniqueAreas } from '../../../lib/content/areas';
import { slugify } from '../../../lib/slug';
import { isStale, STALE } from '../../../lib/admin/save';

/**
 * Duplicate a template, part or pattern (form post { kind, slug } from the list), then open the copy; or,
 * with action=make-page { type, title, keep }, make a draft entry of its blocks and open that.
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  // Save as pattern (JSON from the editor): { action: 'create-pattern', title, linked, content } -> { slug }.
  if (request.headers.get('content-type')?.includes('application/json')) {
    const body = await request.json().catch(() => ({}));
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
  return Response.json({ ok: true, updated_at: data?.updated_at });
};
