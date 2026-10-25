// Whether sending is paused site-wide (settings key 'mailing', which isn't synced: each copy's own),
// and the health check that pauses it: a campaign whose complaint or bounce rate passes the thresholds
// under Settings > Mailing Lists, once it has enough deliveries to judge, pauses every send (digests too)
// until an admin looks and resumes. The admins are told by email. Server only.
import type { Db } from '../db/query';
import { site as config } from '../site';
import { sendMail } from '../forms/mail';
import { HEALTH, mailingSettings, type CampaignStats } from './config';
import { mailOrigin } from './contacts';
import { env } from '../env';

export interface MailingState {
  paused?: { reason: string; at: string; campaign?: number };
}

export async function mailingState(db: Db): Promise<MailingState> {
  const { data } = await db.from('settings').select('value').eq('key', 'mailing').maybeSingle();
  return (data?.value as MailingState) ?? {};
}

/** Why sending is paused ('' when it isn't). */
export async function mailingPaused(db: Db): Promise<string> {
  return (await mailingState(db)).paused?.reason ?? '';
}

export async function setPaused(db: Db, paused: MailingState['paused'] | null): Promise<void> {
  const state = await mailingState(db);
  const value = { ...state, paused: paused ?? undefined };
  const { error } = await db.from('settings').upsert({ key: 'mailing', value }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

/** Whether a campaign's numbers pass the thresholds; the reason if so. */
export function unhealthy(s: CampaignStats, thresholds: { complaintRate: number; bounceRate: number }): string {
  if (s.delivered < HEALTH.minDelivered) return '';
  const complaints = (s.complained / s.delivered) * 100;
  const bounces = (s.bounced / Math.max(1, s.sent)) * 100;
  if (s.complained >= HEALTH.minComplaints && complaints > thresholds.complaintRate) return `complaint rate ${complaints.toFixed(2)}% (over ${thresholds.complaintRate}%)`;
  if (s.bounced >= HEALTH.minBounces && bounces > thresholds.bounceRate) return `bounce rate ${bounces.toFixed(2)}% (over ${thresholds.bounceRate}%)`;
  return '';
}

/** Check a campaign after a bounce or complaint; pause everything and tell the admins when it fails. */
export async function checkHealth(db: Db, campaignId: number): Promise<void> {
  const [{ data: stats }, { data: site }, state] = await Promise.all([db.rpc('campaign_stats', { p_id: campaignId }), db.from('settings').select('value').eq('key', 'site').maybeSingle(), mailingState(db)]);
  if (!stats || state.paused) return;
  const s = mailingSettings(site?.value);
  const reason = unhealthy(stats as CampaignStats, { complaintRate: s.complaintRate!, bounceRate: s.bounceRate! });
  if (!reason) return;
  const { data: c } = await db.from('campaigns').select('name, subject').eq('id', campaignId).maybeSingle();
  const why = `“${c?.name || c?.subject || `Campaign ${campaignId}`}” has a ${reason}`;
  await setPaused(db, { reason: why, at: new Date().toISOString(), campaign: campaignId });
  await db.from('campaigns').update({ status: 'paused', error: `Paused: ${reason}` }).eq('status', 'sending');
  const admin = env('FORMS_ADMIN_EMAIL') || config.adminEmail;
  if (admin) {
    const link = `${mailOrigin()}/admin/mailing-lists/`;
    await sendMail({ to: [admin], subject: 'Mailing paused', html: `<p>Sending is paused: ${why.replace(/[<>&]/g, '')}.</p><p>Nothing more goes out, digests included, until an admin resumes it on the <a href="${link}">Mailing Lists screen</a>.</p>` }).catch((e) => console.error(`mailing: pause email failed: ${e.message}`));
  }
}
