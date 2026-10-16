// Mailing lists (admins; see the middleware). Form posts, back to /admin/mailing-lists/?tab=lists:
// add (name, description, public), update (id, name, description, public, sort), remove (id: its
// members leave the list, their other lists stay). Subscribe blocks name lists, so these clear the page cache.
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (locals.user?.role !== 'admin') return new Response('Admins only', { status: 403 });
  const form = await request.formData();
  const back = (msg: string, ok = false) => redirect(`/admin/mailing-lists/?tab=lists&${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}`, 303);
  const action = String(form.get('action') ?? '');
  const name = String(form.get('name') ?? '').trim().slice(0, 100);
  const fields = { name, description: String(form.get('description') ?? '').trim().slice(0, 500), public: form.get('public') === '1' };
  if (action === 'add') {
    if (!name) return back('Name the list.');
    const { data: last } = await locals.db.from('mail_lists').select('sort').order('sort', { ascending: false }).limit(1);
    const { error } = await locals.db.from('mail_lists').insert({ ...fields, sort: (last?.[0]?.sort ?? 0) + 1 });
    return error ? back(error.message) : back(`${name} added.`, true);
  }
  const id = Number(form.get('id'));
  if (!id) return back('No list.');
  if (action === 'update') {
    if (!name) return back('Name the list.');
    const { error } = await locals.db.from('mail_lists').update({ ...fields, sort: Number(form.get('sort')) || 0 }).eq('id', id);
    return error ? back(error.message) : back('Saved.', true);
  }
  if (action === 'remove') {
    const { error } = await locals.db.from('mail_lists').delete().eq('id', id);
    return error ? back(error.message) : back('List removed.', true);
  }
  return back('Unknown action.');
};
