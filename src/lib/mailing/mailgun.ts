// Mailgun, over its REST API (no SDK): sending a batch, looking for a batch's events, the domain's
// suppression lists, and checking a webhook's signature. The keys are environment variables, never
// settings (settings sync between copies): MAILGUN_API_KEY, MAILGUN_DOMAIN (the marketing subdomain),
// MAILGUN_REGION (us, the default, or eu), MAILGUN_WEBHOOK_SIGNING_KEY and MAILGUN_TEST_MODE (Mailgun
// accepts and delivers nothing). Without keys nothing goes to Mailgun: a batch is sent one by one to a
// local mail catcher (an SMTP host on this machine), else logged. Server only.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

export interface MailgunStatus {
  configured: boolean;
  domain: string;
  region: 'us' | 'eu';
  testMode: boolean;
  webhooks: boolean;
  /** The variables still missing for sending. */
  missing: string[];
}

export function mailgunStatus(): MailgunStatus {
  const missing = ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN'].filter((k) => !env(k));
  return {
    configured: !missing.length,
    domain: env('MAILGUN_DOMAIN') ?? '',
    region: env('MAILGUN_REGION')?.toLowerCase() === 'eu' ? 'eu' : 'us',
    testMode: env('MAILGUN_TEST_MODE') === 'true',
    webhooks: !!env('MAILGUN_WEBHOOK_SIGNING_KEY'),
    missing: [...missing, ...(env('MAILGUN_WEBHOOK_SIGNING_KEY') ? [] : ['MAILGUN_WEBHOOK_SIGNING_KEY'])],
  };
}

