// Accounts and sign-in (server only), with Better Auth on the site's own tables (users, sessions,
// accounts, verifications; migration *_auth_tables.sql): passwords, sessions in a signed cookie,
// password links and email confirmation. Its HTTP routes aren't mounted: the site's own endpoints
// (src/pages/api/auth/, src/pages/api/members/) call it and send its emails themselves
// (src/lib/auth/mail.ts), with links to the site's pages. Passwords carried over from Supabase Auth are
// bcrypt; they are checked as such and rehashed (scrypt) the next time their owner signs in.
import { betterAuth } from 'better-auth';
import { APIError, createEmailVerificationToken } from 'better-auth/api';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { getPool } from '../db/sql';
import { siteDb } from '../db/site';

const env = (k: string) => (import.meta.env?.[k] as string | undefined) ?? process.env[k];

/** The signed-in person, as the site reads them. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

/** The session cookie's name: `site.session_token` (Better Auth signs its value). */
export const COOKIE_PREFIX = 'site';

function makeAuth() {
  const secret = env('AUTH_SECRET');
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return betterAuth({
    secret,
    baseURL: env('SITE_URL') || 'http://localhost:4321',
    database: getPool(),
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // Confirmation (AUTH_CONFIRM_EMAIL) is checked by the site's sign-in routes, which can say why.
      requireEmailVerification: false,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => (hash.startsWith('$2') ? bcrypt.compare(password, hash) : verifyPassword({ hash, password })),
      },
    },
    emailVerification: { autoSignInAfterVerification: true, expiresIn: 24 * 3600 },
    user: {
      modelName: 'users',
      fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
      additionalFields: {
        invite: { type: 'string', required: false, input: false },
        invitedAt: { type: 'date', required: false, input: false, fieldName: 'invited_at' },
        lastSignInAt: { type: 'date', required: false, input: false, fieldName: 'last_sign_in_at' },
      },
    },
    session: {
      modelName: 'sessions',
      fields: { userId: 'user_id', expiresAt: 'expires_at', ipAddress: 'ip_address', userAgent: 'user_agent', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    account: {
      modelName: 'accounts',
      fields: {
        userId: 'user_id', accountId: 'account_id', providerId: 'provider_id', accessToken: 'access_token', refreshToken: 'refresh_token', idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at', refreshTokenExpiresAt: 'refresh_token_expires_at', createdAt: 'created_at', updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'verifications',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    advanced: { cookiePrefix: COOKIE_PREFIX, database: { generateId: () => crypto.randomUUID() } },
    databaseHooks: {
      // Every account has a profile (its role: viewer until an admin changes it).
      user: {
        create: {
          after: async (user) => {
            await siteDb().from('profiles').upsert({ id: user.id, display_name: user.name || user.email.split('@')[0] }, { onConflict: 'id', ignoreDuplicates: true });
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await siteDb().from('users').update({ last_sign_in_at: new Date().toISOString() }).eq('id', session.userId);
          },
        },
      },
    },
  });
}

let instance: ReturnType<typeof makeAuth> | null = null;
export const auth = () => (instance ??= makeAuth());
const context = () => auth().$context;

const userOf = (u: { id: string; email: string; name?: string | null; emailVerified?: boolean }): AuthUser => ({ id: u.id, email: u.email, name: u.name ?? '', emailVerified: !!u.emailVerified });

/** Whether a request carries the session cookie (most visitors don't, so most requests skip the lookup). */
export const hasSession = (request: Request) => new RegExp(`(^|;\\s*)(__Secure-)?${COOKIE_PREFIX}\\.session_token=`).test(request.headers.get('cookie') ?? '');

/** The signed-in person, or null. */
export async function sessionUser(request: Request): Promise<AuthUser | null> {
  if (!hasSession(request)) return null;
  const s = await auth().api.getSession({ headers: request.headers }).catch(() => null);
  return s?.user ? userOf(s.user) : null;
}

/** Whether addresses must be confirmed by email before their account signs in (AUTH_CONFIRM_EMAIL, default on). */
export const confirmEmail = () => env('AUTH_CONFIRM_EMAIL') !== 'false';

/** The Set-Cookie headers a call answered with. */
const cookiesOf = (res: Response) => res.headers.getSetCookie();

/** A redirect carrying cookies (signing in or out). */
export function redirectWith(location: string, cookies: string[], status = 303): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status, headers });
}

type SignIn = { ok: true; cookies: string[]; user: AuthUser } | { ok: false; error: string; unconfirmed?: AuthUser };

/** Sign in with a password: the session's cookies, or why not. */
export async function signIn(email: string, password: string, request: Request): Promise<SignIn> {
  const found = await userByEmail(email);
  const bad = { ok: false as const, error: 'That email and password don’t match an account.' };
  if (!found) return bad;
  const ctx = await context();
  const account = await ctx.internalAdapter.findCredentialAccount(found.id);
  if (!account?.password || !(await ctx.password.verify({ hash: account.password, password }))) return bad;
  if (confirmEmail() && !found.emailVerified) return { ok: false, error: 'Confirm your email address first: use the link we sent you.', unconfirmed: found };
  if (account.password.startsWith('$2')) await ctx.internalAdapter.updatePassword(found.id, await ctx.password.hash(password));
  const res = await auth().api.signInEmail({ body: { email: found.email, password }, headers: request.headers, asResponse: true });
  if (!res.ok) return bad;
  return { ok: true, cookies: cookiesOf(res), user: found };
}

