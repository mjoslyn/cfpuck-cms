// Signed links in mailing emails and pages: a contact's id with an HMAC, so the preferences, unsubscribe
// and confirmation pages know who they are for without a stored token, and a link can't be changed to
// reach someone else. Each use has its own purpose, so a link made for one can't serve another. The key
// is MAIL_LINK_SECRET, else one made from AUTH_SECRET (changing either breaks links already sent; a site
// that moved off Supabase without one set it to `mail-links:<its old service_role key>`).
// Server only.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

let key: Buffer | null = null;
function secret(): Buffer {
  if (key) return key;
  const own = env('MAIL_LINK_SECRET');
  const base = own || `mail-links:${env('AUTH_SECRET') ?? ''}`;
  if (!own && !env('AUTH_SECRET')) throw new Error('Mailing links need MAIL_LINK_SECRET (or AUTH_SECRET)');
  key = createHash('sha256').update(base).digest();
  return key;
}

/** manage: preferences and unsubscribing; confirm: a sign-up's confirmation; click: a tracked link's recipient; seen: a click's interaction beacon. */
export type Purpose = 'manage' | 'confirm' | 'click' | 'seen';

const sig = (purpose: Purpose, id: string | number) => createHmac('sha256', secret()).update(`${purpose}:${id}`).digest('base64url').slice(0, 22);

/** "<id>.<signature>". */
export const sign = (purpose: Purpose, id: number) => `${id}.${sig(purpose, id)}`;

/** The id a token was signed for, or null when it wasn't signed here for this purpose. */
export function verify(purpose: Purpose, token: unknown): number | null {
  if (typeof token !== 'string') return null;
  const m = token.match(/^(\d{1,15})\.([A-Za-z0-9_-]{22})$/);
  if (!m) return null;
  const want = Buffer.from(sig(purpose, m[1]));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) ? Number(m[1]) : null;
}

/** SHA-256 of a lowercased address (mail_suppressions). */
export const emailHash = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
