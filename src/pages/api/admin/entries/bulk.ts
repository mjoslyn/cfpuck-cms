import type { APIRoute } from 'astro';
import { addressTakenBy, uniqueSlug } from '../../../../lib/admin/save';
import { isPlaceholderSlug, slugify } from '../../../../lib/slug';
import { publishNeedsCheck } from '../../../../lib/a11y-gate';

/**
 * Bulk actions from the content list (form post { ids[], action, back }): publish, draft (unpublish),
 * trash, restore (from the trash, as a draft) and delete (permanently; only entries in the trash);
 * add-term and remove-term ({ term }: a term of any taxonomy, on the entries at once, published ones
 * included; a tag also goes into or out of unpublished changes kept aside, so publishing them keeps it).
 * Unpublished changes kept aside stay as they are. Untitled entries, and those whose address another
 * type's entry at the same URL has, can't be published, nor (with Settings > Accessibility's gate on)
 * entries with a page, which the editor publishes after its accessibility check; the home page can't be trashed. Goes back to the list with a note of what happened.
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const db = locals.db;
  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const ids = [...new Set(form.getAll('ids').map(Number).filter((n) => n > 0))];
  const back = new URL(String(form.get('back') || '/admin/'), 'http://x');
  const done = (notice: string) => {
    back.searchParams.set('notice', notice);
    return redirect(`/admin/${back.search}`, 303);
  };
  if (!['publish', 'draft', 'trash', 'restore', 'delete', 'add-term', 'remove-term'].includes(action)) return done('Choose an action.');
  if (!ids.length) return done('Select entries first.');

  if (action === 'add-term' || action === 'remove-term') {
    const termId = Number(form.get('term')) || 0;
    const { data: term } = await db.from('terms').select('id, name, taxonomy').eq('id', termId).maybeSingle();
    if (!term) return done('Choose a term.');
    const { data: has, error: hasErr } = await db.from('entry_terms').select('entry_id').eq('term_id', term.id).in('entry_id', ids);
    if (hasErr) return new Response(hasErr.message, { status: 400 });
    const already = new Set((has ?? []).map((r) => r.entry_id));
    const adding = action === 'add-term';
    const affected = ids.filter((id) => (adding ? !already.has(id) : already.has(id)));
    if (affected.length) {
      const { error: e } = adding
        ? await db.from('entry_terms').insert(affected.map((entry_id) => ({ entry_id, term_id: term.id, sort: 0 })))
        : await db.from('entry_terms').delete().eq('term_id', term.id).in('entry_id', affected);
      if (e) return new Response(e.message, { status: 400 });
    }
    const touched = new Set(affected);
    // Tags also live in unpublished changes kept aside (publishing them sets the tags): keep those in step.
    if (term.taxonomy === 'tag') {
      const { data: drafts } = await db.from('entry_drafts').select('entry_id, draft').in('entry_id', ids);
      for (const d of drafts ?? []) {
        const entry = (d.draft as any)?.entry;
        if (!entry || !Array.isArray(entry.tags)) continue;
        const tags: string[] = entry.tags.map(String);
        const next = adding ? (tags.some((t) => t.toLowerCase() === term.name.toLowerCase()) ? tags : [...tags, term.name]) : tags.filter((t) => t.toLowerCase() !== term.name.toLowerCase());
        if (next.length === tags.length && adding === tags.includes(term.name)) continue;
        const { error: e } = await db.from('entry_drafts').update({ draft: { ...(d.draft as any), entry: { ...entry, tags: next } } }).eq('entry_id', d.entry_id);
        if (e) return new Response(e.message, { status: 400 });
        touched.add(d.entry_id);
      }
    }
    // A new version of each entry changed, so an editor with one open is asked before a save puts its terms back.
    if (touched.size) {
      const { error: e } = await db.from('entries').update({ updated_at: new Date().toISOString() }).in('id', [...touched]);
      if (e) return new Response(e.message, { status: 400 });
    }
    const n = affected.length;
    const already2 = ids.length - n;
    return done(`${adding ? 'Added' : 'Removed'} "${term.name}" ${adding ? 'to' : 'from'} ${n} ${n === 1 ? 'entry' : 'entries'}.${already2 ? ` ${already2} ${adding ? 'already had it' : 'didn’t have it'}.` : ''}`);
  }

  const { data: rows, error } = await db.from('entries').select('id, type, slug, title, status').in('id', ids);
  if (error) return new Response(error.message, { status: 400 });
  const { data: site } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  const frontId = (site?.value as { front_page_id?: number } | null)?.front_page_id;
  const skipped: string[] = [];
  let changed = 0;

  for (const r of rows ?? []) {
    const name = r.title || 'An untitled entry';
    if (action === 'delete') {
      if (r.status !== 'trash') continue;
      const { error: e } = await db.from('entries').delete().eq('id', r.id);
      if (e) return new Response(e.message, { status: 400 });
      changed++;
      continue;
    }
    if (action === 'trash' && r.id === frontId) {
      skipped.push(`${name} is the home page`);
      continue;
    }
    const status = action === 'publish' ? 'publish' : action === 'trash' ? 'trash' : 'draft';
    if (action === 'restore' && r.status !== 'trash') continue;
    if (r.status === status) continue;
    const patch: Record<string, unknown> = { status };
    if (status === 'publish' && isPlaceholderSlug(r.slug, r.type)) {
      // Never publish at the "New ..." placeholder address: the title makes it.
      if (!r.title?.trim()) {
        skipped.push(`${name} has no title`);
        continue;
      }
      patch.slug = await uniqueSlug(db, r.type, slugify(r.title) || 'untitled', r.id);
    }
    if (status === 'publish' && publishNeedsCheck(site?.value as Record<string, unknown> | null, r.type)) {
      skipped.push(`${name}: publish it from the editor, where the accessibility check runs first`);
      continue;
    }
    if (status === 'publish') {
      const slug = String(patch.slug ?? r.slug);
      const holder = await addressTakenBy(db, r.type, slug, r.id);
      if (holder) {
        skipped.push(`${name}: the address “${slug}” is used by ${holder}`);
        continue;
      }
    }
    const { error: e } = await db.from('entries').update(patch).eq('id', r.id);
    if (e) return new Response(e.message, { status: 400 });
    changed++;
  }

  const verb = { publish: 'Published', draft: 'Moved to drafts', trash: 'Moved to the trash', restore: 'Restored', delete: 'Deleted' }[action];
  const what = `${changed} ${changed === 1 ? 'entry' : 'entries'}`;
  return done(`${verb}: ${what}.${skipped.length ? ` Skipped: ${skipped.join('; ')}.` : ''}`);
};
