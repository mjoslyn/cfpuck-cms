// Invitations (Users and Members screens), sent by the site over SMTP and lasting INVITE_DAYS. The link
// (/api/auth/invite?t=) is signed here and names the account, its expiry, where it leads and the
// account's current invitation (`users.invite`, a random value): sending a new one replaces it, and
// setting a password clears it (setPasswordWithToken in src/lib/auth), so older links and used ones stop
// working. Opening the link makes a one-time password token and lands on the page that sets a password.
// Without SMTP the admin is given the link to pass on. Waiting for a password: an open invitation, or
// an invited account with no password at all (`awaitingPassword`). Server only.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { site } from '../site';
import { accountUrl } from '../members/account';
import { createUser, updateUser, userById, awaitingPassword, type AuthUser } from '../auth';
import { sendLink } from '../auth/mail';

export { awaitingPassword };

export const INVITE_DAYS = 7;

/** Where an invitation leads: the admin's set-password page or a member's account page. */
export type InviteTo = 'admin' | 'member';
/** The page that sets a password, for a one-time token. */
export const passwordPage = (to: InviteTo, token?: string) =>
  to === 'admin' ? `/admin/set-password/${token ? `?token=${token}` : ''}` : accountUrl({ view: 'password', ...(token ? { token } : {}) });

const env = (k: string) => (import.meta.env?.[k] as string | undefined) ?? process.env[k];
const key = () => createHash('sha256').update(`invites:${env('AUTH_SECRET') ?? ''}`).digest();
const sig = (to: string, id: string, exp: string, nonce: string) => createHmac('sha256', key()).update(`${to}:${id}:${exp}:${nonce}`).digest('base64url').slice(0, 32);

type Sent = { email: string; note: string } | { error: string };

/** Email an account its invitation, replacing any earlier one. */
async function mailInvite(user: AuthUser, to: InviteTo, origin: string): Promise<Sent> {
  const nonce = randomBytes(12).toString('base64url');
  const exp = Math.floor(Date.now() / 1000 + INVITE_DAYS * 86400).toString(36);
  const url = `${origin}/api/auth/invite?t=${to}.${user.id}.${exp}.${sig(to, user.id, exp, nonce)}`;
  const what = to === 'admin' ? `to help edit the ${site.name} website` : `to join ${site.name} as a member`;
  await updateUser(user.id, { invite: nonce });
  try {
    const sent = await sendLink({
      to: user.email,
      subject: `You're invited to ${site.name}`,
      intro: `You've been invited ${what}. Choose a password to get started:`,
      button: 'Set your password',
      url,
      note: `This link works for ${INVITE_DAYS} days, until you've set a password. If you weren't expecting it, you can ignore this email.`,
    });
    if (sent === 'sent') return { email: user.email, note: `The link lasts ${INVITE_DAYS} days.` };
    return { email: user.email, note: `No email is set up (SMTP), so send them this link yourself; it lasts ${INVITE_DAYS} days: ${url}` };
  } catch (e) {
    return { error: `The invitation couldn't be sent: ${(e as Error).message}` };
  }
}

/** Invite a new address: the account is made (invited, no password) and emailed its link. */
export async function invite(email: string, to: InviteTo, origin: string, data?: { name?: string }): Promise<{ user: AuthUser; email: string; note: string } | { error: string }> {
  let user: AuthUser;
  try {
    user = await createUser({ email, name: data?.name, invited: true });
  } catch (e) {
    return { error: (e as Error).message || 'The account couldn’t be made.' };
  }
  const res = await mailInvite(user, to, origin);
  return 'error' in res ? res : { ...res, user };
}

/** Send an account still waiting for a password a new invitation. */
export async function resendInvite(id: string, to: InviteTo, origin: string): Promise<Sent> {
  if (!id) return { error: 'No account.' };
  const user = await userById(id);
  if (!user) return { error: 'No such account.' };
  if (!(await awaitingPassword()).has(id)) return { error: `${user.email} has already set a password; send a password link instead.` };
  return mailInvite(user, to, origin);
}

/** The account and destination an invitation link is for, if it is signed here, unexpired and still the account's open invitation. */
export async function openInvite(token: string | null): Promise<{ user: AuthUser; to: InviteTo } | { error: string; to: InviteTo }> {
  const m = (token ?? '').match(/^(admin|member)\.([0-9a-f-]{36})\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{32})$/);
  const to = (m?.[1] ?? 'admin') as InviteTo;
  const bad = { error: 'This invitation has expired, was replaced by a newer one, or was already used. Ask for a new one.', to };
  if (!m || parseInt(m[3], 36) * 1000 < Date.now()) return bad;
  const user = await userById(m[2]);
  if (!user?.invite) return bad;
  const want = Buffer.from(sig(m[1], m[2], m[3], user.invite));
  const got = Buffer.from(m[4]);
  return want.length === got.length && timingSafeEqual(want, got) ? { user, to } : bad;
}
