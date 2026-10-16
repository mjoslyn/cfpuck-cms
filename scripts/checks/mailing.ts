// Mailing without a database: signed links, the campaign renderer (variables, escaping, the footer, link
// tracking and the hidden link), webhook signatures, click verdicts, digest due times across DST, and CSV.
//   npx tsx scripts/checks/mailing.ts
import { createHmac } from 'node:crypto';

process.env.MAIL_LINK_SECRET ??= 'check-secret';
process.env.MAILGUN_WEBHOOK_SIGNING_KEY ??= 'check-signing-key';

const { sign, verify, emailHash } = await import('../../src/lib/mailing/tokens');
const { renderCampaign, recipientValues, findLinks, trackLinks, addHoneypot, plainText, trackText, withUtm, utmLinks } = await import('../../src/lib/mailing/render');
const { webhookSigned } = await import('../../src/lib/mailing/mailgun');
const { judge, ipPrefix, openVerdict } = await import('../../src/lib/mailing/clicks');
const { digestDue, isoWeek } = await import('../../src/lib/mailing/digest');
const { parseCsv, contactsCsv } = await import('../../src/lib/mailing/contacts');
const { unhealthy } = await import('../../src/lib/mailing/state');

let bad = 0;
const want = (name: string, ok: boolean, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `: ${detail}` : ''}`);
};

// Signed links: right purpose only, no changing the id.
const t = sign('manage', 42);
want('a token verifies', verify('manage', t) === 42);
want('another purpose refuses it', verify('confirm', t) === null);
want('a changed id is refused', verify('manage', t.replace(/^42/, '43')) === null);
want('junk is refused', verify('manage', '42.short') === null && verify('manage', undefined) === null);
want('address hashes ignore case', emailHash('Ann@X.org ') === emailHash('ann@x.org'));

// Rendering: variables for names (escaped in HTML, plain in text), fallbacks, the footer.
const design = {
  root: { props: { preheader: 'Hi {first_name}' } },
  content: [
    { type: 'Heading', props: { id: 'h', text: 'News for {first_name|friend}', level: 1 } },
    { type: 'Text', props: { id: 't', html: '<p>Dear {name|reader}, see <a href="https://example.org/page?a=1&amp;b=2">our page</a> and <a href="{preferences_url}">settings</a>.</p>' } },
    { type: 'Image', props: { id: 'i', src: '/media/x.jpg', alt: 'Cat', href: 'https://example.org/cat' } },
    { type: 'Button', props: { id: 'b', label: 'Go', url: '/events/' } },
  ],
};
const r = renderCampaign({ campaignId: 7, subject: 'Hello {first_name|there} & co', design: design as any, siteName: 'Town & Co', address: '1 Main St\nTown', origin: 'https://site.example' });
want('subject uses the plain variable', /^Hello %recipient\.v\d+% & co$/.test(r.subject), r.subject);
want('HTML uses escaped variables', /News for %recipient\.v\d+_h%/.test(r.html) && /Dear %recipient\.v\d+_h%/.test(r.html));
want('footer carries the address and links', r.html.includes('1 Main St, Town') && r.html.includes('https://site.example/unsubscribe/?t=%recipient.t%&c=7') && r.html.includes('https://site.example/email-preferences/?t=%recipient.t%'));
want('site name escaped in the footer', r.html.includes('Town &amp; Co'));
want('text part uses plain variables', !/%recipient\.v\d+_h%/.test(r.text) && /%recipient\.v\d+%/.test(r.text) && r.text.includes('Unsubscribe'));
const v = recipientValues(r.vars, { email: 'a@x.org', name: '<Al> & "Bo"' }, { t: 'T', ct: 'C' });
const first = r.vars.find((x) => x.field === 'first_name' && x.fallback === 'friend')!;
want('a value is escaped for HTML only', v[`${first.name}_h`] === '&lt;Al&gt;' && v[first.name] === '<Al>');
const empty = recipientValues(r.vars, { email: 'a@x.org', name: '' }, { t: 'T', ct: 'C' });
want('an empty name takes the fallback', empty[first.name] === 'friend' && empty[r.vars.find((x) => x.fallback === 'reader')!.name] === 'reader');

// Links: the web links in order, not the preferences link; tracked, with the hidden link in HTML only.
const found = findLinks(r.html);
want('links found in order', found.map((f) => f.url).join(' ') === 'https://example.org/page?a=1&b=2 https://example.org/cat https://site.example/events/', found.map((f) => f.url).join(' '));
want('an image link is labelled by its alt', found[1].label === 'Image: Cat');
const tracked = trackLinks(r.html, 'https://site.example', [11, 12, 13]);
want('links go through the site', tracked.includes('href="https://site.example/m/c/11/%recipient.ct%"') && !tracked.includes('example.org/page') && tracked.includes('/email-preferences/?t=%recipient.t%'));
const text = plainText(tracked);
const withTrap = addHoneypot(tracked, 'https://site.example', 99);
want('the hidden link is in the HTML', withTrap.includes('/m/c/99/%recipient.ct%') && withTrap.includes('aria-hidden="true"'));
want('the text part has no hidden link', !text.includes('/m/c/99/') && text.includes('/m/c/11/'));
want('own text links are tracked', trackText('See https://example.org/page?a=1&b=2. Or https://other.example', [{ id: 11, url: 'https://example.org/page?a=1&b=2', original: 'https://example.org/page?a=1&b=2' }], 'https://site.example') === 'See https://site.example/m/c/11/%recipient.ct%. Or https://other.example');
want('UTM only on the site’s own links', withUtm('https://site.example/x', 'https://site.example', 'june').includes('utm_campaign=june') && withUtm('https://other.example/x', 'https://site.example', 'june') === 'https://other.example/x' && withUtm('https://site.example/x?utm_source=a', 'https://site.example', 'june') === 'https://site.example/x?utm_source=a');
want('UTM without tracking keeps &amp;', utmLinks('<a href="https://site.example/x?a=1&amp;b=2">x</a>', 'https://site.example', 'c').includes('a=1&amp;b=2&amp;utm_source=newsletter'));

// Webhook signatures: Mailgun's HMAC, fresh, well formed.
const now = Date.now();
const ts = String(Math.floor(now / 1000));
const sig = (timestamp: string, token: string) => createHmac('sha256', 'check-signing-key').update(timestamp + token).digest('hex');
want('a signed webhook passes', webhookSigned({ timestamp: ts, token: 'abc', signature: sig(ts, 'abc') }, now));
want('a wrong signature fails', !webhookSigned({ timestamp: ts, token: 'abc', signature: sig(ts, 'abd') }, now));
want('a stale one fails', !webhookSigned({ timestamp: String(Math.floor(now / 1000) - 600), token: 'abc', signature: sig(String(Math.floor(now / 1000) - 600), 'abc') }, now));

// Clicks.
const at = (s: number) => new Date(Date.UTC(2026, 9, 16, 12, 0, s)).toISOString();
const click = (id: number, link: number, s: number, extra: Partial<Parameters<typeof judge>[0][number]> = {}) => ({ id, link_id: link, at: at(s), method: 'GET', user_agent: 'Mozilla/5.0 (Macintosh) Safari', ip_prefix: '203.0.113.0/24', honeypot: false, scannerIp: false, confirmed_at: null, ...extra });
const verdicts = (list: ReturnType<typeof judge>) => list.map((j) => j.verdict).join(',');
want('a lone click is likely a person', verdicts(judge([click(1, 1, 30)], at(0))) === 'likely_human');
want('HEAD is a machine', verdicts(judge([click(1, 1, 30, { method: 'HEAD' })], null)) === 'machine');
want('a scanner agent is a machine', verdicts(judge([click(1, 1, 30, { user_agent: 'Mozilla/5.0 (compatible; Barracuda Sentinel)' })], null)) === 'machine');
want('a scanner address is a machine', verdicts(judge([click(1, 1, 30, { scannerIp: true })], null)) === 'machine');
want('a burst of 3 links is a machine', verdicts(judge([click(1, 1, 30), click(2, 2, 31), click(3, 3, 32)], null)) === 'machine,machine,machine');
want('right after delivery is a machine', verdicts(judge([click(1, 1, 5)], at(0))) === 'machine');
want('right after delivery, then a person later: the person counts', verdicts(judge([click(1, 1, 5, { ip_prefix: '198.51.100.0/24' }), click(2, 1, 400)], at(0))) === 'likely_human,likely_human');
const trap = judge([click(1, 1, 20), click(2, 9, 21, { honeypot: true }), click(3, 2, 500, { ip_prefix: '198.51.100.0/24' })], null);
want('the hidden link takes nearby clicks with it, not later ones', verdicts(trap) === 'machine,machine,likely_human' && trap[2].reasons.includes('later-other-network'), JSON.stringify(trap));
want('an interaction confirms a person', verdicts(judge([click(1, 1, 5, { confirmed_at: at(9) })], at(0))) === 'human');
want('network prefixes', ipPrefix('203.0.113.77') === '203.0.113.0/24' && ipPrefix('2001:db8:1:2::5') === '2001:db8:1::/48' && ipPrefix('::ffff:203.0.113.9') === '203.0.113.0/24');
want('Apple’s proxy opens are privacy', openVerdict('17.58.1.2', 'Mozilla/5.0') === 'privacy' && openVerdict('203.0.113.4', 'Mozilla/5.0 (Windows NT 10.0)') === 'likely_human' && openVerdict('66.249.66.1', 'Mozilla/5.0') === 'machine');

// Digest due times, in New York across the DST change (Sunday November 1, 2026).
const tz = 'America/New_York';
const d = { weekday: 4, send_time: '09:00', last_run_key: null as string | null };
want('ISO weeks', isoWeek('2026-10-15') === '2026-W42' && isoWeek('2027-01-01') === '2026-W53' && isoWeek('2026-12-28') === '2026-W53');
want('not due before its time', !digestDue(d, new Date('2026-10-15T12:59:00Z'), tz).due);
want('due at its time (EDT)', digestDue(d, new Date('2026-10-15T13:00:00Z'), tz).due && digestDue(d, new Date('2026-10-15T13:00:00Z'), tz).monday === '2026-10-12');
want('not due again that week', !digestDue({ ...d, last_run_key: '2026-W42' }, new Date('2026-10-15T15:00:00Z'), tz).due);
want('not due more than a day late', !digestDue(d, new Date('2026-10-16T13:30:00Z'), tz).due);
want('due at 9:00 EST after the change', !digestDue(d, new Date('2026-11-05T13:30:00Z'), tz).due && digestDue(d, new Date('2026-11-05T14:00:00Z'), tz).due);
want('a Sunday digest falls in the week ending that Sunday', digestDue({ ...d, weekday: 0 }, new Date('2026-10-18T13:00:00Z'), tz).due && digestDue({ ...d, weekday: 0 }, new Date('2026-10-18T13:00:00Z'), tz).key === '2026-W42');

// Health thresholds.
const base = { recipients: 1000, queued: 0, dropped: 0, sent: 1000, delivered: 600, bounced: 0, complained: 0, unsubscribed: 0, opened: 0, clicked: 0, confirmed: 0, machine: 0 };
want('healthy', unhealthy(base, { complaintRate: 0.1, bounceRate: 2 }) === '');
want('complaints pause', unhealthy({ ...base, complained: 2 }, { complaintRate: 0.1, bounceRate: 2 }).startsWith('complaint rate'));
want('too few deliveries to judge', unhealthy({ ...base, delivered: 100, complained: 5 }, { complaintRate: 0.1, bounceRate: 2 }) === '');
want('bounces pause', unhealthy({ ...base, bounced: 30 }, { complaintRate: 0.1, bounceRate: 2 }).startsWith('bounce rate'));

// CSV.
const rows = parseCsv('﻿Email;Name\nann@x.org;"Smith; Ann"\n\nbo@x.org;Bo\n');
want('CSV with semicolons and quotes', rows.length === 2 && rows[0].email === 'ann@x.org' && rows[0].name === 'Smith; Ann', JSON.stringify(rows));
want('CSV without a header', parseCsv('ann@x.org,Ann\nbo@x.org\n').map((r) => r.email).join() === 'ann@x.org,bo@x.org');
want('export guards formulas', contactsCsv([{ id: 1, email: 'a@x.org', name: '=HYPERLINK("x")', status: 'subscribed', lists: ['News'], consent_source: '', consent_at: null, confirmed_at: null, unsubscribed_at: null, created_at: '' } as any]).includes(`"'=HYPERLINK(""x"")"`));

// Segments: rules cleaned (empty ones dropped, values bounded), tags normalised, rules in words.
const { cleanRules, cleanTags, describeSegment, fieldKey } = await import('../../src/lib/mailing/segments');
const rules = cleanRules({ match: 'any', rules: [{ type: 'tag', tags: 'Farm, VIP;farm' }, { type: 'list', lists: [] }, { type: 'field', key: 'Business Type', op: 'equals', value: 'Dairy' }, { type: 'opened', days: 99999, not: true }, { type: 'nope' }] });
want('rules cleaned', JSON.stringify(rules) === JSON.stringify({ match: 'any', rules: [{ type: 'tag', tags: ['farm', 'vip'] }, { type: 'field', key: 'business_type', op: 'equals', value: 'Dairy' }, { type: 'opened', days: 3650, not: true }] }), JSON.stringify(rules));
want('tags normalised', cleanTags(' Trade Show 2026 ; <b>x</b>, , trade show 2026').join('|') === 'trade show 2026|bxb' && fieldKey('First Name!') === 'first_name');
want('rules in words', describeSegment(rules) === 'is tagged farm or vip, or has business_type equal to “Dairy”, or hasn’t opened an email in the last 3650 days', describeSegment(rules));
want('no rules is everyone', describeSegment(cleanRules({})) === 'Everyone on the campaign’s lists');

process.exitCode = bad ? 1 : 0;
