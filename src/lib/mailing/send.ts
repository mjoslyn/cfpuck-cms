// Sending a campaign. A send can take longer than a request may run, so it is a job: the API (or the
// scheduler for scheduled campaigns and digests) claims the campaign with a token and hands it to the
// background function netlify/functions/mail-send-background.mts (up to 15 minutes); under astro dev it
// runs in-process. A run first freezes the campaign: renders it, makes its tracked links, and writes
// every recipient (campaign_sends) in batches of up to 1,000 (campaign_batches). Then batch by batch it
// checks who is still subscribed, marks the batch attempting and posts it to Mailgun. A batch whose
// request got no answer is "unknown" and is never sent again blindly: Mailgun's events for its tag decide.
// A run that runs out of time lets go of the campaign, and the scheduler's next run carries on. Server only.
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../supabase';
import { emailEvents } from '../events/email';
import { refreshSiteTimezone } from '../site/timezone';
import { audienceOf, type Campaign } from './config';
import { loadMailing, mailOrigin } from './contacts';
import { emailEntries } from './entries';
import { BATCH_SIZE, MailgunError, mailgunStatus, sendBatch, tagSeen } from './mailgun';
import { addHoneypot, findLinks, plainText, recipientValues, renderCampaign, trackLinks, trackText, utmLinks, withUtm, type Recipient, type VarSpec } from './render';
import { sign } from './tokens';
import { mailingPaused } from './state';
import { cleanRules, type SegmentRules } from './segments';

/** A run stops starting new batches after this long, well inside the background function's 15 minutes. */
const RUN_MS = 12 * 60 * 1000;
/** An unknown batch is resent (once) only after Mailgun has had this long to show events for it. */
const UNKNOWN_WAIT_MS = 10 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'campaign';

/** The sender: the name chosen (the campaign's, else the settings', else the site's) at fromLocal@MAILGUN_DOMAIN. */
export function fromHeader(name: string, local = 'news'): string {
  const domain = mailgunStatus().domain || 'localhost';
  const clean = name.replace(/["<>\r\n]/g, '').trim();
  return clean ? `"${clean}" <${local}@${domain}>` : `${local}@${domain}`;
}

interface Frozen {
  subject: string;
  from: string;
  replyTo: string;
  vars: VarSpec[];
  origin: string;
}

/** Everyone the campaign goes to now: its lists, members or not, and its segment (paged: the API returns at most 1,000 rows a request). */
export async function audience(db: SupabaseClient, c: Pick<Campaign, 'list_ids' | 'audience'> & { segment_id?: number | null }): Promise<{ id: number; email: string; name: string }[]> {
  if (!c.list_ids?.length) return [];
  let rules: SegmentRules | null = null;
  if (c.segment_id) {
    const { data, error } = await db.from('mail_segments').select('rules').eq('id', c.segment_id).maybeSingle();
    if (error || !data) throw new Error(error?.message ?? 'The campaign’s segment is gone.');
    rules = cleanRules(data.rules);
  }
  return audienceOfRules(db, { lists: c.list_ids, audience: c.audience, rules });
}

/** The subscribed people a segment's rules pick: on any of `lists` (null: on any list), members or not. */
export async function audienceOfRules(db: SupabaseClient, q: { lists: number[] | null; audience?: Campaign['audience']; rules: SegmentRules | null; limit?: number }): Promise<{ id: number; email: string; name: string }[]> {
  const a = audienceOf(q.audience);
  const out: { id: number; email: string; name: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const to = q.limit ? Math.min(from + 999, q.limit - 1) : from + 999;
    const { data, error } = await db.rpc('mail_audience', { p_lists: q.lists, p_members: a.members, p_levels: a.levels, p_segment: q.rules }).range(from, to);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as any[]).map((r) => ({ id: Number(r.id), email: String(r.email), name: String(r.name ?? '') })));
    if (!data || data.length < 1000 || (q.limit && out.length >= q.limit)) return out;
  }
}

/** The email as it will go out (rendered now: events and entries as they are now). */
export async function renderFor(db: SupabaseClient, c: Campaign, origin: string) {
  const { name, settings } = await loadMailing(db);
  const [events, entries] = await Promise.all([emailEvents(db, c.design, origin), emailEntries(db, c.design, origin, c.since)]);
  const rendered = renderCampaign({ campaignId: c.id, subject: c.subject, design: c.design ?? { root: { props: {} }, content: [] }, text: c.text, siteName: name, address: settings.address ?? '', origin, events, entries, fields: settings.fields?.map((f) => f.key) });
  return { rendered, events, entries, name, settings };
}