/** The API's address: the region's, or MAILGUN_API_BASE (a stand-in server, for testing). */
const base = () => env('MAILGUN_API_BASE')?.replace(/\/$/, '') || (mailgunStatus().region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net');
const auth = () => `Basic ${Buffer.from(`api:${env('MAILGUN_API_KEY')}`).toString('base64')}`;
const domainPath = () => `/v3/${encodeURIComponent(env('MAILGUN_DOMAIN') ?? '')}`;

/** A Mailgun request's failure: its HTTP status (0: no answer seen) and message. */
export class MailgunError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call(path: string, init: RequestInit & { timeout?: number } = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { ...init, headers: { Authorization: auth(), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(init.timeout ?? 30_000) });
  } catch (e) {
    // No answer (a timeout, a dropped connection): the request may or may not have been taken.
    throw new MailgunError((e as Error).message, 0);
  }
  const text = await res.text();
  if (!res.ok) throw new MailgunError(`${res.status} ${text.slice(0, 300)}`, res.status);
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** One batch: up to 1,000 addresses with their own variables, so each sees only their own address. */
export interface Batch {
  from: string;
  replyTo?: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  /** Per address: the %recipient.<key>% values. */
  variables: Record<string, Record<string, string>>;
  tags: string[];
  /** Custom variables, returned in webhooks (v:<key>). */
  data: Record<string, string>;
  headers: Record<string, string>;
  opens: boolean;
}

export const BATCH_SIZE = 1000;

/** Send a batch; its Mailgun message id. */
export async function sendBatch(b: Batch): Promise<string> {
  if (!mailgunStatus().configured) return sendLocally(b);
  const form = new FormData();
  form.append('from', b.from);
  for (const to of b.to) form.append('to', to);
  form.append('subject', b.subject);
  form.append('html', b.html);
  form.append('text', b.text);
  form.append('recipient-variables', JSON.stringify(b.variables));
  for (const t of b.tags.slice(0, 3)) form.append('o:tag', t);
  for (const [k, v] of Object.entries(b.data)) form.append(`v:${k}`, v);
  if (b.replyTo) form.append('h:Reply-To', b.replyTo);
  for (const [k, v] of Object.entries(b.headers)) form.append(`h:${k}`, v);
  form.append('o:tracking', b.opens ? 'yes' : 'no');
  form.append('o:tracking-opens', b.opens ? 'yes' : 'no');
  // The site tracks clicks itself (src/lib/mailing/clicks.ts).
  form.append('o:tracking-clicks', 'no');
  if (mailgunStatus().testMode) form.append('o:testmode', 'yes');
  const out = await call(`${domainPath()}/messages`, { method: 'POST', body: form, timeout: 60_000 });
  return String(out.id ?? '');
}

/** Without Mailgun: each address on its own to a mail catcher on this machine (the local stack's), else a log line. */
async function sendLocally(b: Batch): Promise<string> {
  const host = env('SMTP_HOST') || (env('SMTP_URL') ? new URL(env('SMTP_URL')!).hostname : '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.warn(`[mailing] Mailgun isn't set up; not sending "${b.subject}" to ${b.to.length} address(es)`);
    return `logged-${Date.now()}`;
  }
  const { sendMail } = await import('../forms/mail');
  const fill = (s: string, vars: Record<string, string>) => s.replace(/%recipient\.([a-z0-9_]+)%/gi, (_, k) => vars[k] ?? '');
  for (const to of b.to) {
    const vars = b.variables[to] ?? {};
    await sendMail({ to: [to], subject: fill(b.subject, vars), html: fill(b.html, vars), text: fill(b.text, vars), fromName: b.from.replace(/\s*<[^>]*>$/, ''), replyTo: b.replyTo });
  }
  return `local-${Date.now()}`;
}

/** Whether Mailgun has any event for a tag (a batch's own tag: did it take the batch?). */
export async function tagSeen(tag: string): Promise<boolean> {
  if (!mailgunStatus().configured) return false;
  const out = await call(`${domainPath()}/events?${new URLSearchParams({ tags: tag, limit: '1' })}`);
  return Array.isArray(out.items) && out.items.length > 0;
}

/** Every address on one of the domain's suppression lists (paged). */
export async function suppressions(list: 'bounces' | 'complaints' | 'unsubscribes'): Promise<{ address: string; code?: string; error?: string; created_at?: string }[]> {
  if (!mailgunStatus().configured) return [];
  const out: any[] = [];
  let path = `${domainPath()}/${list}?limit=1000`;
  for (let page = 0; page < 200; page++) {
    const res = await call(path);
    const items = Array.isArray(res.items) ? res.items : [];
    out.push(...items);
    const next: string | undefined = res.paging?.next;
    if (!items.length || !next) break;
    path = next.replace(/^https?:\/\/[^/]+/, '');
  }
  return out;
}

/** Take an address off the domain's unsubscribes (someone signed up again). */
export async function removeUnsubscribe(address: string): Promise<void> {
  if (!mailgunStatus().configured) return;
  try {
    await call(`${domainPath()}/unsubscribes/${encodeURIComponent(address)}`, { method: 'DELETE' });
  } catch (e) {
    if ((e as MailgunError).status !== 404) throw e;
  }
}

/** Put an address on the domain's unsubscribes (an erased contact). */
export async function addUnsubscribe(address: string): Promise<void> {
  if (!mailgunStatus().configured) return;
  const form = new FormData();
  form.append('address', address);
  form.append('tag', '*');
  await call(`${domainPath()}/unsubscribes`, { method: 'POST', body: form });
}

/** A tag's totals at Mailgun ("Reconcile with Mailgun"): accepted, delivered, failed, opened, clicked, complained, unsubscribed. */
export async function tagStats(tag: string): Promise<Record<string, number>> {
  if (!mailgunStatus().configured) return {};
  const q = new URLSearchParams({ duration: '90d' });
  for (const e of ['accepted', 'delivered', 'failed', 'opened', 'clicked', 'complained', 'unsubscribed']) q.append('event', e);
  const out = await call(`${domainPath()}/tags/${encodeURIComponent(tag)}/stats?${q}`);
  const totals: Record<string, number> = {};
  for (const s of Array.isArray(out.stats) ? out.stats : []) {
    for (const [k, v] of Object.entries(s)) {
      if (k === 'time' || !v || typeof v !== 'object') continue;
      const n = Number((v as any).total ?? ((v as any).permanent?.total ?? 0) + ((v as any).temporary?.total ?? 0));
      totals[k] = (totals[k] ?? 0) + (Number.isFinite(n) ? n : 0);
    }
  }
  return totals;
}

/** Whether a webhook's signature is Mailgun's: HMAC-SHA256 of timestamp + token with the signing key, within 5 minutes. */
export function webhookSigned(sig: { timestamp?: unknown; token?: unknown; signature?: unknown } | undefined, now = Date.now()): boolean {
  const key = env('MAILGUN_WEBHOOK_SIGNING_KEY');
  if (!key || !sig) return false;
  const ts = String(sig.timestamp ?? '');
  const token = String(sig.token ?? '');
  const given = String(sig.signature ?? '');
  if (!/^\d+$/.test(ts) || !token || !/^[0-9a-f]{64}$/i.test(given)) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const want = createHmac('sha256', key).update(ts + token).digest('hex');
  return timingSafeEqual(Buffer.from(want), Buffer.from(given.toLowerCase()));
}
