// The Email preferences form: which public lists a subscription is on, for the person a signed link is
// for (t), or the signed-in visitor whose address is confirmed (their account page). A visitor without a subscription who ticks
// lists signs up, confirmed by email like anyone.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/db/site';
import { PREFERENCES_PATH } from '../../../lib/mailing/config';
import { contactByEmail, loadLists, loadMailing, setLists, signUp } from '../../../lib/mailing/contacts';
import { verify } from '../../../lib/mailing/tokens';
import { viewerOf } from '../../../lib/members/viewer';
import { safeNext } from '../../../lib/members/account';
import { clientIp } from '../../../lib/mailing/request';

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const form = await request.formData();
  const token = String(form.get('t') ?? '');
  const back = safeNext(form.get('back')) || PREFERENCES_PATH;
  const to = (q: Record<string, string>) => {
    const u = new URL(back, url);
    if (token) u.searchParams.set('t', token);
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    return redirect(`${u.pathname}${u.search}`, 303);
  };
  const db = serviceClient();
  const { settings } = await loadMailing(db);
  if (!settings.enabled) return to({ error: 'Email preferences aren’t available.' });
  const chosen = form.getAll('lists').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  let id = token ? verify('manage', token) : null;
  if (token && !id) return to({ error: 'That link isn’t valid. Use the link in one of our emails.' });
  if (!id) {
    const viewer = await viewerOf(request, cookies);
    if (!viewer?.email) return to({ error: 'Use the link in one of our emails to manage your subscription.' });
    // An account whose address isn't confirmed (AUTH_CONFIRM_EMAIL off) could be anyone's: it can only sign
    // up, confirmed by email, and never changes that address's subscription without the signed link.
    const contact = viewer.emailVerified ? await contactByEmail(db, viewer.email) : null;
    if (!contact || contact.status !== 'subscribed') {
      // Signing up from the account page: member lists too.
      const allowed = (await loadLists(db)).filter((l) => l.public || settings.memberLists?.includes(l.id)).map((l) => l.id);
      const lists = chosen.filter((n) => allowed.includes(n));
      if (!lists.length) return contact ? (await setLists(db, contact.id, []), to({ m: 'saved' })) : to({ m: 'saved' });
      const r = await signUp(db, { email: viewer.email, name: viewer.name, lists, source: 'account', consentText: settings.consentText, ip: clientIp(request), origin: url.origin });
      return r.ok ? to({ m: 'sent' }) : to({ error: r.error });
    }
    id = contact.id;
  }
  const r = await setLists(db, id, chosen);
  return r.ok ? to({ m: 'saved' }) : to({ error: r.error ?? 'Not saved.' });
};
