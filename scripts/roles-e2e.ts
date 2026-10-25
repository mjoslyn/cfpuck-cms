// Roles: an editor doesn't see or reach templates, settings or users (pages, APIs, database); an admin
// manages roles and invites on /admin/users/. Uses temporary accounts, removed afterwards.
//   npx tsx --env-file=.env scripts/roles-e2e.ts
import { chromium, type Page } from 'playwright';
import { siteDb } from '../src/lib/supabase';
import { createUser, deleteUser, userByEmail } from '../src/lib/auth';

const origin = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const sb = siteDb();
const email = 'e2e-editor@example.com';
const invitee = 'e2e-invitee@example.com';
// A throwaway password per run; the account is deleted at the end.
const password = `e2e-${crypto.randomUUID()}`;
for (const e of [email, invitee]) {
  const old = await userByEmail(e);
  if (old) await deleteUser(old.id);
}
const created = { user: await createUser({ email, password, emailVerified: true }) };
await sb.from('profiles').update({ role: 'editor' }).eq('id', created.user.id);

const out: Record<string, unknown> = {};
const b = await chromium.launch();
const login = async (p: Page, who: string, pass: string) => {
  await p.goto(`${origin}/admin/login/`);
  await p.fill('input[name=email]', who);
  await p.fill('input[name=password]', pass);
  await Promise.all([p.waitForURL(/\/admin\/(?!login)/), p.click('button:has-text("Sign in")')]);
};
try {
  // Editor.
  const ed = await b.newPage();
  await login(ed, email, password);
  out.editorNav = await ed.locator('header nav a').allInnerTexts();
  for (const path of ['/admin/templates/', '/admin/settings/', '/admin/users/']) {
    await ed.goto(origin + path);
    out[`editor ${path}`] = `${new URL(ed.url()).pathname}${new URL(ed.url()).search}`;
  }
  out.editorNotice = await ed.getByText('That section is for admins.').count();
  out.editorSettingsApi = (await ed.request.put(`${origin}/api/admin/settings`, { data: { site: {} }, headers: { Origin: origin } })).status();
  out.editorRedirectsApi = (await ed.request.delete(`${origin}/api/admin/redirects?id=0`, { headers: { Origin: origin } })).status();
  out.editorUsersApi = (await ed.request.post(`${origin}/api/admin/users`, { form: { action: 'role', id: created.user.id, role: 'admin' }, headers: { Origin: origin }, maxRedirects: 0 })).status();
  // A query of the editor's own, as the admin screens send them: settings writes are refused.
  const query = { table: 'settings', action: 'update', columns: 'key', returning: true, values: { value: { hacked: true } }, filters: [{ path: '', item: { col: 'key', op: 'eq', value: 'options' } }], order: [] };
  const wrote = await (await ed.request.post(`${origin}/api/admin/db`, { data: { query }, headers: { Origin: origin } })).json();
  out.editorDbSettingsWrite = wrote.data?.length ?? 0;
  const { data: about } = await sb.from('entries').select('id').eq('slug', 'about').eq('type', 'page').single();
  await ed.goto(`${origin}/admin/edit/${about!.id}/`);
  await ed.frameLocator('iframe').first().locator('h2').first().waitFor();
  out.editorCanEditPages = true;

  // Admin.
  const ad = await b.newPage();
  await login(ad, process.env.LOCAL_ADMIN_EMAIL!, process.env.LOCAL_ADMIN_PASSWORD!);
  out.adminNav = await ad.locator('header nav a').allInnerTexts();
  await ad.goto(`${origin}/admin/users/`);
  await ad.getByLabel(`Role for ${email}`).selectOption('viewer');
  await ad.waitForURL(/ok=/);
  out.roleChanged = (await sb.from('profiles').select('role').eq('id', created.user.id).single()).data?.role;
  await ad.fill('input[name=email]', invitee);
  await ad.getByRole('button', { name: 'Invite' }).click();
  await ad.waitForURL(/(ok|error)=/);
  out.invite = decodeURIComponent(new URL(ad.url()).search);
  const invited = await userByEmail(invitee);
  out.invitedRole = invited ? (await sb.from('profiles').select('role').eq('id', invited.id).single()).data?.role : null;
  out.selfLocked = await ad.getByText('(you)').count();

  // The demoted editor no longer gets in.
  const ed2 = await b.newPage();
  await ed2.goto(`${origin}/admin/login/`);
  await ed2.fill('input[name=email]', email);
  await ed2.fill('input[name=password]', password);
  await ed2.click('button:has-text("Sign in")');
  await ed2.waitForTimeout(1500);
  out.viewerLanding = new URL(ed2.url()).pathname + new URL(ed2.url()).search;
  console.log(JSON.stringify(out, null, 1));
} finally {
  for (const e of [email, invitee]) {
    const u = await userByEmail(e);
    if (u) await deleteUser(u.id);
  }
  await b.close();
}
