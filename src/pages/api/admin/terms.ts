import type { APIRoute } from 'astro';
import { isFlat, isTaxonomy, TAXONOMY_BASES } from '../../../lib/site';
import { slugify } from '../../../lib/slug';
import { termLink } from '../../../lib/permalink';
import { redirectMovedEntry } from '../../../lib/redirects';
import { siteDb } from '../../../lib/db/site';
import { termFieldsFor } from '../../../lib/page-meta';

/**
 * Manage a taxonomy's terms from Content > Taxonomies (form posts, back to the taxonomy's tab):
 * action=create (name, slug?, parent?), update (id, name, slug, template; parent if sent), move (id,
 * and parent, or empty for the top level; or before / after: a term it goes beside, under the same
 * parent, numbering that level's order), template (ids[],
 * template: one template for several terms), delete (id). A term's template (fields.template) is the
 * one its term page uses, shared by the terms under it; empty clears it. Tags are flat;
 * other taxonomies nest. A term whose address changes leaves a redirect from its old term page;
 * deleting a term moves its children up to its parent, and entries lose it (entry_terms cascade).
 * GET and PUT (JSON, below) read and save one term's details: description, featured image, SEO, fields.
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const db = locals.db;
  const form = await request.formData();
  const taxonomy = String(form.get('taxonomy') ?? '');
  const action = String(form.get('action') ?? '');
  const id = Number(form.get('id')) || 0;
  const back = (key: 'error' | 'notice', msg: string) => redirect(`/admin/?type=terms&taxonomy=${encodeURIComponent(taxonomy)}&${key}=${encodeURIComponent(msg)}`, 303);
  if (!isTaxonomy(taxonomy)) return redirect('/admin/?type=terms', 303);
  const flat = isFlat(taxonomy);

  const { data: all, error: readErr } = await db.from('terms').select('id, name, slug, parent_id, fields, sort').eq('taxonomy', taxonomy);
  if (readErr) return back('error', readErr.message);
  const terms = all ?? [];
  const term = terms.find((t) => t.id === id);

  if (action === 'delete') {
    if (!term) return back('error', 'That term no longer exists.');
    const { error: upErr } = await db.from('terms').update({ parent_id: term.parent_id }).eq('parent_id', id);
    if (upErr) return back('error', upErr.message);
    const { error } = await db.from('terms').delete().eq('id', id).eq('taxonomy', taxonomy);
    return error ? back('error', error.message) : back('notice', `Deleted "${term.name}".`);
  }
  // A template's slug, or '' for none.
  const templateOf = (v: FormDataEntryValue | null) => (typeof v === 'string' && /^[a-z0-9][a-z0-9_/-]*$/.test(v) ? v : '');
  const withTemplate = (fields: Record<string, any> | null, slug: string) => {
    const next = { ...(fields ?? {}) };
    if (slug) next.template = slug;
    else delete next.template;
    return next;
  };
  if (action === 'template') {
    const ids = form.getAll('ids').map(Number).filter((n) => terms.some((t) => t.id === n));
    if (!ids.length) return back('error', 'Tick the terms to set a template for.');
    const slug = templateOf(form.get('template'));
    for (const t of terms.filter((x) => ids.includes(x.id))) {
      const { error } = await db.from('terms').update({ fields: withTemplate(t.fields, slug) }).eq('id', t.id);
      if (error) return back('error', error.message);
    }
    return back('notice', `${slug ? `Set the template ${slug} for` : 'Cleared the template of'} ${ids.length} ${ids.length === 1 ? 'term' : 'terms'}.`);
  }
  if (action === 'move') {
    if (!term) return back('error', 'That term no longer exists.');
    // Beside a term (before or after it, under its parent), or under a parent (at the end).
    const besideId = Number(form.get('before') || form.get('after')) || 0;
    const beside = terms.find((t) => t.id === besideId);
    if (besideId && (!beside || besideId === id)) return back('error', 'That term no longer exists.');
    const to = flat ? null : beside ? beside.parent_id : Number(form.get('parent')) || null;
    if (to && !terms.some((t) => t.id === to)) return back('error', 'That term no longer exists.');
    for (let p = to; p; p = terms.find((t) => t.id === p)?.parent_id ?? null) {
      if (p === id) return back('error', 'A term cannot sit under itself or one of its own children.');
    }
    // That level's order, with the term placed, numbered from 0.
    const level = terms
      .filter((t) => (t.parent_id ?? null) === to && t.id !== id)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
    const at = beside ? level.findIndex((t) => t.id === beside.id) + (form.get('after') ? 1 : 0) : level.length;
    level.splice(at, 0, term);
    for (const [i, t] of level.entries()) {
      const patch = t.id === id ? { parent_id: to, sort: i } : { sort: i };
      if (t.id !== id && (t.sort ?? 0) === i) continue;
      const { error } = await db.from('terms').update(patch).eq('id', t.id).eq('taxonomy', taxonomy);
      if (error) return back('error', error.message);
    }
    const where = beside ? `${form.get('after') ? 'after' : 'before'} "${beside.name}"` : to ? `under "${terms.find((t) => t.id === to)!.name}"` : 'to the top level';
    return back('notice', `Moved "${term.name}" ${where}.`);
  }
  if (action !== 'create' && action !== 'update') return back('error', 'Unknown action.');
  if (action === 'update' && !term) return back('error', 'That term no longer exists.');

  const name = String(form.get('name') ?? '').trim().slice(0, 100);
  if (!name) return back('error', 'Enter a name.');
  const slug = slugify(String(form.get('slug') ?? '').trim() || name);
  if (!slug) return back('error', 'Enter an address made of letters or numbers.');
  if (terms.some((t) => t.slug === slug && t.id !== id)) return back('error', `Another term already uses the address "${slug}".`);

  // A parent of the same taxonomy, never the term itself or one of its own children. Updates that
  // don't send one keep the term where it is.
  let parent = flat ? null : form.has('parent') || action !== 'update' ? Number(form.get('parent')) || null : (term?.parent_id ?? null);
  if (parent && !terms.some((t) => t.id === parent)) parent = null;
  for (let p = parent; p; p = terms.find((t) => t.id === p)?.parent_id ?? null) {
    if (p === id) return back('error', 'A term cannot sit under itself or one of its own children.');
  }

  if (action === 'create') {
    const { error } = await db.from('terms').insert({ taxonomy, name, slug, parent_id: parent, description: '', fields: {} });
    return error ? back('error', error.message) : back('notice', `Added "${name}".`);
  }
  const fields = form.has('template') ? withTemplate(term!.fields, templateOf(form.get('template'))) : term!.fields;
  const { error } = await db.from('terms').update({ name, slug, parent_id: parent, fields }).eq('id', id).eq('taxonomy', taxonomy);
  if (error) return back('error', error.message);
  // The term page moved with its address: the old one redirects (as the server, since redirects are admins').
  if (term!.slug !== slug && TAXONOMY_BASES[taxonomy]) await redirectMovedEntry(siteDb(), termLink({ taxonomy, slug: term!.slug }), termLink({ taxonomy, slug }));
  return back('notice', `Saved "${name}".`);
};

/** One term's details, for the details dialog: GET ?id=. */
export const GET: APIRoute = async ({ url, locals }) => {
  const { data, error } = await locals.db.from('terms').select('id, taxonomy, name, slug, description, fields').eq('id', Number(url.searchParams.get('id'))).maybeSingle();
  if (error) return new Response(error.message, { status: 400 });
  if (!data) return new Response('That term no longer exists.', { status: 404 });
  return Response.json({ ...data, link: TAXONOMY_BASES[data.taxonomy] ? termLink(data as any) : null });
};

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const mediaId = (v: unknown) => (Number(v) > 0 ? Number(v) : undefined);

