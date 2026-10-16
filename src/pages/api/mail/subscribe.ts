// A Subscribe block's form: the address asks to join some lists and is sent a confirmation link
// (src/lib/mailing/contacts.ts signUp). Back to the page the form is on, with the outcome. The answer is
// the same whether the address was known or not.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/supabase';
import { SUBSCRIBE_PATH, fieldValue } from '../../../lib/mailing/config';
import { loadLists, loadMailing, signUp } from '../../../lib/mailing/contacts';
import { safeNext } from '../../../lib/members/account';
import { clientIp } from '../../../lib/mailing/request';
import { cleanTags } from '../../../lib/mailing/segments';

/** Sign-ups a minute, site-wide, before the form answers "try again in a minute". */
const PER_MINUTE = 30;

export const POST: APIRoute = async ({ request, redirect, url }) => {
  const form = await request.formData();
  const back = safeNext(form.get('back')) || SUBSCRIBE_PATH;
  const block = String(form.get('block') ?? '').slice(0, 80);
  const to = (q: Record<string, string>) => {
    const u = new URL(back, url);
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    if (block) u.searchParams.set('subscribe_block', block);
    return redirect(`${u.pathname}${u.search}${block ? `#subscribe-${encodeURIComponent(block)}` : ''}`, 303);
  };
  const db = serviceClient();
  const { settings } = await loadMailing(db);
  if (!settings.enabled) return to({ subscribe_error: 'Sign-ups are closed.' });
  // A filled-in honeypot: act as if it worked.
  if (String(form.get('_hp') ?? '').trim()) return to({ subscribe: 'sent' });
  const { count } = await db.from('contacts').select('id', { count: 'exact', head: true }).gte('consent_at', new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) >= PER_MINUTE) return new Response('We’re getting a lot of sign-ups right now. Please go back and try again in a minute.', { status: 429, headers: { 'Retry-After': '60' } });
  // Public lists, and the lists offered to members.
  const allowed = (await loadLists(db)).filter((l) => l.public || settings.memberLists?.includes(l.id)).map((l) => l.id);
  const lists = form.getAll('lists').map(Number).filter((n) => allowed.includes(n));
  const result = await signUp(db, {
    email: String(form.get('email') ?? ''),
    first_name: String(form.get('first_name') ?? ''),
    last_name: String(form.get('last_name') ?? ''),
    // A form from before names were split.
    name: String(form.get('name') ?? ''),
    // The site's fields (cf_<key>), checked against their types; only a new or unconfirmed address takes them.
    attributes: Object.fromEntries((settings.fields ?? []).map((f) => [f.key, fieldValue(f, form.get(`cf_${f.key}`))])),
    lists,
    source: `subscribe:${back}`,
    consentText: String(form.get('consent') ?? '').slice(0, 1000),
    ip: clientIp(request),
    origin: url.origin,
    // The block's tags (signUp adds them only to a new or unconfirmed address).
    tags: cleanTags(String(form.get('tags') ?? '')).slice(0, 5),
  });
  return result.ok ? to({ subscribe: 'sent' }) : to({ subscribe_error: result.error });
};
