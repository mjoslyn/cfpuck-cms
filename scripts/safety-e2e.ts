// Upload, form and restore safeguards, through the running site: an SVG served with the /media/
// headers that stop its script, a form's answer cap and 20-a-minute limit, an address shared by pages and posts kept unique,
// and a snapshot restore run as a job (rows made since deleted, a form with submissions kept).
// Everything it makes is removed afterwards.
//   npx tsx --env-file=.env scripts/safety-e2e.ts
import { siteDb } from '../src/lib/db/site';
import { closeLocalBindings } from '../src/lib/local-bindings';
import { createUser, deleteUser } from '../src/lib/auth';
const base = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const db = siteDb();
let bad = 0;
const ok = (name: string, cond: unknown, extra = '') => (cond || bad++, console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`));
// sign in
const login = await fetch(`${base}/api/auth/login`, { method: 'POST', redirect: 'manual', headers: { Origin: base }, body: new URLSearchParams({ email: process.env.LOCAL_ADMIN_EMAIL!, password: process.env.LOCAL_ADMIN_PASSWORD! }) });
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const H = { Origin: base, Cookie: cookie };
const json = (method: string, path: string, body: unknown) => fetch(base + path, { method, headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) });

// SVG refused, PNG accepted, /media/ headers
const up = async (name: string, type: string, bytes: BlobPart) => { const f = new FormData(); f.append('file', new File([bytes], name, { type })); return fetch(`${base}/api/admin/media`, { method: 'POST', headers: H, body: f }); };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>';
let r = await up('safety-e2e.svg', 'image/svg+xml', svg); const svgRow = r.ok ? await r.json() : null; ok('svg accepted', r.ok);
if (svgRow) { r = await fetch(`${base}/media/${svgRow.path}`); ok('svg served sandboxed', r.headers.get('content-type')?.startsWith('image/svg') && r.headers.get('content-security-policy') === 'sandbox', `${r.status}`); await db.from('media').delete().eq('id', svgRow.id); }
const sharp = (await import('sharp')).default;
const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#c33' } }).png().toBuffer();
r = await up('safety-e2e.png', 'image/png', new Uint8Array(png)); const media = r.ok ? await r.json() : null; ok('png accepted', r.ok, media?.path);
if (media) { r = await fetch(`${base}/media/${media.path}`); ok('media headers', r.headers.get('content-security-policy') === 'sandbox' && r.headers.get('x-content-type-options') === 'nosniff', `${r.status}`); }

// form limits
const { data: form } = await db.from('forms').insert({ title: 'safety-e2e', is_active: true, definition: { fields: [{ id: 'f1', type: 'text', label: 'Name' }] }, notifications: [] }).select('id').single();
const post = (v: string) => fetch(`${base}/`, { method: 'POST', headers: { Origin: base }, body: new URLSearchParams({ _form: String(form!.id), f1: v }) });
r = await post('x'.repeat(50_000)); ok('big answer accepted', r.status === 200);
const { data: sub } = await db.from('form_submissions').select('data').eq('form_id', form!.id).single();
ok('answer cut to 10000', sub?.data.entry.f1.length === 10_000, String(sub?.data.entry.f1.length));
const codes: number[] = []; for (let i = 0; i < 21; i++) codes.push((await post('hi')).status);
ok('20 a minute, then 429', codes.filter((c) => c === 200).length === 19 && codes.slice(19).every((c) => c === 429), codes.join(','));

// a post can't take a page's address
const { data: page } = await db.from('entries').select('id, slug, title').eq('type', 'page').eq('status', 'publish').neq('slug', 'home').limit(1).single();
r = await json('POST', '/api/admin/entries', { type: 'post', title: page!.title }); const made = await r.json();
const { data: post1 } = await db.from('entries').select('id, slug').eq('id', made.id).single();
ok('a post titled like a page gets its own address', post1?.slug !== page!.slug, post1?.slug);
r = await json('PUT', `/api/admin/entries/${made.id}`, { action: 'draft', entry: { title: page!.title, slug: page!.slug } }); ok('typed clash refused', r.status === 400, await r.text());

// two editors: a save based on an older version is refused, unless sent again without its base
const stamp = async () => (await db.from('entries').select('updated_at').eq('id', made.id).single()).data!.updated_at;
const old = await stamp();
r = await json('PUT', `/api/admin/entries/${made.id}`, { action: 'draft', base: old, entry: { title: 'First', slug: post1!.slug, tags: ['Safety e2e tag', 'Other e2e tag'] } }); const first = await r.json();
ok('save with the current base', r.ok && first.updated_at === (await stamp()) && first.updated_at !== old);
r = await json('PUT', `/api/admin/entries/${made.id}`, { action: 'draft', base: old, entry: { title: 'Second', slug: post1!.slug } }); ok('stale save refused', r.status === 409, await r.text());
ok('first save kept', (await db.from('entries').select('title').eq('id', made.id).single()).data?.title === 'First');
// two saves making the same new tag at once both succeed; tags are replaced, not piled up
const { data: other } = await db.from('entries').insert({ type: 'post', slug: 'safety-e2e-other', title: 'Other', status: 'draft' }).select('id').single();
const both = await Promise.all([made.id, other!.id].map((id) => json('PUT', `/api/admin/entries/${id}`, { action: 'draft', entry: { title: 'Tagged', slug: id === made.id ? post1!.slug : 'safety-e2e-other', tags: ['Racing e2e tag'] } })));
ok('same new tag from two saves', both.every((x) => x.ok), both.map((x) => x.status).join(','));
const tagsOf = async (id: number) => ((await db.from('entry_terms').select('terms!inner(name, taxonomy)').eq('entry_id', id).eq('terms.taxonomy', 'tag')).data ?? []).map((t: any) => t.terms.name).sort().join('|');
ok('tags replaced', (await tagsOf(made.id)) === 'Racing e2e tag' && (await tagsOf(other!.id)) === 'Racing e2e tag', await tagsOf(made.id));
ok('tag made once', (await db.from('terms').select('id').eq('taxonomy', 'tag').eq('name', 'Racing e2e tag')).data?.length === 1);
await db.from('entries').delete().eq('id', other!.id); await db.from('terms').delete().eq('taxonomy', 'tag').like('name', '%e2e tag');

// search: punctuation around a word doesn't hide the page
r = await fetch(`${base}/api/search?q=${encodeURIComponent(`(${page!.title})`)}`); ok('search with brackets', JSON.stringify(await r.json()).includes(page!.slug));

// an editor can't use the redirects API; Compose refuses a block too large to read back
const editor = { email: 'safety-e2e-editor@example.com', password: `e2e-${crypto.randomUUID()}` };
const account = { user: await createUser({ ...editor, emailVerified: true }) }; await db.from('profiles').update({ role: 'editor' }).eq('id', account.user.id);
const edLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', redirect: 'manual', headers: { Origin: base }, body: new URLSearchParams(editor) });
const edH = { Origin: base, Cookie: edLogin.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
ok('editor signed in', (await fetch(`${base}/api/admin/me`, { headers: edH })).ok);
ok('redirects API is for admins', (await fetch(`${base}/api/admin/redirects?id=0`, { method: 'DELETE', headers: edH })).status === 403);
await deleteUser(account.user.id);
const big = new FormData(); big.append('message', 'change this'); big.append('targetId', 'x'); big.append('targetJson', JSON.stringify({ type: 'text', props: { id: 'x', attrs: { content: 'x'.repeat(61_000) } } }));
r = await fetch(`${base}/api/admin/compose`, { method: 'POST', headers: H, body: big }); ok('oversize block refused', r.status === 400 && /too large/.test(await r.text()), String(r.status));

// restore as a job
r = await json('POST', '/api/admin/sync', { action: 'snapshot', site: 'here' }); const snap = await r.json(); ok('snapshot', r.ok, JSON.stringify(snap));
await db.from('entries').update({ title: 'CHANGED' }).eq('id', page!.id);
const made2 = await (await json('POST', '/api/admin/entries', { type: 'post', title: 'Made since' })).json();
const { data: form2 } = await db.from('forms').insert({ title: 'safety-e2e', is_active: true, definition: { fields: [{ id: 'f1', type: 'text', label: 'Name' }] }, notifications: [] }).select('id').single();
await fetch(`${base}/`, { method: 'POST', headers: { Origin: base }, body: new URLSearchParams({ _form: String(form2!.id), f1: 'hi' }) });
const { data: form3 } = await db.from('forms').insert({ title: 'safety-e2e', is_active: true, definition: { fields: [] }, notifications: [] }).select('id').single();
// a form with submissions made since the snapshot must survive "also delete"
r = await json('POST', '/api/admin/sync', { action: 'restoreBackup', site: 'here', path: snap.path, deleteSince: true }); const { job } = await r.json(); ok('restore queued', r.status === 202 && /^[a-f0-9]{32}$/.test(job), job);
// The jobs queue runs it; the screen polls, and so does this.
let st: any = {};
for (let i = 0; i < 120 && !['done', 'error'].includes(st.status); i++) {
  if (i) await new Promise((res) => setTimeout(res, 500));
  st = await (await fetch(`${base}/api/admin/sync?restoreJob=${job}`, { headers: H })).json();
}
ok('restore done', st.status === 'done', JSON.stringify(st).slice(0, 400));
ok('title restored', (await db.from('entries').select('title').eq('id', page!.id).single()).data?.title === page!.title);
ok('post made since deleted', !(await db.from('entries').select('id').eq('id', made2.id).maybeSingle()).data);
ok('form with submissions kept', !!(await db.from('forms').select('id').eq('id', form2!.id).maybeSingle()).data, JSON.stringify(st.result?.problems));
ok('empty form made since deleted', !(await db.from('forms').select('id').eq('id', form3!.id).maybeSingle()).data);
ok('unknown job', (await (await fetch(`${base}/api/admin/sync?restoreJob=${'0'.repeat(32)}`, { headers: H })).json()).status === 'error');
ok('job needs sign-in', (await fetch(`${base}/api/admin/sync?restoreJob=${job}`)).status === 401);

// clean up
await db.from('form_submissions').delete().eq('form_id', form2!.id); await db.from('forms').delete().eq('id', form2!.id);
await db.from('form_submissions').delete().eq('form_id', form!.id); await db.from('forms').delete().eq('id', form!.id);
await db.from('entries').delete().eq('id', made.id);
if (media) { await db.from('media').delete().eq('id', media.id); }
if (media) { const dir = media.path.slice(0, media.path.lastIndexOf('/')); const objs = (await db.storage.from('media').list(dir, { search: 'safety-e2e' })).data ?? []; await db.storage.from('media').remove(objs.map((o) => `${dir}/${o.name}`)); }
await db.storage.from('sync-backups').remove([snap.path, st.result?.backup, `jobs/${job}.json`].filter(Boolean));
process.exitCode = bad ? 1 : 0;
await closeLocalBindings();