/**
 * Save a term's details (JSON): PUT { id, taxonomy, description, image, image_url, seo, fields }.
 * The featured image and SEO go in terms.fields (`image`, `image_url`, `seo`), the taxonomy's own fields
 * under their keys; its template and any other stored keys are kept.
 */
export const PUT: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const taxonomy = String(body.taxonomy ?? '');
  if (!isTaxonomy(taxonomy)) return new Response('Unknown taxonomy.', { status: 400 });
  const { data: term, error: readErr } = await locals.db.from('terms').select('id, fields').eq('id', Number(body.id)).eq('taxonomy', taxonomy).maybeSingle();
  if (readErr) return new Response(readErr.message, { status: 400 });
  if (!term) return new Response('That term no longer exists.', { status: 404 });
  const fields: Record<string, any> = { ...(term.fields ?? {}) };
  const image = mediaId(body.image);
  if (image) Object.assign(fields, { image, image_url: text(body.image_url, 2000) });
  else delete fields.image, delete fields.image_url;
  const s = body.seo && typeof body.seo === 'object' ? body.seo : {};
  const seo = Object.fromEntries(
    Object.entries({ title: text(s.title, 300), description: text(s.description, 1000), image: mediaId(s.image), image_url: mediaId(s.image) ? text(s.image_url, 2000) : '', noindex: s.noindex === true || undefined }).filter(([, v]) => v),
  );
  if (Object.keys(seo).length) fields.seo = seo;
  else delete fields.seo;
  for (const f of termFieldsFor(taxonomy)) {
    const v = body.fields?.[f.key];
    if (v === undefined || v === null || v === '') delete fields[f.key];
    else fields[f.key] = v;
  }
  const { error } = await locals.db.from('terms').update({ description: text(body.description, 5000), fields }).eq('id', term.id);
  if (error) return new Response(error.message, { status: 400 });
  return Response.json({ ok: true, fields });
};
