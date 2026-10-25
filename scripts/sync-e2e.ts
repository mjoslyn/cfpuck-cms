// Sync safeguards, through the running site, pushing pages to the other copy (SYNC_REMOTE_*): a row
// made on the target since Compare stops the sync, and undoing a sync that stopped halfway deletes only
// the rows it wrote. It writes to the other copy, so that must be a local stack too, with no pages yet
// (a second `supabase start` on other ports).
//   npx tsx --env-file=.env scripts/sync-e2e.ts
import { createClient } from '@supabase/supabase-js';
import { siteDb } from '../src/lib/db/site';
const base = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.SYNC_REMOTE_URL ?? '')) throw new Error('SYNC_REMOTE_URL must be a local stack: this test writes to it.');
const remote = createClient(process.env.SYNC_REMOTE_URL!, process.env.SYNC_REMOTE_SERVICE_KEY!);
let bad = 0;
const ok = (name: string, cond: unknown, extra = '') => (cond || bad++, console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`));
const login = await fetch(`${base}/api/auth/login`, { method: 'POST', redirect: 'manual', headers: { Origin: base }, body: new URLSearchParams({ email: process.env.LOCAL_ADMIN_EMAIL!, password: process.env.LOCAL_ADMIN_PASSWORD! }) });
const H = { Origin: base, Cookie: login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), 'content-type': 'application/json' };
const post = async (body: unknown) => { const r = await fetch(`${base}/api/admin/sync`, { method: 'POST', headers: H, body: JSON.stringify(body) }); const t = await r.text(); return { status: r.status, body: (() => { try { return JSON.parse(t); } catch { return t; } })() }; };
const info = await (await fetch(`${base}/api/admin/sync`, { headers: H })).json();
const group = 'type:page';
const plan = (await post({ action: 'plan', direction: 'push', groups: [group] })).body;
const g = plan.groups[0]; const added: string[] = g.added.map((i: any) => i.key);
if (added.length < 2) throw new Error('Needs two pages here that the other copy lacks.');
const [a, b] = added;
const row = (id: string, slug: string) => ({ id: Number(id), type: 'page', slug, title: slug, status: 'draft', content: { content: [], root: {} } });
const items = [{ group, added, changed: [] }];
// a row made on the target since Compare
let r = await remote.from('entries').insert(row(b, 'made-since-compare')); ok('intruder inserted', !r.error, r.error?.message);
let res = await post({ action: 'backup', direction: 'push', items }); ok('backup refuses: changed since Compare', res.status === 400 && /changed since Compare/.test(res.body), String(res.body));
await remote.from('entries').delete().eq('id', Number(b));
res = await post({ action: 'backup', direction: 'push', items }); const path = res.body.path; ok('backup saved', res.status === 200 && path, JSON.stringify(res.body));
// the sync stops after its first row
res = await post({ action: 'apply', direction: 'push', groups: [group], group, keys: [a], backup: path }); ok('one row written', res.body.written === 1, JSON.stringify(res.body));
const w = await remote.storage.from('sync-backups').download(`written/${path}`); ok('written recorded', JSON.stringify(JSON.parse(await w.data!.text())) === JSON.stringify({ [group]: [a] }), await w.data!.text());
r = await remote.from('entries').insert(row(b, 'made-by-hand')); ok('hand-made row takes the next id', !r.error, r.error?.message);
res = await post({ action: 'restoreBackup', site: 'remote', path }); 
const st = await (await fetch(`${base}/api/admin/sync?restoreJob=${res.body.job}`, { headers: H })).json(); ok('undo done', st.status === 'done', JSON.stringify(st).slice(0, 300));
ok('synced row deleted', !(await remote.from('entries').select('id').eq('id', Number(a)).maybeSingle()).data);
ok('hand-made row kept', (await remote.from('entries').select('slug').eq('id', Number(b)).maybeSingle()).data?.slug === 'made-by-hand');
await remote.from('entries').delete().eq('id', Number(b));
await remote.storage.from('sync-backups').remove([path, `written/${path}`, st.result?.backup].filter(Boolean));
const local = siteDb();
await local.storage.from('sync-backups').remove([`jobs/${res.body.job}.json`]);
process.exitCode = bad ? 1 : 0;
