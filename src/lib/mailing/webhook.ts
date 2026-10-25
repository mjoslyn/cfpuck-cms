// Mailgun's webhook (POST /api/mailgun/webhook): delivered, opened, failed, complained and unsubscribed
// events for the marketing domain. The signature is checked (and its token may be used once), every
// event is logged once by Mailgun's event id (a repeat is answered and ignored), then the send and the
// contact are updated. Clicks aren't Mailgun's: the site tracks them itself. Server only.
import type { Db } from '../db/query';
import { webhookSigned } from './mailgun';
import { openVerdict } from './clicks';
import { emailHash } from './tokens';
import { checkHealth } from './state';
import { rejudgeSend } from './tracking';

export type WebhookResult = { status: number; body: string };

/** Handle one webhook post (its parsed JSON). */
export async function handleWebhook(db: Db, body: any, now = Date.now()): Promise<WebhookResult> {
  if (!webhookSigned(body?.signature, now)) return { status: 406, body: 'bad signature' };
  // A token used once only (a replayed post).
  const { error: te } = await db.from('mailgun_tokens').insert({ token: String(body.signature.token).slice(0, 200) });
  if (te) return te.code === '23505' ? { status: 406, body: 'token used' } : { status: 500, body: te.message };
  const ev = body['event-data'] ?? {};
  const event = String(ev.event ?? '');
  const id = String(ev.id ?? '');
  if (!event || !id) return { status: 200, body: 'ignored' };
  const recipient = String(ev.recipient ?? '').toLowerCase();
  const vars = ev['user-variables'] ?? {};
  const campaign = Number(vars.campaign_id) || null;
  const severity = String(ev.severity ?? '');
  const client = ev['client-info'] ?? {};
  const verdict = event === 'opened' ? openVerdict(String(ev.ip ?? ''), String(client['user-agent'] ?? ''), String(client['client-type'] ?? '')) : '';
  const { error } = await db.from('mail_events').insert({ event_id: id.slice(0, 200), event, severity, recipient, campaign_id: campaign, verdict, payload: ev });
  if (error) return error.code === '23505' ? { status: 200, body: 'seen' } : { status: 500, body: error.message };
  const at = new Date(Number(ev.timestamp) > 0 ? Number(ev.timestamp) * 1000 : now).toISOString();
  const { data: contact } = recipient ? await db.from('contacts').select('id, status').eq('email', recipient).maybeSingle() : { data: null };
  const onSend = async (patch: Record<string, unknown>, unset?: string) => {
    if (!campaign || !contact) return;
    let q = db.from('campaign_sends').update(patch).eq('campaign_id', campaign).eq('contact_id', contact.id);
    if (unset) q = q.is(unset, null);
    await q;
  };
  switch (event) {
    case 'delivered':
      await onSend({ status: 'delivered', delivered_at: at });
      // Clicks right after delivery are judged against it.
      if (campaign && contact) await rejudgeSend(db, campaign, contact.id);
      break;
    case 'opened':
      if (verdict === 'likely_human') await onSend({ opened_at: at }, 'opened_at');
      break;
    case 'failed':
      if (severity === 'permanent') {
        await onSend({ status: 'bounced', bounced_at: at });
        if (contact && contact.status !== 'complained') await db.from('contacts').update({ status: 'bounced' }).eq('id', contact.id);
        if (recipient) await db.from('mail_suppressions').upsert({ email_hash: emailHash(recipient), reason: 'bounced' }, { onConflict: 'email_hash', ignoreDuplicates: true });
        if (campaign) await checkHealth(db, campaign);
      }
      // Temporary failures: logged only; Mailgun tries again.
      break;
    case 'complained':
      await onSend({ status: 'complained', complained_at: at });
      if (contact) await db.from('contacts').update({ status: 'complained', unsubscribed_at: at }).eq('id', contact.id);
      if (recipient) await db.from('mail_suppressions').upsert({ email_hash: emailHash(recipient), reason: 'complained' }, { onConflict: 'email_hash' });
      if (campaign) await checkHealth(db, campaign);
      break;
    case 'unsubscribed':
      await onSend({ unsubscribed_at: at }, 'unsubscribed_at');
      if (contact && contact.status === 'subscribed') await db.from('contacts').update({ status: 'unsubscribed', unsubscribed_at: at }).eq('id', contact.id);
      break;
  }
  return { status: 200, body: 'ok' };
}
