// Mailing through the running site, without Mailgun: emails go to the local mail catcher (LOCAL_MAIL_URL,
// SMTP on this machine), which is where a batch goes when Mailgun isn't set up. Turns Mailing on, makes
// lists; signs up on /subscribe/ and confirms by the emailed link; changes lists and unsubscribes (the
// page and one-click from another site); sends a campaign (test and real) and checks the email's
// variables, footer and tracked links; follows a link as a person and as a machine; posts signed Mailgun
// webhooks (and a replayed one); makes and approves a digest issue; signs up a member with the opt-in.
// Needs MAILGUN_WEBHOOK_SIGNING_KEY and MAIL_LINK_SECRET in .env, and no MAILGUN_API_KEY. Everything it
// makes is removed afterwards and the settings put back.
//   npx tsx --env-file=.env scripts/mailing-e2e.ts
import { createHmac } from 'node:crypto';
import { siteDb } from '../src/lib/db/site';
import { deleteUser } from '../src/lib/auth';

const base = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const mail = process.env.LOCAL_MAIL_URL ?? 'http://127.0.0.1:8025';
const db = siteDb();
let bad = 0;
const ok = (name: string, cond: unknown, extra = '') => (cond || bad++, console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${cond ? '' : extra}`));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
if (process.env.MAILGUN_API_KEY) throw new Error('Run this without MAILGUN_API_KEY: it reads the emails from the local mail catcher.');

const login = await fetch(`${base}/api/auth/login`, { method: 'POST', redirect: 'manual', headers: { Origin: base }, body: new URLSearchParams({ email: process.env.LOCAL_ADMIN_EMAIL!, password: process.env.LOCAL_ADMIN_PASSWORD! }) });
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const H = { Origin: base, Cookie: cookie };
const json = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const form = (path: string, body: Record<string, string | string[]>, headers: Record<string, string> = H) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const x of [v].flat()) p.append(k, x);
  return fetch(base + path, { method: 'POST', redirect: 'manual', headers, body: p });
};
/** A page as a visitor sees it (not signed in). */
const page = async (path: string) => (await fetch(base + path)).text();

// The mail catcher (Mailpit's API).
const inbox = async (to: string, subject = ''): Promise<{ Subject: string; HTML: string; Text: string } | null> => {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:${to}${subject ? ` subject:"${subject}"` : ''}`)}`).then((x) => x.json());
    const id = r.messages?.[0]?.ID;
    if (id) return fetch(`${mail}/api/v1/message/${id}`).then((x) => x.json());
    await sleep(500);
  }
  return null;
};
await fetch(`${mail}/api/v1/messages`, { method: 'DELETE' });

const stamp = Date.now().toString(36);
const who = `mailing-e2e-${stamp}@example.org`;
const { data: siteRow } = await db.from('settings').select('value').eq('key', 'site').single();
const before = siteRow!.value;
const putSettings = (site: Record<string, unknown>) => fetch(`${base}/api/admin/settings`, { method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ site }) });
const made = { lists: [] as number[], campaigns: [] as number[], digests: [] as number[], posts: [] as number[], users: [] as string[], segments: [] as number[] };

try {
  // Off: no pages.
  await putSettings({ ...before, mailing: { ...(before.mailing ?? {}), enabled: false } });
  ok('subscribe page is not found while mailing is off', (await fetch(`${base}/subscribe/`)).status === 404);
  // Lists, then Mailing on with a member list.
  for (const [name, pub] of [[`E2E News ${stamp}`, '1'], [`E2E Board ${stamp}`, '']]) await form('/api/admin/mailing/lists', { action: 'add', name, ...(pub ? { public: pub } : {}) });
  const { data: lists } = await db.from('mail_lists').select('id, name, public').like('name', `E2E % ${stamp}`).order('id');
  made.lists = (lists ?? []).map((l) => l.id);
  const [news, board] = made.lists;
  ok('lists made', made.lists.length === 2);
  let r = await putSettings({ ...before, members: { enabled: true, levels: [{ id: 'basic', name: 'Basic' }], signup: 'open', signupLevel: 'basic' }, mailing: { enabled: true, address: '1 Main St, Example Town', fromName: 'Example Town', memberLists: [news], fields: [{ label: 'Town' }, { label: 'Shirt size', type: 'choice', options: ['Small', 'Large'] }, { label: 'Email' }] } });
  ok('mailing on', r.ok, await r.text());

  // Sign up: the form, its outcome, the board list ignored, the confirmation email.
  let html = await page('/subscribe/');
  ok('subscribe page has the form', html.includes('action="/api/mail/subscribe"') && html.includes('c-subscribe__consent'));
  ok('cross-site form posts are refused', (await form('/api/mail/subscribe', { email: who, lists: String(news) }, { Origin: 'https://evil.example' })).status === 403);
  ok('a field named like a built-in tag is left out', JSON.stringify((await db.from('settings').select('value').eq('key', 'site').single()).data?.value.mailing.fields.map((f: any) => f.key)) === '["town","shirt_size"]');
  r = await form('/api/mail/subscribe', { email: who, first_name: 'Ann', last_name: 'E2E & Co', cf_town: 'Riverton', cf_shirt_size: 'large', cf_other: 'x', lists: [String(news), String(board)], back: '/subscribe/', consent: 'I agree' }, { Origin: base });
  ok('sign-up answers with "check your email"', r.status === 303 && r.headers.get('location')?.includes('subscribe=sent'), `${r.status} ${r.headers.get('location')}`);
  const { data: c1 } = await db.from('contacts').select('id, status, consent_text, first_name, last_name, name, attributes').eq('email', who).single();
  ok('first and last name and the site’s fields kept', c1?.first_name === 'Ann' && c1.last_name === 'E2E & Co' && c1.name === 'Ann E2E & Co' && c1.attributes.town === 'Riverton' && c1.attributes.shirt_size === 'Large' && Object.keys(c1.attributes).length === 2, JSON.stringify(c1));
  const { data: cl1 } = await db.from('contact_lists').select('list_id, status').eq('contact_id', c1!.id);
  ok('contact waits for confirmation, on the public list only', c1?.status === 'pending' && cl1?.length === 1 && cl1[0].list_id === news && cl1[0].status === 'pending', JSON.stringify(cl1));
  const confirmMail = await inbox(who, 'Confirm');
  const link = confirmMail?.HTML.match(/href="([^"]*\?confirm=[^"]+)"/)?.[1].replace(/&amp;/g, '&');
  ok('confirmation email with its link', !!link, confirmMail?.Subject);
  html = await page(new URL(link!).pathname + new URL(link!).search);
  ok('the link asks before confirming', html.includes('Confirm my subscription') && (await db.from('contacts').select('status').eq('id', c1!.id).single()).data?.status === 'pending');
  r = await form('/api/mail/confirm', { confirm: new URL(link!).searchParams.get('confirm')! }, { Origin: base });
  const prefs = r.headers.get('location')!;
  ok('confirmed', r.status === 303 && prefs.includes('m=confirmed') && (await db.from('contacts').select('status').eq('id', c1!.id).single()).data?.status === 'subscribed');
  html = await page(prefs);
  ok('preferences show the list ticked', html.includes('Your subscription is confirmed') && new RegExp(`value="${news}" checked`).test(html));
  const t = new URL(prefs, base).searchParams.get('t')!;
  ok('a bad token gets nothing', (await page(`/email-preferences/?t=${c1!.id}.AAAAAAAAAAAAAAAAAAAAAA`)).includes('Use the link at the bottom'));

  // A campaign: test send, then the real one.
  r = await json('/api/admin/mailing/campaigns', { action: 'create' });
  const cid = (await r.json()).id;
  made.campaigns.push(cid);
  const design = { root: { props: { preheader: 'News for {first_name}' } }, content: [{ type: 'Heading', props: { id: 'h1', text: 'Hello {first_name|friend} {last_name}', level: 1 } }, { type: 'Text', props: { id: 't1', html: '<p>See <a href="https://example.org/page?a=1&amp;b=2">our page</a>.</p>' } }, { type: 'Button', props: { id: 'b1', label: 'About us', url: '/about/' } }] };
  r = await json('/api/admin/mailing/campaigns', { action: 'save', id: cid, campaign: { name: `E2E ${stamp}`, subject: `E2E ${stamp} for {first_name} in {town|somewhere}`, list_ids: [news], design, track_links: true, utm: true, audience: {} } });
  ok('campaign saved', r.ok, await r.text());
  r = await json('/api/admin/mailing/campaigns', { action: 'count', id: cid });
  ok('counts its audience', (await r.json()).count >= 1);
  r = await json('/api/admin/mailing/campaigns', { action: 'test', id: cid });
  const test = await inbox(process.env.LOCAL_ADMIN_EMAIL!, `[Test] E2E ${stamp}`);
  ok('test send arrives, a field without a value taking its fallback', r.ok && !!test && test.Subject.endsWith('in somewhere'), test?.Subject ?? (await r.text()));
  r = await json('/api/admin/mailing/campaigns', { action: 'send', id: cid });
  ok('send accepted', r.ok, await r.text());
  for (let i = 0; i < 60 && (await db.from('campaigns').select('status').eq('id', cid).single()).data?.status !== 'sent'; i++) await sleep(500);
  const { data: sentRow } = await db.from('campaigns').select('status, recipients, error').eq('id', cid).single();
  ok('campaign sent', sentRow?.status === 'sent', JSON.stringify(sentRow));
  const email = await inbox(who, `E2E ${stamp}`);
  ok('subject and heading carry the names and a field, escaped in HTML', email?.Subject === `E2E ${stamp} for Ann in Riverton` && email.HTML.includes('Hello Ann E2E &amp; Co') && !email.HTML.includes('%recipient'), email?.Subject);
  ok('footer: address, unsubscribe, preferences', !!email?.HTML.includes('1 Main St, Example Town') && email.HTML.includes('/unsubscribe/?t=') && email.HTML.includes('/email-preferences/?t='));
  const tracked = [...(email?.HTML.matchAll(/href="([^"]*\/m\/c\/\d+\/[^"]+)"/g) ?? [])].map((m) => m[1]);
  ok('links are tracked, with the hidden link', tracked.length === 3, String(tracked.length));
  ok('the text part has the tracked links and no hidden one', !!email?.Text.includes('/m/c/') && (email.Text.match(/\/m\/c\//g) ?? []).length === 2, email?.Text);
  // Delivered (signed webhook), then a person's click, then a machine's.
  const key = process.env.MAILGUN_WEBHOOK_SIGNING_KEY!;
  const hook = (event: string, extra: Record<string, unknown> = {}, token = `${stamp}-${Math.random()}`) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return fetch(`${base}/api/mailgun/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signature: { timestamp, token, signature: createHmac('sha256', key).update(timestamp + token).digest('hex') }, 'event-data': { id: `${event}-${stamp}-${Math.random()}`, event, recipient: who, timestamp: Date.now() / 1000 - 60, 'user-variables': { campaign_id: String(cid) }, ...extra } }) });
  };
  r = await hook('delivered', {}, `tok-${stamp}`);
  ok('delivered webhook taken', r.status === 200, await r.text());
  r = await hook('delivered', {}, `tok-${stamp}`);
  ok('a replayed token is refused', r.status === 406);
  r = await fetch(`${base}/api/mailgun/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signature: { timestamp: String(Math.floor(Date.now() / 1000)), token: 'x', signature: '0'.repeat(64) }, 'event-data': { id: 'x', event: 'delivered' } }) });
  ok('a bad signature is refused', r.status === 406);
  await hook('opened', { ip: '203.0.113.5', 'client-info': { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Thunderbird' } });
  const first = tracked[0].replace(/&amp;/g, '&');
  const pathOf = (u: string) => new URL(u).pathname;
  r = await fetch(base + pathOf(first), { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15' } });
  ok('a link redirects to its address with UTM only on the site', r.status === 302 && r.headers.get('location') === 'https://example.org/page?a=1&b=2', r.headers.get('location') ?? '');
  r = await fetch(base + pathOf(tracked[1].replace(/&amp;/g, '&')), { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605.1.15' } });
  const loc = r.headers.get('location') ?? '';
  ok('a site link gets UTM and the #mc fragment', loc.includes('/about/') && loc.includes('utm_source=newsletter') && /#mc=\d+\.[\w-]{22}$/.test(loc), loc);
  r = await fetch(`${base}/api/mail/seen`, { method: 'POST', headers: { Origin: base, 'content-type': 'text/plain' }, body: loc.split('#mc=')[1] });
  ok('the page reports the interaction', r.status === 204);
  r = await fetch(base + pathOf(first), { method: 'HEAD', redirect: 'manual' });
  ok('HEAD redirects too', r.status === 302);
  const { data: clicks } = await db.from('link_clicks').select('method, verdict, reasons, confirmed_at').eq('campaign_id', cid).order('id');
  ok('verdicts: person, person (confirmed), machine', clicks?.map((k) => k.verdict).join(',') === 'likely_human,human,machine', JSON.stringify(clicks));
  const { data: stats } = await db.rpc('campaign_stats', { p_id: cid });
  ok('stats: delivered, opened, clicked, confirmed', stats.delivered === 1 && stats.opened === 1 && stats.clicked === 1 && stats.confirmed === 1, JSON.stringify(stats));
  ok('a made-up link is not found', (await fetch(`${base}/m/c/999999999/x`, { redirect: 'manual' })).status === 404);

  // Preferences: off the list, back on; then one-click unsubscribe from elsewhere.
  r = await form('/api/mail/preferences', { t, back: '/email-preferences/', action: 'save' }, { Origin: base });
  ok('unticking every list unsubscribes from it', r.status === 303 && (await db.from('contact_lists').select('status').eq('contact_id', c1!.id).eq('list_id', news).single()).data?.status === 'unsubscribed');
  r = await form('/api/mail/preferences', { t, back: '/email-preferences/', action: 'save', lists: String(news) }, { Origin: base });
  ok('ticking it again', (await db.from('contact_lists').select('status').eq('contact_id', c1!.id).eq('list_id', news).single()).data?.status === 'subscribed');
  html = await page(`/unsubscribe/?t=${t}&c=${cid}`);
  ok('unsubscribe page asks first', html.includes('Unsubscribe from all') && (await db.from('contacts').select('status').eq('id', c1!.id).single()).data?.status === 'subscribed');
  r = await fetch(`${base}/api/mail/unsubscribe?t=${encodeURIComponent(t)}&c=${cid}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', Origin: 'https://mail.google.com' }, body: 'List-Unsubscribe=One-Click' });
  ok('one-click unsubscribe from another site', r.status === 200 && (await db.from('contacts').select('status').eq('id', c1!.id).single()).data?.status === 'unsubscribed', String(r.status));
  ok('the campaign counts the unsubscribe', (await db.rpc('campaign_stats', { p_id: cid })).data.unsubscribed === 1);
  r = await json('/api/admin/mailing/campaigns', { action: 'count', id: cid });
  ok('unsubscribed people are out of the audience', (await r.json()).count === 0);
  // A complaint (after re-subscribing through preferences): suppressed.
  await form('/api/mail/preferences', { t, back: '/email-preferences/', action: 'save', lists: String(news) }, { Origin: base });
  await hook('complained');
  ok('a complaint marks them and suppresses the address', (await db.from('contacts').select('status').eq('id', c1!.id).single()).data?.status === 'complained' && !!(await db.from('mail_suppressions').select('reason').limit(1)).data?.length);
  html = await page(`/email-preferences/?t=${t}`);
  ok('a complained address can’t tick lists again', html.includes('We don’t send to'));

  // A digest: new entries since the last issue, an issue waiting for approval, then sent.
  const { data: post } = await db.from('entries').insert({ type: 'post', slug: `mailing-e2e-${stamp}`, title: `Digest item ${stamp}`, excerpt: 'Something new.', status: 'publish', published_at: new Date().toISOString(), content: { root: { props: {} }, content: [] } }).select('id').single();
  made.posts.push(post!.id);
  const reader = `mailing-e2e-reader-${stamp}@example.org`;
  await form('/api/admin/mailing/contacts', { action: 'add', email: reader, first_name: 'Rae', last_name: 'Reader', list: String(news), source: 'e2e' });
  ok('added with first and last name', (await db.from('contacts').select('name').eq('email', reader).single()).data?.name === 'Rae Reader');
  r = await json('/api/admin/mailing/digests', { action: 'create' });
  const did = (await r.json()).id;
  made.digests.push(did);
  const { data: dg } = await db.from('digests').select('*').eq('id', did).single();
  r = await json('/api/admin/mailing/digests', { action: 'save', id: did, digest: { ...dg, name: `E2E digest ${stamp}`, list_ids: [news], enabled: true, mode: 'review' } });
  ok('digest saved and on', r.ok, await r.text());
  r = await json('/api/admin/mailing/digests', { action: 'issue', id: did });
  const issueText = await r.text();
  const { data: issue } = await db.from('campaigns').select('id, status, subject').eq('digest_id', did).single();
  if (issue) made.campaigns.push(issue.id);
  ok('an issue waits for approval', issue?.status === 'review', issueText);
  r = await json('/api/admin/mailing/campaigns', { action: 'approve', id: issue!.id });
  ok('approved', r.ok && (await db.from('campaigns').select('status').eq('id', issue!.id).single()).data?.status === 'scheduled', await r.text());
  r = await json('/api/admin/mailing/campaigns', { action: 'send', id: issue!.id });
  for (let i = 0; i < 60 && (await db.from('campaigns').select('status').eq('id', issue!.id).single()).data?.status !== 'sent'; i++) await sleep(500);
  const digestMail = await inbox(reader);
  ok('the digest lists the new post', !!digestMail?.HTML.includes(`Digest item ${stamp}`), digestMail?.Subject ?? 'no email');

  // Members: sign-up with the opt-in, then the account page's email choices.
  const member = `mailing-e2e-member-${stamp}@example.org`;
  html = await page('/account/');
  ok('member sign-up offers the list', html.includes('name="mail_optin"'));
  r = await form('/api/members/signup', { name: 'Mem Ber', email: member, password: 'member-password-1', confirm: 'member-password-1', mail_optin: '1' }, { Origin: base });
  const memberCookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { data: mc } = await db.from('contacts').select('id, status, consent_source, first_name, last_name').eq('email', member).maybeSingle();
  ok('the opt-in signs them up, waiting for confirmation, their name split', mc?.status === 'pending' && mc.consent_source === 'members:signup' && mc.first_name === 'Mem' && mc.last_name === 'Ber', JSON.stringify(mc));
  const { data: mu } = await db.from('members').select('user_id').eq('email', member).maybeSingle();
  if (mu) made.users.push(mu.user_id);
  html = await (await fetch(`${base}/account/`, { headers: { Cookie: memberCookie } })).text();
  ok('the account page shows their email choices', html.includes('Save email choices') && html.includes('waiting for you to confirm'));

  // Segments: an import with tags and a field column, a segment by tag, a campaign to it only.
  const farmer = `mailing-e2e-farm-${stamp}@example.org`;
  const shop = `mailing-e2e-shop-${stamp}@example.org`;
  const csv = `email,first name,last name,tags,Town,Shirt Size,Hobby\n${farmer},Fay,Farmer,farm;Market,Brookville,small,Goats\n${shop},Sam,Shop,shop,Lakeside,XXL,\n`;
  const fd = new FormData();
  for (const [k, v] of Object.entries({ action: 'import', list: String(made.lists[0]), source: 'e2e import', tags: 'e2e' })) fd.append(k, v);
  fd.append('file', new File([csv], 'people.csv', { type: 'text/csv' }));
  r = await fetch(`${base}/api/admin/mailing/contacts`, { method: 'POST', redirect: 'manual', headers: H, body: fd });
  ok('CSV import with tags and a field', r.status === 303 && decodeURIComponent(r.headers.get('location') ?? '').includes('2 added'), decodeURIComponent(r.headers.get('location') ?? ''));
  const { data: fay } = await db.from('contacts').select('id, tags, attributes, first_name, last_name').eq('email', farmer).single();
  const { data: sam } = await db.from('contacts').select('attributes').eq('email', shop).single();
  ok('tags and fields stored: a column named like a field fills it, others are fields of their own', fay?.tags.join() === 'farm,market,e2e' && fay?.attributes.town === 'Brookville' && fay.attributes.shirt_size === 'Small' && fay.attributes.hobby === 'Goats' && Object.keys(fay.attributes).length === 3 && fay?.first_name === 'Fay' && fay.last_name === 'Farmer', JSON.stringify(fay));
  ok('a value that isn’t one of the options is left out', !('shirt_size' in (sam?.attributes ?? {})), JSON.stringify(sam));
  const page1 = await (await fetch(`${base}/admin/mailing-lists/contacts/${fay!.id}/`, { headers: { Cookie: cookie } })).text();
  ok('the contact page has the fields as inputs', /name="cf_shirt_size"/.test(page1) && /<option selected[^>]*>Small<\/option>/.test(page1.replace(/ data-astro-source-[a-z]+="[^"]*"/g, '')) && page1.includes('value="Goats"'));
  const exported = await (await fetch(`${base}/api/admin/mailing/contacts?export=csv`, { headers: { Cookie: cookie } })).text();
  ok('the export has first and last name and the fields as columns', exported.startsWith('email,first_name,last_name,status,lists,tags,town,shirt_size,') && exported.includes(`${farmer},Fay,Farmer,subscribed`));
  r = await json('/api/admin/mailing/segments', { action: 'create' });
  const sid = (await r.json()).id;
  made.segments.push(sid);
  r = await json('/api/admin/mailing/segments', { action: 'save', id: sid, segment: { name: `E2E farms ${stamp}`, rules: { match: 'all', rules: [{ type: 'tag', tags: ['FARM'] }, { type: 'field', key: 'town', op: 'contains', value: 'ville' }] } } });
  ok('segment saved', r.ok, await r.text());
  r = await json('/api/admin/mailing/segments', { action: 'people', rules: { match: 'all', rules: [{ type: 'tag', tags: ['farm'] }, { type: 'field', key: 'town', op: 'contains', value: 'ville' }] } });
  const seg = await r.json();
  ok('segment matches the farm only', seg.people.some((p: any) => p.email === farmer) && !seg.people.some((p: any) => p.email === shop), JSON.stringify(seg));
  r = await json('/api/admin/mailing/campaigns', { action: 'create' });
  const scid = (await r.json()).id;
  made.campaigns.push(scid);
  await json('/api/admin/mailing/campaigns', { action: 'save', id: scid, campaign: { name: `E2E seg ${stamp}`, subject: `E2E segment ${stamp}`, list_ids: [made.lists[0]], design, segment_id: sid, track_links: false, audience: {} } });
  r = await json('/api/admin/mailing/campaigns', { action: 'count', id: scid });
  ok('the campaign counts its segment only', (await r.json()).count === 1);
  r = await json('/api/admin/mailing/segments', { action: 'delete', id: sid });
  ok('a segment in use can’t be deleted', r.status === 400, await r.text());
  await json('/api/admin/mailing/campaigns', { action: 'send', id: scid });
  for (let i = 0; i < 60 && (await db.from('campaigns').select('status').eq('id', scid).single()).data?.status !== 'sent'; i++) await sleep(500);
  ok('the segment gets it, the rest of the list doesn’t', !!(await inbox(farmer, `E2E segment ${stamp}`)) && !(await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:${shop} subject:"E2E segment ${stamp}"`)}`).then((x) => x.json())).messages?.length);
  // The views: a list's subscribers, a tag, the segments, a segment, a campaign's recipients.
  const admin = async (path: string) => (await fetch(base + path, { headers: { Cookie: cookie } })).text();
  ok('a list’s subscribers', (await admin(`/admin/mailing-lists/?tab=contacts&list=${made.lists[0]}`)).includes('Subscribers to E2E News'));
  ok('filtered by tag', (await admin('/admin/mailing-lists/?tab=contacts&tag=farm')).includes(farmer));
  ok('segments tab counts', (await admin('/admin/mailing-lists/?tab=segments')).includes(`E2E farms ${stamp}`));
  ok('segment page', (await admin(`/admin/mailing-lists/segments/${sid}/`)).includes(`E2E seg ${stamp}`));
  const rec = await admin(`/admin/mailing-lists/campaigns/${scid}/?who=all`);
  ok('campaign recipients', rec.includes('Recipients') && rec.includes(farmer) && !rec.includes(shop));
} finally {
  // Clean up.
  for (const id of made.campaigns) await db.from('campaigns').delete().eq('id', id);
  for (const id of made.digests) await db.from('digests').delete().eq('id', id);
  for (const id of made.segments) await db.from('mail_segments').delete().eq('id', id);
  for (const id of made.posts) await db.from('entries').delete().eq('id', id);
  const { data: people } = await db.from('contacts').select('id, email').like('email', `mailing-e2e-%${stamp}@example.org`);
  for (const p of people ?? []) await db.from('contacts').delete().eq('id', p.id);
  const { emailHash } = await import('../src/lib/mailing/tokens');
  for (const p of people ?? []) await db.from('mail_suppressions').delete().eq('email_hash', emailHash(p.email));
  for (const id of made.lists) await db.from('mail_lists').delete().eq('id', id);
  for (const id of made.users) {
    await db.from('members').delete().eq('user_id', id);
    await deleteUser(id);
  }
  await db.from('settings').update({ value: before }).eq('key', 'site');
  await db.from('settings').delete().eq('key', 'mailing');
}
process.exitCode = bad ? 1 : 0;
