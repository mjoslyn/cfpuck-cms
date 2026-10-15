// A visitor creates an account (the Member account block, when Settings > Members allows sign-ups): an
// auth account and a membership at the sign-up level, active at once or waiting for an admin. When the
// project asks addresses to be confirmed, they confirm by email first (the link signs them in on the
// account page). The site's admin address is told of each sign-up.
import type { APIRoute } from 'astro';
import { serverClient, serviceClient, siteDb } from '../../../lib/supabase';
import { EMAIL, accountUrl, loadMemberSettings, safeNext } from '../../../lib/members/account';
import { sendMail } from '../../../lib/forms/mail';
import { site } from '../../../lib/site';

const env = (k: string) => (import.meta.env?.[k] as string | undefined) ?? process.env[k];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const form = await request.formData();
  const next = safeNext(form.get('next'));
  const back = (error: string) => redirect(accountUrl({ error, next }), 303);
  const settings = await loadMemberSettings(siteDb());
  if (!settings.enabled || settings.signup === 'off') return back('Accounts are made by our staff. Get in touch to join.');
  if (String(form.get('_hp') ?? '')) return back('Something went wrong. Please try again.');
  const name = String(form.get('name') ?? '').trim().slice(0, 100);
  const email = String(form.get('email') ?? '').trim().toLowerCase().slice(0, 254);
  const password = String(form.get('password') ?? '');
  if (!name) return back('Enter your name.');
  if (!EMAIL.test(email)) return back('Enter your email address.');
  if (password.length < 10) return back('Use a password of at least 10 characters.');
  if (password !== String(form.get('confirm') ?? '')) return back('The two passwords don’t match.');

  const { data, error } = await serverClient(request, cookies).auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: `${url.origin}${accountUrl()}` } });
  if (error) return back(/already registered|already exists/i.test(error.message) ? 'That email already has an account. Sign in, or reset your password.' : error.message);
  // An address that already has an account comes back with no identities (and no new account).
  if (!data.user || !data.user.identities?.length) return back('That email already has an account. Sign in, or reset your password.');
  const status = settings.signup === 'open' ? 'active' : 'pending';
  const db = serviceClient();
  const { error: e2 } = await db.from('members').upsert({ user_id: data.user.id, email, name, level: settings.signupLevel ?? '', status }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (e2) return back(e2.message);
  await db.from('profiles').update({ display_name: name }).eq('id', data.user.id);
  const admin = env('FORMS_ADMIN_EMAIL') || site.adminEmail;
  if (admin) {
    const html = `<p>${esc(name)} (${esc(email)}) created an account${status === 'pending' ? '. It is waiting for approval' : ''}.</p><p><a href="${url.origin}/admin/members/">Members</a></p>`;
    await sendMail({ to: [admin], subject: `New member sign-up: ${name}`, html }).catch((e) => console.error(`members: sign-up email failed: ${e.message}`));
  }
  const m = !data.session ? 'confirm' : status === 'active' ? 'signed-up' : 'pending';
  return redirect(accountUrl({ m, next: status === 'active' ? next : undefined }), 303);
};
