// Settings > Connections (admins): GET where each service's keys come from (never their values); POST
// { service, values, password } checks the keys with the service, sets it up (webhooks) and saves them,
// encrypted; POST { service, remove: true, password } removes the saved ones. Payment and mail keys need
// the admin's password again, and every change is emailed to all admins.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/db/site';
import { env, hostEnv } from '../../../lib/env';
import { keyStatus, namesOf, saveKeys, SERVICES, type Service } from '../../../lib/site-keys';
import { connect, ConnectError } from '../../../lib/connections';
import { checkPassword } from '../../../lib/auth';
import { sendMail } from '../../../lib/forms/mail';
import { site } from '../../../lib/site';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Every admin's address. */
async function adminEmails(): Promise<string[]> {
  const db = serviceClient();
  const { data: admins } = await db.from('profiles').select('id').eq('role', 'admin');
  const ids = (admins ?? []).map((a) => a.id);
  if (!ids.length) return [];
  const { data: users } = await db.from('users').select('email').in('id', ids);
  return (users ?? []).map((u) => u.email).filter(Boolean);
}

/** Tell every admin a connection changed (who, what and when), so a stolen sign-in can't swap a key quietly. */
async function tellAdmins(origin: string, who: string, what: string) {
  const to = await adminEmails();
  if (!to.length) return;
  const when = new Date().toUTCString();
  const link = `${env('SITE_URL') || origin}/admin/settings/#connections`;
  await sendMail({
    to,
    subject: `${site.name}: ${what}`,
    html: `<p>${esc(who)} ${esc(what.charAt(0).toLowerCase() + what.slice(1))} on ${esc(site.name)} (${esc(when)}).</p><p>If that wasn’t expected, check <a href="${link}">Settings &gt; Connections</a> and change your password.</p>`,
  }).catch((e) => console.error(`connections: admin email failed: ${(e as Error).message}`));
}

export const GET: APIRoute = async ({ locals }) =>
  locals.user?.role === 'admin' ? Response.json({ services: SERVICES, keys: await keyStatus(serviceClient()) }) : new Response('Admins only', { status: 403 });

export const POST: APIRoute = async ({ request, locals, url }) => {
  if (locals.user?.role !== 'admin') return new Response('Admins only', { status: 403 });
  const body = await request.json().catch(() => ({}));
  const service = String(body.service ?? '') as Service;
  if (!(service in SERVICES)) return new Response('Unknown service.', { status: 400 });
  const def = SERVICES[service];
  if (def.guarded) {
    const ok = await checkPassword(request, String(body.password ?? ''));
    if (!ok.ok) return new Response(ok.error, { status: 403 });
  }
  const db = serviceClient();
  const who = locals.user.email;
  try {
    if (body.remove) {
      await saveKeys(db, Object.fromEntries(namesOf(service).filter((n) => !hostEnv(n)).map((n) => [n, ''])), who);
      await tellAdmins(url.origin, who, `${def.label} was disconnected`);
      return Response.json({ keys: await keyStatus(db), notes: [`${def.label}’s saved keys were removed. Its webhooks stay in ${def.label}’s dashboard until you delete them there.`] });
    }
    const input = Object.fromEntries(Object.entries((body.values ?? {}) as Record<string, unknown>).filter(([k]) => namesOf(service).includes(k)).map(([k, v]) => [k, String(v ?? '')]));
    const done = await connect(service, input, env, env('SITE_URL') || url.origin);
    if (done.choose) return Response.json({ choose: done.choose, notes: done.notes });
    // A setting the host sets stays the host's.
    await saveKeys(db, Object.fromEntries(Object.entries(done.values).filter(([k]) => !hostEnv(k))), who);
    await tellAdmins(url.origin, who, `${def.label} was connected`);
    return Response.json({ keys: await keyStatus(db), notes: done.notes });
  } catch (e) {
    return new Response((e as Error).message, { status: e instanceof ConnectError ? 400 : 502 });
  }
};