/** Freeze a campaign: render it, make its links, write its recipients and batches. Returns an error message, or '' when done. */
async function freeze(db: SupabaseClient, c: Campaign): Promise<string> {
  const origin = mailOrigin();
  const { rendered, name, settings } = await renderFor(db, c, origin);
  if (!settings.address) return 'Add the postal address under Settings > Mailing Lists: every email must carry it.';
  let html = rendered.html;
  let text = rendered.text;
  if (c.track_links) {
    const found = findLinks(html);
    const campaignSlug = slug(c.name || c.subject);
    const rows = found.map((f, i) => ({ campaign_id: c.id, url: c.utm ? withUtm(f.url, origin, campaignSlug) : f.url, label: f.label, position: i, kind: 'content' }));
    // Links already made by a run that stopped before saving the frozen email are replaced.
    await db.from('campaign_links').delete().eq('campaign_id', c.id);
    const { data: links, error } = await db.from('campaign_links').insert([...rows, { campaign_id: c.id, url: origin + '/', label: 'Hidden link (machines only)', position: rows.length, kind: 'honeypot' }]).select('id, url, position, kind');
    if (error) throw new Error(error.message);
    const ordered = (links ?? []).filter((l) => l.kind === 'content').sort((a, b) => a.position - b.position);
    html = trackLinks(html, origin, ordered.map((l) => Number(l.id)));
    text = c.text?.trim() ? trackText(text, ordered.map((l) => ({ id: Number(l.id), url: l.url, original: found[l.position]?.url ?? l.url })), origin) : plainText(html);
    const trap = (links ?? []).find((l) => l.kind === 'honeypot');
    if (trap) html = addHoneypot(html, origin, Number(trap.id));
  } else if (c.utm) {
    html = utmLinks(html, origin, slug(c.name || c.subject));
    if (!c.text?.trim()) text = plainText(html);
  }
  const people = await audience(db, c);
  if (!people.length) return c.digest_id ? 'skip:Nobody on its lists is subscribed.' : 'Nobody on the chosen lists is subscribed (with the audience chosen).';
  // Batches, then each person's send row in their batch.
  await db.from('campaign_sends').delete().eq('campaign_id', c.id);
  await db.from('campaign_batches').delete().eq('campaign_id', c.id);
  const count = Math.ceil(people.length / BATCH_SIZE);
  const { data: batches, error: be } = await db.from('campaign_batches').insert(Array.from({ length: count }, (_, n) => ({ campaign_id: c.id, n }))).select('id, n');
  if (be) throw new Error(be.message);
  const byN = new Map((batches ?? []).map((b) => [Number(b.n), Number(b.id)]));
  for (let i = 0; i < people.length; i += 1000) {
    const rows = people.slice(i, i + 1000).map((p, j) => ({ campaign_id: c.id, contact_id: p.id, email: p.email, batch_id: byN.get(Math.floor((i + j) / BATCH_SIZE)) }));
    const { error } = await db.from('campaign_sends').insert(rows);
    if (error) throw new Error(error.message);
  }
  const frozen: Frozen = { subject: rendered.subject, from: fromHeader(c.from_name || settings.fromName || name, settings.fromLocal), replyTo: c.reply_to || settings.replyTo || '', vars: rendered.vars, origin };
  const { error } = await db.from('campaigns').update({ html, text_rendered: text, vars: frozen, recipients: people.length }).eq('id', c.id);
  if (error) throw new Error(error.message);
  return '';
}

