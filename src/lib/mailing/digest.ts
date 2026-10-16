// Weekly digests: a stored design (with Entries blocks showing what was published since the last issue,
// and Events blocks the events coming up) and a weekday and time in the site's time zone. Each week, once
// its time has passed (within a day), the scheduler makes that week's issue: an ordinary campaign
// (digest_id and the ISO week as issue_key, so it is made once), skipped when it has too little in it.
// Automatic digests send at once; reviewed ones wait for an admin's approval until review_hours later,
// and are cancelled if nobody approves them. Server only.
import type { SupabaseClient } from '@supabase/supabase-js';
import { SITE_TZ, site as config } from '../site';
import { sendMail } from '../forms/mail';
import { emailEvents } from '../events/email';
import type { Digest } from './config';
import { mailOrigin } from './contacts';
import { emailEntries } from './entries';
import { startSending } from './send';

const env = (k: string) => (import.meta.env?.[k] as string | undefined) ?? process.env[k];

/** Wall-clock parts of a moment in the site's time zone. */
function local(now: Date, tz = SITE_TZ) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(now).map((x) => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday };
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The ISO week of a local date ("2026-W42"). */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Whether a digest's issue is due now: its weekday and time in this ISO week have passed, by less than a
 * day (turning a digest on after its time doesn't send at once), and this week's issue isn't made yet.
 * The issue key, and the Monday of the week (for {week_of}).
 */
export function digestDue(d: Pick<Digest, 'weekday' | 'send_time' | 'last_run_key'>, now: Date, tz = SITE_TZ): { due: boolean; key: string; monday: string } {
  const l = local(now, tz);
  const monday = addDays(l.date, -((l.weekday + 6) % 7));
  const target = addDays(monday, (d.weekday + 6) % 7);
  const key = isoWeek(l.date);
  const nowStamp = `${l.date} ${l.time}`;
  const at = `${target} ${d.send_time}`;
  const dayLater = `${addDays(target, 1)} ${d.send_time}`;
  return { due: nowStamp >= at && nowStamp < dayLater && d.last_run_key !== key, key, monday };
}

/** "October 12, 2026". */
const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });

/** Make this week's issue of a digest (when another run hasn't). Returns what happened. */
export async function runDigest(db: SupabaseClient, d: Digest, now = new Date(), opts: { force?: boolean } = {}): Promise<string> {
  const { due, key, monday } = digestDue(d, now);
  if (!due && !opts.force) return 'not due';
  const issueKey = opts.force ? `${key}-${now.getTime()}` : key;
  // Taken once: the update only matches while this week's key isn't there yet.
  if (!opts.force) {
    const { data: won, error } = await db.rpc('mail_digest_claim', { p_id: d.id, p_key: key });
    if (error) return `failed: ${error.message}`;
    if (!won) return 'taken';
  }
  const { data: last } = await db.from('campaigns').select('sent_at').eq('digest_id', d.id).eq('status', 'sent').order('sent_at', { ascending: false }).limit(1);
  const since = last?.[0]?.sent_at ?? new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const week = longDate(monday);
  const fill = (s: string) => s.replace(/\{week_of\}/g, week).replace(/\{date\}/g, longDate(local(now).date));
  const origin = mailOrigin();
  const [events, entries] = await Promise.all([emailEvents(db, d.design, origin), emailEntries(db, d.design, origin, since)]);
  const items = [...Object.values(events), ...Object.values(entries)].reduce((n, l) => n + l.length, 0);
  const skip = d.skip_when_empty && items < Math.max(1, d.min_items);
  const review = d.mode === 'review';
  const row = {
    name: `${d.name}: week of ${week}`,
    subject: fill(d.subject || `${d.name}: week of {week_of}`),
    from_name: d.from_name,
    reply_to: d.reply_to,
    design: d.design,
    text: fill(d.text ?? ''),
    list_ids: d.list_ids,
    audience: d.audience,
    segment_id: d.segment_id ?? null,
    track_links: d.track_links,
    utm: d.utm,
    digest_id: d.id,
    issue_key: issueKey,
    since,
    status: skip ? 'skipped' : review ? 'review' : 'scheduled',
    scheduled_at: review ? new Date(now.getTime() + d.review_hours * 3_600_000).toISOString() : now.toISOString(),
    error: skip ? `${items} item${items === 1 ? '' : 's'} to show (needs ${Math.max(1, d.min_items)}).` : '',
  };
  const { data: c, error } = await db.from('campaigns').insert(row).select('id').single();
  if (error) return error.code === '23505' ? 'taken' : `failed: ${error.message}`;
  if (skip) return `skipped (${items} items)`;
  if (review) {
    await tellAdmins(`${d.name} for the week of ${week} is ready for review`, `<p>This week’s issue of ${d.name} is ready. It goes out ${new Date(row.scheduled_at).toLocaleString('en-US', { timeZone: SITE_TZ, dateStyle: 'full', timeStyle: 'short' })} if an admin approves it before then.</p><p><a href="${origin}/admin/mailing-lists/campaigns/${c.id}/">Review it</a></p>`);
    return `waiting for review (campaign ${c.id})`;
  }
  await startSending(Number(c.id));
  return `sending (campaign ${c.id})`;
}

export async function tellAdmins(subject: string, html: string): Promise<void> {
  const admin = env('FORMS_ADMIN_EMAIL') || config.adminEmail;
  if (admin) await sendMail({ to: [admin], subject, html }).catch((e) => console.error(`mailing: admin email failed: ${e.message}`));
}
