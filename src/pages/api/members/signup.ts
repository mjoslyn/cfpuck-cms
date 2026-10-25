// A visitor creates an account (the Member account block, when Settings > Members allows sign-ups): an
// account and a membership at the sign-up level, active at once or waiting for an admin. Addresses are
// confirmed by email first (AUTH_CONFIRM_EMAIL, on by default: the link signs them in on the account
// page); otherwise they are signed in at once. The site's admin address is told of each sign-up.
import type { APIRoute } from 'astro';
import { serviceClient, siteDb } from '../../../lib/db/site';
import { confirmEmail, createUser, redirectWith, signIn, userByEmail } from '../../../lib/auth';
import { EMAIL, accountUrl, loadMemberSettings, safeNext } from '../../../lib/members/account';
import { sendConfirmation } from '../../../lib/members/confirm';
import { sendMail } from '../../../lib/forms/mail';
import { site } from '../../../lib/site';
import { mailingSettings, CONSENT_TEXT } from '../../../lib/mailing/config';
import { signUp } from '../../../lib/mailing/contacts';
import { clientIp } from '../../../lib/mailing/request';
import { env } from '../../../lib/env';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const POST: APIRoute = async ({ request, redirect, url }) => {
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

  if (await userByEmail(email)) return back('That email already has an account. Sign in, or reset your password.');
  const user = await createUser({ email, name, password }).catch((e: Error) => e);
  if (user instanceof Error) return back(user.message);
  const status = settings.signup === 'open' ? 'active' : 'pending';
  const db = serviceClient();
  const { error: e2 } = await db.from('members').upsert({ user_id: user.id, email, name, level: settings.signupLevel ?? '', status }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (e2) return back(e2.message);
  const admin = env('FORMS_ADMIN_EMAIL') || site.adminEmail;
  if (admin) {
    const html = `<p>${esc(name)} (${esc(email)}) created an account${status === 'pending' ? '. It is waiting for approval' : ''}.</p><p><a href="${url.origin}/admin/members/">Members</a></p>`;
    await sendMail({ to: [admin], subject: `New member sign-up: ${name}`, html }).catch((e) => console.error(`members: sign-up email failed: ${e.message}`));
  }
  // Ticked "Send me ... by email" (Mailing on): the member lists, confirmed by email like any sign-up.
  if (form.get('mail_optin')) {
    const { data: siteRow } = await siteDb().from('settings').select('value').eq('key', 'site').maybeSingle();
    const mail = mailingSettings(siteRow?.value);
    if (mail.enabled && mail.memberLists?.length) {
      const ip = clientIp(request);
      await signUp(db, { email, name, lists: mail.memberLists, source: 'members:signup', consentText: mail.consentText || CONSENT_TEXT, ip, origin: url.origin }).catch((e) => console.error(`members: mailing sign-up failed: ${e.message}`));
    }
  }
  const after = status === 'active' ? next : '';
  if (confirmEmail()) {
    await sendConfirmation(email, url.origin, after).catch((e) => console.error(`members: confirmation email failed: ${e.message}`));
    return redirect(accountUrl({ m: 'confirm' }), 303);
  }
  const signedIn = await signIn(email, password, request);
  const target = accountUrl({ m: status === 'active' ? 'signed-up' : 'pending', next: after || undefined });
  return signedIn.ok ? redirectWith(target, signedIn.cookies) : redirect(target, 303);
};