/** Claim a campaign and start its run: the background function in production, in-process otherwise. */
export async function startSending(id: number, base?: string): Promise<boolean> {
  const db = serviceClient();
  const token = randomUUID();
  const { data: claimed, error } = await db.rpc('mail_claim', { p_id: id, p_token: token });
  if (error) throw new Error(error.message);
  if (!claimed) return false;
  // On Netlify (a built site, or its scheduled functions, which run on AWS Lambda) the background
  // function does the run; under astro dev it runs here.
  const deployed = (import.meta.env?.PROD ?? false) || !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.NETLIFY;
  const url = base || process.env.URL || process.env.DEPLOY_URL;
  if (deployed && url) {
    try {
      const res = await fetch(new URL('/.netlify/functions/mail-send-background', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ campaignId: id, token }) });
      if (!res.ok) throw new Error(`worker answered ${res.status}`);
      return true;
    } catch (e) {
      console.warn(`[mailing] no background worker (${(e as Error).message}); running inline`);
    }
  }
  void runCampaign(id, token).catch((e) => console.error(`[mailing] campaign ${id}: ${e.message}`));
  return true;
}

async function release(db: SupabaseClient, id: number, patch: Record<string, unknown> = {}) {
  await db.from('campaigns').update({ claim_token: null, claimed_at: null, ...patch }).eq('id', id);
}

/** One sending run (the background function's work). */
export async function runCampaign(id: number, token: string): Promise<void> {
  const db = serviceClient();
  await refreshSiteTimezone(db);
  const started = Date.now();
  const load = async () => (await db.from('campaigns').select('*').eq('id', id).maybeSingle()).data as (Campaign & { claim_token: string | null }) | null;
  let c = await load();
  if (!c || c.claim_token !== token) return;
  try {
    const paused = await mailingPaused(db);
    if (paused) return release(db, id, { status: 'paused', error: `Sending is paused: ${paused}` });
    if (!c.html) {
      const problem = await freeze(db, c);
      if (problem.startsWith('skip:')) return release(db, id, { status: 'skipped', error: problem.slice(5) });
      if (problem) return release(db, id, { status: 'failed', error: problem });
      c = (await load())!;
    }
    const frozen = c.vars as Frozen;
    const { data: batches } = await db.from('campaign_batches').select('*').eq('campaign_id', id).order('n');
    for (const b of batches ?? []) {
      if (b.status === 'accepted' || b.status === 'skipped' || b.status === 'failed') continue;
      // Paused or cancelled while sending: stop before the next batch.
      const now = await load();
      if (!now || now.claim_token !== token) return;
      if (now.status !== 'sending') return release(db, id);
      if (Date.now() - started > RUN_MS) return release(db, id);
      if (b.status === 'unknown' || b.status === 'attempting') {
        // Did Mailgun take it? Its events for the batch's tag say.
        if (await tagSeen(`batch-${b.id}`).catch(() => false)) {
          await markAccepted(db, b.id, b.mailgun_id ?? '');
          continue;
        }
        const waited = Date.now() - Date.parse(b.attempted_at ?? new Date(0).toISOString());
        if (waited < UNKNOWN_WAIT_MS) return release(db, id);
        if (b.attempts >= 2) {
          await db.from('campaign_batches').update({ status: 'failed', error: 'Mailgun’s answer wasn’t seen twice; not sent again.' }).eq('id', b.id);
          return release(db, id, { status: 'paused', error: `Batch ${b.n + 1}: whether Mailgun took it is unclear, so it wasn’t sent again. Check Mailgun’s logs before resuming.` });
        }
      }
      const outcome = await sendOne(db, c, frozen, b);
      if (outcome === 'stop') return release(db, id);
      if (outcome.startsWith('failed:')) return release(db, id, { status: 'failed', error: outcome.slice(7) });
    }
    const { data: open } = await db.from('campaign_batches').select('id').eq('campaign_id', id).in('status', ['pending', 'attempting', 'unknown']);
    if (!open?.length) await release(db, id, { status: 'sent', sent_at: new Date().toISOString(), error: '' });
    else await release(db, id);
  } catch (e) {
    console.error(`[mailing] campaign ${id}: ${(e as Error).message}`);
    await release(db, id, { error: (e as Error).message });
  }
}

async function markAccepted(db: SupabaseClient, batch: number, mailgunId: string) {
  await db.from('campaign_batches').update({ status: 'accepted', mailgun_id: mailgunId, error: '' }).eq('id', batch);
  await db.from('campaign_sends').update({ status: 'sent' }).eq('batch_id', batch).eq('status', 'queued');
}

