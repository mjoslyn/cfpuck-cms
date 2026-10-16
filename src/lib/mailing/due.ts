// The mailing scheduler (netlify/functions/mail-due.mts, every 5 minutes on the deployed site) and the
// nightly upkeep (netlify/functions/mail-nightly.mts). Due: scheduled campaigns whose time has come, sends
// a run let go of (out of time, or waiting on an unclear batch), digest issues waiting for review past
// their time (cancelled), and digests due this week. Nightly: Mailgun's bounces, complaints and
// unsubscribes for the domain reconciled with the contacts, and old events, clicks, tokens and
// unconfirmed sign-ups pruned. Server only.
import { serviceClient } from '../supabase';
import { refreshSiteTimezone } from '../site/timezone';
import { mailingOn, type Digest } from './config';
import { mailOrigin } from './contacts';
import { runDigest, tellAdmins } from './digest';
import { suppressions } from './mailgun';
import { startSending } from './send';
import { mailingPaused } from './state';
import { emailHash } from './tokens';

export async function runDue(now = new Date()): Promise<string> {
  const db = serviceClient();
  await refreshSiteTimezone(db);
  const { data: site } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  if (!mailingOn(site?.value)) return 'mailing is off';
  const done: string[] = [];
  // Reviewed issues nobody approved in time.
  const { data: overdue } = await db.from('campaigns').update({ status: 'cancelled', error: 'Not approved before its time.' }).eq('status', 'review').lte('scheduled_at', now.toISOString()).select('id, name');
  for (const c of overdue ?? []) {
    done.push(`cancelled ${c.id}`);
    await tellAdmins(`${c.name} wasn’t sent`, `<p>${c.name} wasn’t approved before its time, so it was cancelled.</p><p><a href="${mailOrigin()}/admin/mailing/campaigns/${c.id}/">See it</a></p>`);
  }
  const paused = await mailingPaused(db);
  if (paused) return [...done, `paused: ${paused}`].join('; ');
  const { data: due } = await db.from('campaigns').select('id').in('status', ['scheduled', 'sending']).lte('scheduled_at', now.toISOString());
  const { data: unscheduled } = await db.from('campaigns').select('id').eq('status', 'sending').is('scheduled_at', null);
  for (const c of [...(due ?? []), ...(unscheduled ?? [])]) if (await startSending(Number(c.id))) done.push(`sending ${c.id}`);
  const { data: digests } = await db.from('digests').select('*').eq('enabled', true);
  for (const d of (digests ?? []) as Digest[]) {
    const out = await runDigest(db, d, now).catch((e) => `failed: ${e.message}`);
    if (out !== 'not due') done.push(`${d.name}: ${out}`);
  }
  return done.join('; ') || 'nothing due';
}

export async function runNightly(now = new Date()): Promise<string> {
  const db = serviceClient();
  const out: string[] = [];
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  // Mailgun's own lists: an address there that is still subscribed here follows them.
  for (const [list, status] of [['bounces', 'bounced'], ['complaints', 'complained'], ['unsubscribes', 'unsubscribed']] as const) {
    const rows = await suppressions(list).catch((e) => (out.push(`${list}: ${e.message}`), []));
    const emails = [...new Set(rows.map((r) => String(r.address ?? '').toLowerCase()).filter(Boolean))];
    let changed = 0;
    for (let i = 0; i < emails.length; i += 500) {
      const chunk = emails.slice(i, i + 500);
      const { data } = await db.from('contacts').update({ status, unsubscribed_at: now.toISOString() }).in('email', chunk).eq('status', 'subscribed').select('id');
      changed += data?.length ?? 0;
      if (status !== 'unsubscribed') await db.from('mail_suppressions').upsert(chunk.map((e) => ({ email_hash: emailHash(e), reason: status })), { onConflict: 'email_hash', ignoreDuplicates: true });
    }
    if (changed) out.push(`${changed} ${status} from Mailgun`);
  }
  const prune = async (table: string, column: string, before: string, extra?: (q: any) => any) => {
    let q = db.from(table).delete().lt(column, before);
    if (extra) q = extra(q);
    const { error } = await q;
    if (error) out.push(`${table}: ${error.message}`);
  };
  await prune('mail_events', 'received_at', day(90));
  await prune('link_clicks', 'at', day(90));
  await prune('mailgun_tokens', 'at', day(1));
  // Sign-ups never confirmed (their pending lists go with them).
  await prune('contacts', 'consent_at', day(30), (q) => q.eq('status', 'pending').is('confirmed_at', null));
  return out.join('; ') || 'nothing to do';
}
