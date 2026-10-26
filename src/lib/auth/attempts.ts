// Limits on sign-in tries and password links (server only): per address and per client address, counted
// like a form's submissions, as rows in a window. Each try is a row in `verifications` (identifier
// `attempt:<kind>:<key>`) that expires when it stops counting; Better Auth deletes expired rows whenever
// it looks one up, and recording a try deletes expired tries. Over a limit nothing is recorded, so a key
// never holds more rows than its limit. Addresses are kept as hashes.
import { createHash } from 'node:crypto';
import { siteDb } from '../db/site';
import { clientIp } from '../mailing/request';

export type AttemptKind = 'sign-in' | 'password-link';

/** Failed sign-ins in 15 minutes, and password links asked for in an hour. */
const LIMITS: Record<AttemptKind, { window: number; email: number; ip: number }> = {
  'sign-in': { window: 15 * 60_000, email: 10, ip: 30 },
  'password-link': { window: 3600_000, email: 3, ip: 20 },
};

const hash = (s: string) => createHash('sha256').update(s).digest('base64url');

/** The identifiers a try counts under: its email address and, when known, the visitor's address. */
function keys(kind: AttemptKind, email: string, request: Request) {
  const ip = clientIp(request);
  return [
    { id: `attempt:${kind}:email:${hash(email.trim().toLowerCase())}`, max: LIMITS[kind].email },
    ...(ip ? [{ id: `attempt:${kind}:ip:${hash(ip)}`, max: LIMITS[kind].ip }] : []),
  ];
}

/** Whether the address or the visitor has used up its tries for now. */
export async function overLimit(kind: AttemptKind, email: string, request: Request): Promise<boolean> {
  const now = new Date().toISOString();
  const counts = await Promise.all(keys(kind, email, request).map(async (k) => {
    const { count, error } = await siteDb().from('verifications').select('id', { count: 'exact', head: true }).eq('identifier', k.id).gt('expires_at', now);
    if (error) throw new Error(error.message);
    return (count ?? 0) >= k.max;
  }));
  return counts.some(Boolean);
}

/** Count a try (a failed sign-in, a password link asked for). */
export async function recordAttempt(kind: AttemptKind, email: string, request: Request): Promise<void> {
  const db = siteDb();
  const now = new Date();
  const expires = new Date(now.getTime() + LIMITS[kind].window).toISOString();
  await db.from('verifications').delete().like('identifier', 'attempt:%').lt('expires_at', now.toISOString());
  const { error } = await db.from('verifications').insert(keys(kind, email, request).map((k) => ({ id: crypto.randomUUID(), identifier: k.id, value: '', expires_at: expires })));
  if (error) throw new Error(error.message);
}

/** Forget an address's failed sign-ins (it signed in, or proved it is theirs with a password link). */
export async function clearAttempts(kind: AttemptKind, email: string): Promise<void> {
  await siteDb().from('verifications').delete().eq('identifier', `attempt:${kind}:email:${hash(email.trim().toLowerCase())}`);
}

/** A password link may be sent: under the limits, and counted. Over them the caller answers as if it was sent. */
export async function mayAskLink(email: string, request: Request): Promise<boolean> {
  if (await overLimit('password-link', email, request)) return false;
  await recordAttempt('password-link', email, request);
  return true;
}
