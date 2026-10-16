// Members (admins only; see middleware). Form posts, back to /admin/members/:
// add (email, name, level, status, expires_on): an existing account becomes a member, or the address is
//   invited (the link lands on the account page to set a password);
// update (id, name, level, status, expires_on, notes); approve (id); reset (id): email a password link;
// resend (id): an invitation not yet taken up, sent again;
// remove (id): the membership, and the account too unless it edits the site.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/supabase';
import { EMAIL, accountUrl } from '../../../lib/members/account';
import { memberSettings } from '../../../lib/members/config';
import { invite, resendInvite } from '../../../lib/admin/invite';

const STATUSES = ['pending', 'active', 'suspended'];
const date = (v: FormDataEntryValue | null) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** An account by email (Supabase Auth has no lookup by address; sites have few enough to page through). */
async function userByEmail(email: string) {
  const admin = serviceClient().auth.admin;
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit || data.users.length < 1000) return hit ?? null;
  }
  return null;
}

export const POST: APIRoute = async ({ request, locals, redirect, url }) => {
  // Checked here as well as in the middleware: inviting uses the service key, which no database rule guards.
  if (locals.user?.role !== 'admin') return new Response('Admins only', { status: 403 });
  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const back = (msg: string, ok = false) => redirect(`/admin/members/?${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}${form.get('return') ? `&${String(form.get('return')).replace(/^[?&]/, '')}` : ''}`, 303);
  const { data: site } = await locals.db.from('settings').select('value').eq('key', 'site').maybeSingle();
  const levels = memberSettings(site?.value).levels;
  const level = (v: FormDataEntryValue | null) => (levels.some((l) => l.id === v) ? String(v) : '');
  const id = String(form.get('id') ?? '');

  if (action === 'add') {
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    if (!EMAIL.test(email)) return back('Enter an email address.');
    const name = String(form.get('name') ?? '').trim().slice(0, 100);
    let user = await userByEmail(email);
    let invited = '';
    if (!user) {
      const res = await invite(email, 'member', url.origin, { name });
      if ('error' in res) return back(res.error);
      user = res.user;
      invited = res.note;
      if (name) await serviceClient().from('profiles').update({ display_name: name }).eq('id', user.id);
    }
    const { error } = await locals.db.from('members').insert({ user_id: user.id, email, name: name || String(user.user_metadata?.name ?? ''), level: level(form.get('level')), status: STATUSES.includes(String(form.get('status'))) ? String(form.get('status')) : 'active', expires_on: date(form.get('expires_on')) });
    if (error) return back(error.code === '23505' ? `${email} is already a member.` : error.message);
    return back(invited ? `Invitation sent to ${email}. ${invited}` : `${email} already had an account; they're a member now.`, true);
  }

  if (!id) return back('No member.');
  if (action === 'update') {
    const status = String(form.get('status') ?? '');
    if (!STATUSES.includes(status)) return back('Unknown status.');
    const { error } = await locals.db
      .from('members')
      .update({ name: String(form.get('name') ?? '').trim().slice(0, 100), level: level(form.get('level')), status, expires_on: date(form.get('expires_on')), notes: String(form.get('notes') ?? '').slice(0, 2000) })
      .eq('user_id', id);
    return error ? back(error.message) : back('Saved.', true);
  }
  if (action === 'approve') {
    const { error } = await locals.db.from('members').update({ status: 'active' }).eq('user_id', id);
    return error ? back(error.message) : back('Approved.', true);
  }
  if (action === 'reset') {
    const { data: m } = await locals.db.from('members').select('email').eq('user_id', id).maybeSingle();
    if (!m?.email) return back('No such member.');
    const { error } = await serviceClient().auth.resetPasswordForEmail(m.email, { redirectTo: `${url.origin}${accountUrl({ view: 'password' })}` });
    return error ? back(error.message) : back(`A link to set a password went to ${m.email}.`, true);
  }
  if (action === 'resend') {
    const res = await resendInvite(id, 'member', url.origin);
    return 'error' in res ? back(res.error) : back(`A new invitation went to ${res.email}. ${res.note}`, true);
  }
  if (action === 'remove') {
    const { error } = await locals.db.from('members').delete().eq('user_id', id);
    if (error) return back(error.message);
    // Their account goes too, unless it edits the site.
    const { data: profile } = await serviceClient().from('profiles').select('role').eq('id', id).maybeSingle();
    if (!profile || profile.role === 'viewer') {
      const { error: e2 } = await serviceClient().auth.admin.deleteUser(id);
      if (e2) return back(`Membership removed; the account couldn't be: ${e2.message}`);
      return back('Member and their account removed.', true);
    }
    return back('Membership removed (their editor account stays).', true);
  }
  return back('Unknown action.');
};
