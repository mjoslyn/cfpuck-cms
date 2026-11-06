// The email log (Settings > Email log; table mail_log): while it is on, each email the site sends
// itself (sendMail in src/lib/forms/mail.ts: forms, tickets, accounts, admin notices) is kept with its
// recipients, subject, how it went and its body. An email marked `secret` (one with a sign-in, password,
// invitation or confirmation link) is kept without its body: whoever reads the log mustn't be able to
// use the link. Mailing Lists' emails (`mailing`: confirmations, campaigns, its notices) are never kept.
// Entries go after the settings' days (pruned hourly, pruneMailLog). Server only.
import type { Db } from './db/query';
import { serviceClient } from './db/site';

/** What an email was, for the log's filter. */
export const MAIL_KINDS = {
  form: 'Form notification',
  ticket: 'Ticket',
  account: 'Account',
  admin: 'Notice to admins',
  other: 'Other',
  /** Mailing Lists' emails: never logged. */
  mailing: 'Mailing list',
} as const;
export type MailKind = keyof typeof MAIL_KINDS;

export interface MailLogSettings {
  enabled?: boolean;
  /** How many days entries are kept (default 30, 1 to 365). */
  days?: number;
}

export const MAIL_LOG_DAYS = 30;
const MAX_HTML = 200_000;
const MAX_TEXT = 50_000;

/** The log's settings (settings.site.mail_log), cleaned. */
export function mailLogSettings(site: Record<string, any> | null | undefined): { enabled: boolean; days: number } {
  const s = (site?.mail_log ?? {}) as MailLogSettings;
  const days = Math.round(Number(s.days) || MAIL_LOG_DAYS);
  return { enabled: s.enabled === true, days: Math.min(365, Math.max(1, days)) };
}

// Read at most once a minute per instance: every email asks.
let cached: { at: number; on: boolean } | null = null;
async function logOn(db: Db): Promise<boolean> {
  if (cached && Date.now() - cached.at < 60_000) return cached.on;
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  cached = { at: Date.now(), on: mailLogSettings(data?.value as Record<string, any>).enabled };
  return cached.on;
}
/** Forget the cached setting (a settings save, tests). */
export const resetMailLogCache = () => {
  cached = null;
};

export interface MailLogEntry {
  kind?: MailKind;
  to: string[];
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /** Keep the email without its body (it carries a sign-in or confirmation link). */
  secret?: boolean;
  status: 'sent' | 'failed' | 'not-sent';
  via: string;
  error?: string;
}

/** Keeps an email in the log while the log is on. Never throws: logging must not stop mail. */
export async function logMail(e: MailLogEntry, db: Db = serviceClient()): Promise<void> {
  try {
    if (e.kind === 'mailing' || !(await logOn(db))) return;
    const { error } = await db.from('mail_log').insert({
      kind: e.kind && e.kind in MAIL_KINDS ? e.kind : 'other',
      to_addresses: e.to.join(', ').slice(0, 2000),
      from_address: e.from.slice(0, 300),
      reply_to: e.replyTo?.slice(0, 300) || null,
      subject: e.subject.slice(0, 500),
      html: e.secret ? null : e.html.slice(0, MAX_HTML),
      text: e.secret ? null : e.text.slice(0, MAX_TEXT),
      withheld: !!e.secret,
      status: e.status,
      via: e.via,
      error: e.error?.slice(0, 1000) || null,
    });
    if (error) console.error(`mail log: ${error.message}`);
  } catch (err) {
    console.error(`mail log: ${(err as Error).message}`);
  }
}

/** Deletes entries past the log's days, and every entry while the log is off. Returns what it did. */
export async function pruneMailLog(db: Db, at: Date = new Date()): Promise<string> {
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  const s = mailLogSettings(data?.value as Record<string, any>);
  const before = s.enabled ? new Date(at.getTime() - s.days * 86_400_000).toISOString() : at.toISOString();
  const { error } = await db.from('mail_log').delete().lt('created_at', before);
  return error ? `mail log prune failed: ${error.message}` : `mail log kept ${s.enabled ? `${s.days} days` : 'nothing (off)'}`;
}