/** Sign out: the cookies that clear the session. */
export async function signOut(request: Request): Promise<string[]> {
  if (!hasSession(request)) return [];
  const res = await auth().api.signOut({ headers: request.headers, asResponse: true }).catch(() => null);
  return res ? cookiesOf(res) : [];
}

// ----- accounts -----

interface UserRow { id: string; email: string; name: string; email_verified: boolean; invite: string | null; invited_at: string | null; last_sign_in_at: string | null; created_at: string }

const rowUser = (r: UserRow): AuthUser & { invite: string | null; invitedAt: string | null; lastSignInAt: string | null } => ({
  id: r.id, email: r.email, name: r.name, emailVerified: r.email_verified, invite: r.invite, invitedAt: r.invited_at, lastSignInAt: r.last_sign_in_at,
});

export async function userById(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data } = await siteDb().from('users').select('*').eq('id', id).maybeSingle();
  return data ? rowUser(data as UserRow) : null;
}

export async function userByEmail(email: string) {
  const { data } = await siteDb().from('users').select('*').eq('email', email.trim().toLowerCase()).maybeSingle();
  return data ? rowUser(data as UserRow) : null;
}

/** Every account (the Users and Members screens). */
export async function listUsers() {
  const { data } = await siteDb().from('users').select('*').order('email');
  return ((data ?? []) as UserRow[]).map(rowUser);
}

/** Make an account: with a password (sign-ups, scripts) or without (an invitation, `invited`). */
export async function createUser(input: { email: string; name?: string; password?: string; invited?: boolean; emailVerified?: boolean }): Promise<AuthUser> {
  const ctx = await context();
  const made = await ctx.internalAdapter.createUser({
    email: input.email.trim().toLowerCase(),
    name: input.name ?? '',
    emailVerified: input.emailVerified ?? false,
    ...(input.invited ? { invitedAt: new Date() } : {}),
  }, { method: 'email-password' });
  if (input.password) await ctx.internalAdapter.linkAccount({ userId: made.id, providerId: 'credential', accountId: made.id, password: await ctx.password.hash(input.password) });
  return userOf(made);
}

/** Set an account's password (a signed-in member changing it, scripts). */
export async function setPassword(userId: string, password: string): Promise<void> {
  const ctx = await context();
  const hash = await ctx.password.hash(password);
  if (await ctx.internalAdapter.findCredentialAccount(userId)) await ctx.internalAdapter.updatePassword(userId, hash);
  else await ctx.internalAdapter.linkAccount({ userId, providerId: 'credential', accountId: userId, password: hash });
}

/** Delete an account: its sessions, sign-in methods, profile and membership go with it. */
export async function deleteUser(id: string): Promise<void> {
  const ctx = await context();
  await ctx.internalAdapter.deleteUser(id);
}

/** Change an account's own columns (its invitation, its name). */
export async function updateUser(id: string, patch: Partial<Pick<UserRow, 'invite' | 'name' | 'email_verified'>>): Promise<void> {
  const { error } = await siteDb().from('users').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** The ids of accounts waiting to set a password: an open invitation, or invited with no password. */
export async function awaitingPassword(): Promise<Set<string>> {
  const { data } = await siteDb().from('users').select('id, invite, invited_at, accounts(password)').or('invite.not.is.null,invited_at.not.is.null');
  return new Set(((data ?? []) as { id: string; invite: string | null; accounts: { password: string | null }[] }[])
    .filter((u) => u.invite || !u.accounts.some((a) => a.password))
    .map((u) => u.id));
}

// ----- password links and confirmation -----

const PASSWORD_LINK_HOURS = 1;

/** A one-time token for setting an account's password, good for an hour (a password link, or an opened invitation). */
export async function passwordToken(userId: string, hours = PASSWORD_LINK_HOURS): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  const ctx = await context();
  await ctx.internalAdapter.createVerificationValue({ identifier: `reset-password:${token}`, value: userId, expiresAt: new Date(Date.now() + hours * 3600_000) });
  return token;
}

/** The account a password token is for, while it is good. */
export async function passwordTokenUser(token: string | null) {
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const ctx = await context();
  const v = await ctx.internalAdapter.findVerificationValue(`reset-password:${token}`);
  return v && v.expiresAt > new Date() ? userById(v.value) : null;
}

/**
 * Set the password a token is for, and sign its account in: the link reached their inbox, so their
 * address counts as confirmed and an open invitation is spent.
 */
export async function setPasswordWithToken(token: string, password: string, request: Request): Promise<SignIn> {
  const user = await passwordTokenUser(token);
  if (!user) return { ok: false, error: 'That link has expired or was already used. Ask for a new one.' };
  try {
    await auth().api.resetPassword({ body: { token, newPassword: password } });
  } catch (e) {
    return { ok: false, error: e instanceof APIError ? e.message : 'That link has expired or was already used. Ask for a new one.' };
  }
  await updateUser(user.id, { invite: null, email_verified: true });
  return signIn(user.email, password, request);
}

/** A token confirming an account's email address (good for a day). */
export async function confirmToken(email: string): Promise<string> {
  const ctx = await context();
  return createEmailVerificationToken(ctx.secret, email, undefined, 24 * 3600);
}

/** Confirm an address from its link: signs the account in (its cookies), or null for a bad link. */
export async function confirmAddress(token: string, request: Request): Promise<string[] | null> {
  const res = await auth().api.verifyEmail({ query: { token }, headers: request.headers, asResponse: true }).catch(() => null);
  return res && res.status < 400 ? cookiesOf(res) : null;
}
