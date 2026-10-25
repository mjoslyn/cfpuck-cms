// Accounts (src/lib/auth) against the running site, without a browser: admin sign-in and sign-out, an
// invitation from its email to a password and a session, an admin's password link, used links refused,
// a member's sign-in, password link and account page, a sign-up's confirmation link, and a password
// carried over from Supabase Auth (bcrypt) signing in and being rehashed. Emails are read from the local
// mail catcher (LOCAL_MAIL_URL). Removes what it makes.
//   npx tsx --env-file=.env scripts/auth-e2e.ts
import bcrypt from 'bcryptjs';
import { siteDb } from '../src/lib/db/site';
import { confirmToken, createUser, deleteUser, userByEmail } from '../src/lib/auth';

const base = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const mail = process.env.LOCAL_MAIL_URL ?? 'http://127.0.0.1:8025';
const db = siteDb();
const stamp = Date.now().toString(36);
let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${pass || !detail ? '' : ` ${detail.slice(0, 300)}`}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cookieOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const post = (path: string, body: Record<string, string>, cookie = '') =>
  fetch(base + path, { method: 'POST', redirect: 'manual', headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}) }, body: new URLSearchParams(body) });
const get = (path: string, cookie = '') => fetch(base + path, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
const linkIn = (html: string) => html.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&') ?? '';
const inbox = async (to: string): Promise<{ Subject: string; HTML: string } | null> => {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`).then((x) => x.json());
    const id = r.messages?.[0]?.ID;
    if (id) return fetch(`${mail}/api/v1/message/${id}`).then((x) => x.json());
    await sleep(250);
  }
  return null;
};
const clear = (to: string) => fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`, { method: 'DELETE' });

const admin = { email: process.env.LOCAL_ADMIN_EMAIL!, password: process.env.LOCAL_ADMIN_PASSWORD! };
const invitee = `auth-e2e-invitee-${stamp}@example.org`;
const member = `auth-e2e-member-${stamp}@example.org`;
const signup = `auth-e2e-signup-${stamp}@example.org`;
const carried = `auth-e2e-carried-${stamp}@example.org`;

try {
  // Admin: sign in, the admin answers, sign out, it doesn't.
  let r = await post('/api/auth/login', { ...admin, next: '/admin/' });
  const adminCookie = cookieOf(r);
  ok('admin signs in', r.status === 302 && r.headers.get('location') === '/admin/' && adminCookie.includes('site.session_token'));
  ok('admin pages answer', (await get('/api/admin/me', adminCookie)).ok);
  r = await post('/api/auth/login', { email: admin.email, password: 'wrong-password-1' });
  ok('a wrong password is refused', (r.headers.get('location') ?? '').includes('error='));

  // An invitation: its email, its link, a password, then signed in.
  await clear(invitee);
  r = await post('/api/admin/users', { action: 'invite', email: invitee, role: 'editor' }, adminCookie);
  ok('invitation sent', (r.headers.get('location') ?? '').includes('ok='), r.headers.get('location') ?? '');
  const inviteMail = await inbox(invitee);
  const inviteLink = linkIn(inviteMail?.HTML ?? '');
  ok('invitation email has its link', inviteLink.includes('/api/auth/invite?t='), inviteMail?.Subject ?? 'no email');
  const users = await (await get('/admin/users/', adminCookie)).text();
  ok('Users lists the invitation', users.includes(invitee) && users.includes('Invited, not signed in yet'));
  r = await get(new URL(inviteLink).pathname + new URL(inviteLink).search);
  const setPage = r.headers.get('location') ?? '';
  ok('the link goes to set a password, with a token', setPage.startsWith('/admin/set-password/?token='), setPage);
  const token = new URL(setPage, base).searchParams.get('token')!;
  ok('the page names the account', (await (await get(setPage)).text()).includes(`For ${invitee}`));
  r = await post('/api/auth/password', { token, password: 'invitee-password-1', confirm: 'invitee-password-1' });
  const inviteeCookie = cookieOf(r);
  ok('setting it signs in', r.headers.get('location') === '/admin/' && inviteeCookie.includes('site.session_token'));
  ok('as an editor', (await get('/api/admin/me', inviteeCookie)).ok);
  r = await get(new URL(inviteLink).pathname + new URL(inviteLink).search);
  ok('the invitation link is spent', (r.headers.get('location') ?? '').includes('error='));
  r = await post('/api/auth/password', { token, password: 'invitee-password-2', confirm: 'invitee-password-2' });
  ok('so is its token', (r.headers.get('location') ?? '').includes('error='));
  r = await post('/api/auth/logout', {}, inviteeCookie);
  ok('signing out clears the session', (await get('/api/admin/me', inviteeCookie)).status === 401);

  // An admin's password link.
  await clear(invitee);
  r = await post('/api/auth/forgot', { email: invitee });
  const resetLink = linkIn((await inbox(invitee))?.HTML ?? '');
  ok('password link sent', resetLink.includes('/admin/set-password/?token='), resetLink);
  r = await post('/api/auth/password', { token: new URL(resetLink).searchParams.get('token')!, password: 'invitee-password-3', confirm: 'invitee-password-3' });
  ok('the link sets a new password', r.headers.get('location') === '/admin/');
  r = await post('/api/auth/login', { email: invitee, password: 'invitee-password-3' });
  ok('which signs in', r.headers.get('location') === '/admin/');
  r = await post('/api/auth/forgot', { email: `nobody-${stamp}@example.org` });
  ok('an unknown address gets the same answer', r.headers.get('location') === '/admin/login/?sent=1');

  // A member: sign in, the account page, a password link to the account page.
  const m = await createUser({ email: member, name: 'Mem Ber', password: 'member-password-1', emailVerified: true });
  await db.from('members').insert({ user_id: m.id, email: member, name: 'Mem Ber', level: '', status: 'active' });
  r = await post('/api/members/login', { email: member, password: 'member-password-1' });
  const memberCookie = cookieOf(r);
  ok('member signs in', r.status === 303 && memberCookie.includes('site.session_token'));
  ok('the account page shows them', (await (await get('/account/', memberCookie)).text()).includes(member));
  ok('a member gets no admin', (await get('/api/admin/me', memberCookie)).status === 403);
  const me = await (await get('/api/members/me', memberCookie)).json();
  ok('the member link knows them', me.signedIn === true && me.member === true, JSON.stringify(me));
  await clear(member);
  await post('/api/members/forgot', { email: member });
  const memberLink = linkIn((await inbox(member))?.HTML ?? '');
  ok('member password link goes to the account page', memberLink.includes('/account/?view=password&token='), memberLink);
  ok('which shows the form', (await (await get(new URL(memberLink).pathname + new URL(memberLink).search)).text()).includes('name="token"'));
  r = await post('/api/members/password', { token: new URL(memberLink).searchParams.get('token')!, password: 'member-password-2', confirm: 'member-password-2' });
  ok('and sets the password, signed in', (r.headers.get('location') ?? '').includes('password-saved') && cookieOf(r).includes('site.session_token'));
  r = await post('/api/members/password', { password: 'member-password-3', confirm: 'member-password-3' }, memberCookie);
  ok('a signed-in member changes theirs', (r.headers.get('location') ?? '').includes('password-saved'));
  r = await post('/api/members/login', { email: member, password: 'member-password-3' });
  ok('and signs in with it', cookieOf(r).includes('site.session_token'));
  r = await post('/api/members/logout', {}, memberCookie);
  ok('member signs out', !(await (await get('/api/members/me', memberCookie)).json()).signedIn);

  // A sign-up's confirmation link signs them in on the account page.
  const s = await createUser({ email: signup, name: 'Sign Up', password: 'signup-password-1' });
  r = await get(`/account/?confirm=${await confirmToken(signup)}`);
  ok('a confirmation link confirms and signs in', cookieOf(r).includes('site.session_token') && (await userByEmail(signup))?.emailVerified === true);
  r = await get('/account/?confirm=not-a-token');
  ok('a bad confirmation link says so', (r.headers.get('location') ?? '').includes('error='));
  await deleteUser(s.id);

  // A password carried over from Supabase Auth.
  const c = await createUser({ email: carried, emailVerified: true });
  await db.from('accounts').insert({ id: crypto.randomUUID(), user_id: c.id, account_id: c.id, provider_id: 'credential', password: bcrypt.hashSync('carried-password-1', 10) });
  r = await post('/api/auth/login', { email: carried, password: 'carried-password-1' });
  const { data: acct } = await db.from('accounts').select('password').eq('user_id', c.id).single();
  ok('a bcrypt password signs in and is rehashed', r.headers.get('location') === '/admin/' && !String(acct?.password).startsWith('$2'));
} finally {
  for (const e of [invitee, member, signup, carried]) {
    const u = await userByEmail(e);
    if (u) await deleteUser(u.id);
  }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
