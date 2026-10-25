// Outgoing mail (form notifications, accounts, tickets, confirmations), sent as HTML with a plain-text
// version over SMTP, so any provider works (Mailgun, SES, Postmark, Resend, a mail server; locally the
// Supabase stack's mail catcher, so nothing real is sent), through the Worker's TCP sockets
// (worker-mailer; port 25 is closed to Workers, so 587 or 465). Settings come from the environment
// (see transport()); without them mail is logged and skipped, and submissions are still stored.
import { site } from '../site';

const env = (k: string) => process.env[k] ?? (import.meta.env?.[k] as string | undefined);

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

export async function sendMail(mail: Mail): Promise<boolean> {
  const t = transport();
  if (!t) {
    console.warn(`[forms] no SMTP configured; not sending "${mail.subject}" to ${mail.to.join(', ')}`);
    return false;
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
    { from: party(fromHeader(mail.fromName)), to: mail.to, reply: mail.replyTo ? party(mail.replyTo) : undefined, subject: mail.subject, html: mail.html, text: mail.text || textVersion(mail.html) },
  );
  return true;
}
