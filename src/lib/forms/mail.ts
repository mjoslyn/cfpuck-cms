// Outgoing mail (form notifications, accounts, tickets, confirmations), sent as HTML with a plain-text
// version through Cloudflare Email Service when the Worker has its EMAIL binding (wrangler.jsonc
// send_email), else over SMTP, so any provider works (Mailgun, SES, Postmark, Resend, a mail server;
// locally a mail catcher, so nothing real is sent), through the Worker's TCP sockets (worker-mailer;
// port 25 is closed to Workers, so 587 or 465; Cloudflare's own addresses, Email Service's SMTP
// included, can't be reached that way). Settings come from the environment (see transport()); without
// either, mail is logged and skipped, and submissions are still stored.
import { site } from '../site';
import { bindings } from '../platform';
import { env } from '../env';
import type { MailKind } from '../mail-log';

interface Smtp {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}

export interface Mail {
  to: string[];
  subject: string;
  html: string;
  /** The plain-text version; made from the HTML when left out. */
  text?: string;
  replyTo?: string;
  fromName?: string;
  /** What it is, for the email log (src/lib/mail-log.ts). */
  kind?: MailKind;
  /** It carries a sign-in, password, invitation or confirmation link: the email log keeps it without its body. */
  secret?: boolean;
}

function fromHeader(fromName?: string) {
  const from = env('MAIL_FROM') || env('FORMS_FROM') || site.mailFrom;
  const address = from.match(/<([^>]+)>/)?.[1] ?? from;
  return fromName ? `${fromName} <${address}>` : from;
}

export { textVersion } from './email';
import { textVersion } from './email';

/**
 * The SMTP server: SMTP_HOST (+ SMTP_PORT, default 587; SMTP_USER, SMTP_PASS; SMTP_SECURE, default on
 * for port 465), or one SMTP_URL (smtp[s]://user:pass@host:port). Undefined when neither is set.
 */
function transport(): Smtp | undefined {
  const host = env('SMTP_HOST');
  if (host) {
    const port = Number(env('SMTP_PORT')) || 587;
    return { host, port, secure: env('SMTP_SECURE') ? env('SMTP_SECURE') === 'true' : port === 465, user: env('SMTP_USER') || undefined, pass: env('SMTP_PASS') ?? '' };
  }
  const raw = env('SMTP_URL');
  if (!raw) return undefined;
  const u = new URL(raw);
  const port = Number(u.port) || (u.protocol === 'smtps:' ? 465 : 587);
  return { host: u.hostname, port, secure: u.protocol === 'smtps:' || port === 465, user: u.username ? decodeURIComponent(u.username) : undefined, pass: decodeURIComponent(u.password) };
}

/** A From/Reply-To header as worker-mailer takes it. */
const party = (h: string) => {
  const m = h.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : h.trim();
};

/** A header value on one line: a line break in a subject built from someone's answers would start
 * headers (or a body) of their own. */
const oneLine = (v: string) => v.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

/**
 * Sends an email: true once sent, false when the site has no mail set up. While the email log is on
 * (Settings > Email log) each one is kept there, sent, failed or not sent; a `secret` one without its body.
 */
export async function sendMail(message: Mail): Promise<boolean> {
  const mail = { ...message, to: message.to.map(oneLine), subject: oneLine(message.subject), fromName: message.fromName && oneLine(message.fromName), replyTo: message.replyTo && oneLine(message.replyTo) };
  const text = mail.text || textVersion(mail.html);
  const log = async (status: 'sent' | 'failed' | 'not-sent', via: string, error?: string) =>
    (await import('../mail-log')).logMail({ kind: mail.kind, to: mail.to, from: fromHeader(mail.fromName), replyTo: mail.replyTo, subject: mail.subject, html: mail.html, text, secret: mail.secret, status, via, error });
  try {
    const sent = await deliver(mail, text);
    await log(sent ? 'sent' : 'not-sent', sent ?? '');
    return !!sent;
  } catch (e) {
    await log('failed', bindings()?.EMAIL ? 'email-service' : 'smtp', (e as Error).message);
    throw e;
  }
}

/** Sends through Email Service or SMTP: how it went out, or null with neither set up. */
async function deliver(mail: Mail & { fromName?: string }, text: string): Promise<'email-service' | 'smtp' | null> {
  const email = bindings()?.EMAIL;
  if (email) {
    await email.send({ from: party(fromHeader(mail.fromName)), to: mail.to, replyTo: mail.replyTo ? party(mail.replyTo) : undefined, subject: mail.subject, html: mail.html, text });
    return 'email-service';
  }
  const t = transport();
  if (!t) {
    console.warn(`[forms] no SMTP configured; not sending "${mail.subject}" to ${mail.to.join(', ')}`);
    return null;
  }
  // Loaded when mail goes out: it needs the Worker's sockets, which scripts in Node don't have.
  const { WorkerMailer } = await import('worker-mailer');
  await WorkerMailer.send(
    {
      host: t.host,
      port: t.port,
      secure: t.secure,
      // Upgrade a plain connection when the server offers it (a local catcher may not).
      startTls: !t.secure,
      ...(t.user ? { credentials: { username: t.user, password: t.pass ?? '' }, authType: ['plain', 'login'] as ('plain' | 'login')[] } : {}),
    },
    { from: party(fromHeader(mail.fromName)), to: mail.to, reply: mail.replyTo ? party(mail.replyTo) : undefined, subject: mail.subject, html: mail.html, text },
  );
  return 'smtp';
}
