// Invitations (Users and Members screens), sent by the site over SMTP so they last INVITE_DAYS rather than
// Supabase Auth's email link lifetime (an hour by default, a day at most). The link
// (/api/auth/invite?t=) is signed here and names the account, its expiry, where it leads and the
// account's current invitation (`app_metadata.invite`, a random value): sending a new one replaces it,
// and setting a password clears it (`passwordSet`), so older links and used ones stop working. Opening
// the link signs in with a fresh password-reset token and lands on the page that sets a password.
// Without SMTP, Supabase Auth sends its own invitation (or a password link, once the address is
// confirmed) as before. Waiting for a password: an open invitation, or an invited account with no
// password at all (`awaiting_password()`). Server only: it uses the service key.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { serviceClient } from '../supabase';
import { sendMail } from '../forms/mail';
import { site } from '../site';
import { accountUrl } from '../members/account';

export const INVITE_DAYS = 7;

/** Where an invitation leads: the admin's set-password page or a member's account page. */
export type InviteTo = 'admin' | 'member';
export const invitePath = (to: InviteTo) => (to === 'admin' ? '/admin/set-password/' : accountUrl({ view: 'password' }));

const env = (k: string) => (import.meta.env?.[k] as string | undefined) ?? process.env[k];
const key = () => createHash('sha256').update(`invites:${env('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`).digest();
const sig = (to: string, id: string, exp: string, nonce: string) => createHmac('sha256', key()).update(`${to}:${id}:${exp}:${nonce}`).digest('base64url').slice(0, 32);

/** The ids of accounts waiting to set a password. */
export async function awaitingPassword(): Promise<Set<string>> {
  const { data } = await serviceClient().rpc('awaiting_password');
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

/** After someone sets their password: their invitation's link stops working. */
export async function passwordSet(user: User) {
  if (user.app_metadata?.invite) await serviceClient().auth.admin.updateUserById(user.id, { app_metadata: { invite: null } });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' } as Record<string, string>)[c]};`);

/** Email an account its invitation, replacing any earlier one. */
async function mailInvite(user: User, to: InviteTo, origin: string): Promise<{ email: string; note: string } | { error: string }> {
  const email = user.email!;
  const nonce = randomBytes(12).toString('base64url');
  const exp = Math.floor(Date.now() / 1000 + INVITE_DAYS * 86400).toString(36);
  const url = `${origin}/api/auth/invite?t=${to}.${user.id}.${exp}.${sig(to, user.id, exp, nonce)}`;
  const what = to === 'admin' ? `to help edit the ${site.name} website` : `to join ${site.name} as a member`;
  const html = `<p>Hello,</p><p>You've been invited ${esc(what)}. Choose a password to get started:</p><p><a href="${esc(url)}" style="display:inline-block;padding:10px 18px;background:#1a1a2e;color:#ffffff;text-decoration:none;border-radius:3px">Set your password</a></p><p style="color:#666666;font-size:13px">This link works for ${INVITE_DAYS} days, until you've set a password. If you weren't expecting it, you can ignore this email.</p>`;
  const text = `You've been invited ${what}. Choose a password to get started:\n\n${url}\n\nThis link works for ${INVITE_DAYS} days, until you've set a password.`;
  const { error } = await serviceClient().auth.admin.updateUserById(user.id, { app_metadata: { invite: nonce } });
  if (error) return { error: error.message };
  try {
    if (await sendMail({ to: [email], subject: `You're invited to ${site.name}`, html, text })) return { email, note: `The link lasts ${INVITE_DAYS} days.` };
  } catch (e) {
    return { error: `The invitation couldn't be sent: ${(e as Error).message}` };
  }
  // No SMTP: Supabase Auth's own email, whose link lasts as its settings say.
  const auth = serviceClient().auth;
  const redirectTo = `${origin}${invitePath(to)}`;
  const { error: e2 } = user.email_confirmed_at ? await auth.resetPasswordForEmail(email, { redirectTo }) : await auth.admin.inviteUserByEmail(email, { redirectTo, data: user.user_metadata });
  return e2 ? { error: e2.message } : { email, note: 'Sent by Supabase Auth (no SMTP set up), so the link lasts only as long as its Email OTP Expiration.' };
}

/** Invite a new address: the account is made (invited, no password) and emailed its link. */
export async function invite(email: string, to: InviteTo, origin: string, data?: Record<string, unknown>): Promise<{ user: User; email: string; note: string } | { error: string }> {
  const { data: made, error } = await serviceClient().auth.admin.generateLink({ type: 'invite', email, options: { data } });
  if (error || !made.user) return { error: error?.message ?? 'The account couldn’t be made.' };
  const res = await mailInvite(made.user, to, origin);
  return 'error' in res ? res : { ...res, user: made.user };
}

/** Send an account still waiting for a password a new invitation. */
export async function resendInvite(id: string, to: InviteTo, origin: string): Promise<{ email: string; note: string } | { error: string }> {
  if (!id) return { error: 'No account.' };
  const { data, error } = await serviceClient().auth.admin.getUserById(id);
  if (error || !data.user?.email) return { error: error?.message ?? 'No such account.' };
  if (!(await awaitingPassword()).has(id)) return { error: `${data.user.email} has already set a password; send a password link instead.` };
  return mailInvite(data.user, to, origin);
}

/** The account and destination an invitation link is for, if it is signed here, unexpired and still the account's open invitation. */
export async function openInvite(token: string | null): Promise<{ user: User; to: InviteTo } | { error: string; to: InviteTo }> {
  const m = (token ?? '').match(/^(admin|member)\.([0-9a-f-]{36})\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{32})$/);
  const to = (m?.[1] ?? 'admin') as InviteTo;
  const bad = { error: 'This invitation has expired, was replaced by a newer one, or was already used. Ask for a new one.', to };
  if (!m || parseInt(m[3], 36) * 1000 < Date.now()) return bad;
  const { data } = await serviceClient().auth.admin.getUserById(m[2]);
  const nonce = data?.user?.app_metadata?.invite;
  if (!data?.user || typeof nonce !== 'string') return bad;
  const want = Buffer.from(sig(m[1], m[2], m[3], nonce));
  const got = Buffer.from(m[4]);
  return want.length === got.length && timingSafeEqual(want, got) ? { user: data.user, to } : bad;
}
