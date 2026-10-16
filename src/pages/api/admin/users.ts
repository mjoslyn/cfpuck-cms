// Users (admins only; see middleware). Form posts, back to /admin/users/:
// action=role (id, role: viewer | editor | admin), action=invite (email, role), action=resend (id: an
// invitation not yet taken up, sent again), action=delete (id: the account, with its profile and any
// membership; what it made stays, its author left empty).
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/supabase';
import { invite, resendInvite } from '../../../lib/admin/invite';

const ROLES = ['viewer', 'editor', 'admin'];

export const POST: APIRoute = async ({ request, locals, redirect, url }) => {
  // Checked here as well as in the middleware: inviting uses the service key, which no database rule guards.
  if (locals.user?.role !== 'admin') return new Response('Admins only', { status: 403 });
  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const role = String(form.get('role') ?? '');
  const back = (msg: string, ok = false) => redirect(`/admin/users/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}`, 303);
  if ((action === 'role' || action === 'invite') && !ROLES.includes(role)) return back('Unknown role.');

  if (action === 'role') {
    const id = String(form.get('id') ?? '');
    if (id === locals.user.id) return back("You can't change your own role.");
    const { error } = await locals.db.from('profiles').update({ role }).eq('id', id);
    return error ? back(error.message) : back('Role updated.', true);
  }

  if (action === 'invite') {
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return back('Enter an email address.');
    const res = await invite(email, 'admin', url.origin);
    if ('error' in res) return back(res.error);
    // The profile is created by the auth trigger; give it the chosen role.
    const { error: e2 } = await serviceClient().from('profiles').update({ role }).eq('id', res.user.id);
    return e2 ? back(e2.message) : back(`Invitation sent to ${email}. ${res.note}`, true);
  }
  if (action === 'resend') {
    const res = await resendInvite(String(form.get('id') ?? ''), 'admin', url.origin);
    return 'error' in res ? back(res.error) : back(`A new invitation went to ${res.email}. ${res.note}`, true);
  }
  if (action === 'delete') {
    const id = String(form.get('id') ?? '');
    if (!id) return back('No account.');
    if (id === locals.user.id) return back("You can't delete your own account.");
    const admin = serviceClient().auth.admin;
    const { data } = await admin.getUserById(id);
    const { error } = await admin.deleteUser(id);
    return error ? back(error.message) : back(`${data.user?.email ?? 'The account'} was deleted.`, true);
  }
  return back('Unknown action.');
};
