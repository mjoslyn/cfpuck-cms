// The emails accounts get from the site (over SMTP, src/lib/forms/mail.ts): invitations, password links
// and confirming an address. Each is a short message with one button. Without SMTP nothing can be
// sent: `sendLink` says so, and the caller decides (admins are shown the link to pass on; a visitor's
// own request is answered the same either way, the link only logged on the server).
import { sendMail } from '../forms/mail';
import { site } from '../site';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' } as Record<string, string>)[c]};`);

export interface LinkEmail {
  to: string;
  subject: string;
  /** What the email is for, a sentence before the button. */
  intro: string;
  button: string;
  url: string;
  /** The small print under the button (how long the link works). */
  note: string;
}

/** Send a link email: 'sent', or 'no-smtp' when the site has no mail set up. */
export async function sendLink(m: LinkEmail): Promise<'sent' | 'no-smtp'> {
  const html = `<p>Hello,</p><p>${esc(m.intro)}</p><p><a href="${esc(m.url)}" style="display:inline-block;padding:10px 18px;background:#1a1a2e;color:#ffffff;text-decoration:none;border-radius:3px">${esc(m.button)}</a></p><p style="color:#666666;font-size:13px">${esc(m.note)}</p>`;
  const text = `${m.intro}\n\n${m.url}\n\n${m.note}`;
  return (await sendMail({ to: [m.to], subject: m.subject, html, text })) ? 'sent' : 'no-smtp';
}

/** A password link (forgot password, or an admin sending one). */
export const passwordEmail = (to: string, url: string): LinkEmail => ({
  to,
  subject: `Set a new password for ${site.name}`,
  intro: `Someone asked to set a new password for your ${site.name} account. Choose one here:`,
  button: 'Set a new password',
  url,
  note: 'This link works for an hour, once. If you didn’t ask for it, you can ignore this email.',
});

/** Confirming a new account's address. */
export const confirmEmailMessage = (to: string, url: string): LinkEmail => ({
  to,
  subject: `Confirm your email for ${site.name}`,
  intro: `Thanks for creating an account with ${site.name}. Confirm your email address to sign in:`,
  button: 'Confirm my email',
  url,
  note: 'This link works for a day. If you didn’t create an account, you can ignore this email.',
});