/** Send one batch. 'ok', 'stop' (try again on a later run) or 'failed:<why>'. */
async function sendOne(db: SupabaseClient, c: Campaign, frozen: Frozen, b: { id: number; n: number; attempts: number }): Promise<string> {
  const { data: rows, error } = await db.from('campaign_sends').select('contact_id, email, status, contacts(first_name, last_name, attributes)').eq('batch_id', b.id);
  if (error) throw new Error(error.message);
  const queued = (rows ?? []).filter((r: any) => r.status === 'queued');
  // Still subscribed now? Unsubscribes during a send take effect for the batches still to go.
  const { data: still } = await db.rpc('mail_still_subscribed', { p_ids: queued.map((r: any) => r.contact_id), p_lists: c.list_ids });
  const keep = new Set(((still ?? []) as any[]).map((x) => Number(typeof x === 'object' ? (x.mail_still_subscribed ?? Object.values(x)[0]) : x)));
  const dropped = queued.filter((r: any) => !keep.has(Number(r.contact_id))).map((r: any) => r.contact_id);
  if (dropped.length) await db.from('campaign_sends').update({ status: 'dropped' }).eq('campaign_id', c.id).in('contact_id', dropped);
  const people = queued.filter((r: any) => keep.has(Number(r.contact_id)));
  if (!people.length) {
    await db.from('campaign_batches').update({ status: 'skipped' }).eq('id', b.id);
    return 'ok';
  }
  const variables: Record<string, Record<string, string>> = {};
  for (const p of people as any[]) variables[p.email] = recipientValues(frozen.vars, { ...p.contacts, email: p.email }, { t: sign('manage', Number(p.contact_id)), ct: sign('click', Number(p.contact_id)) });
  await db.from('campaign_batches').update({ status: 'attempting', attempts: b.attempts + 1, attempted_at: new Date().toISOString() }).eq('id', b.id);
  const unsubscribe = `${frozen.origin}/api/mail/unsubscribe?t=%recipient.t%&c=${c.id}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const mailgunId = await sendBatch({
        from: frozen.from,
        replyTo: frozen.replyTo || undefined,
        to: people.map((p: any) => p.email),
        subject: frozen.subject,
        html: c.html!,
        text: c.text_rendered ?? '',
        variables,
        tags: [`campaign-${c.id}`, `batch-${b.id}`],
        data: { campaign_id: String(c.id), batch_id: String(b.id) },
        headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        opens: true,
      });
      await markAccepted(db, b.id, mailgunId);
      return 'ok';
    } catch (e) {
      const status = e instanceof MailgunError ? e.status : 0;
      if (status === 0) {
        await db.from('campaign_batches').update({ status: 'unknown', error: (e as Error).message }).eq('id', b.id);
        return 'stop';
      }
      if ((status === 429 || status >= 500) && attempt < 4) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (status === 429 || status >= 500) {
        await db.from('campaign_batches').update({ status: 'pending', error: (e as Error).message }).eq('id', b.id);
        return 'stop';
      }
      await db.from('campaign_batches').update({ status: 'failed', error: (e as Error).message }).eq('id', b.id);
      return `failed:Mailgun refused batch ${b.n + 1}: ${(e as Error).message}`;
    }
  }
}

/** A test send to a few addresses (the campaign as it would go now; no tracking, not counted). */
export async function sendTest(db: SupabaseClient, c: Campaign, to: Recipient[]): Promise<string> {
  const origin = mailOrigin();
  const { rendered, name, settings } = await renderFor(db, c, origin);
  if (!settings.address) throw new Error('Add the postal address under Settings > Mailing Lists first: every email must carry it.');
  const variables: Record<string, Record<string, string>> = {};
  // An address that is a contact is filled in as that contact.
  const { data: known } = await db.from('contacts').select('email, first_name, last_name, attributes').in('email', to.map((p) => p.email));
  for (const p of to) variables[p.email] = recipientValues(rendered.vars, (known ?? []).find((k) => k.email === p.email) ?? p, { t: 'test', ct: 'test' });
  return sendBatch({
    from: fromHeader(c.from_name || settings.fromName || name, settings.fromLocal),
    replyTo: c.reply_to || settings.replyTo || undefined,
    to: to.map((p) => p.email),
    subject: `[Test] ${rendered.subject}`,
    html: rendered.html,
    text: rendered.text,
    variables,
    tags: ['test'],
    data: { test: '1' },
    headers: {},
    opens: false,
  });
}
