// A member signs in (the Member account block): back to the page they came from, or the account page.
// An address not yet confirmed gets a new confirmation link.
import type { APIRoute } from 'astro';
import { siteDb } from '../../../lib/db/site';
import { redirectWith, signIn } from '../../../lib/auth';
import { accountUrl, loadMemberSettings, safeNext } from '../../../lib/members/account';
import { sendConfirmation } from '../../../lib/members/confirm';

export const POST: APIRoute = async ({ request, redirect, url }) => {
  const form = await request.formData();
  const next = safeNext(form.get('next'));
  if (!(await loadMemberSettings(siteDb())).enabled) return redirect(accountUrl(), 303);
  const res = await signIn(String(form.get('email') ?? '').trim(), String(form.get('password') ?? ''), request);
  if (!res.ok) {
    if (res.unconfirmed) await sendConfirmation(res.unconfirmed.email, url.origin, next).catch((e) => console.error(`members: confirmation email failed: ${e.message}`));
    return redirect(accountUrl({ error: res.error, next }), 303);
  }
  return redirectWith(next || accountUrl(), res.cookies);
};
