// Members (src/lib/members/): the Members only block (its blocks for members of some levels, a message
// and a sign-in link for everyone else), the sign-in prompt on a members-only page, the Member account
// block (signing in and up, the member's details; on /account/) and the Member link (Sign in / My
// account, set in the browser: pages with it stay cached). Pages showing members' things are never
// cached and are rendered again for signed-in visitors (RenderCtx.personal, src/pages/[...path].ts).
import type { Env, RenderCtx, Renderer } from '../env';
import type { Entry } from '../../lib/types';
import { esc } from '../html';
import { attrs, escAttr, styleDecls } from './style';
import { safeNext } from '../../lib/members/account';
import { ACCOUNT_PATH, MEMBERS_MESSAGE, accessOf, isActive, levelNames, mayView, memberSettings } from '../../lib/members/config';
import { CONSENT_TEXT, mailingSettings, type MailList } from '../../lib/mailing/config';
import { LISTS_KEY, accountEmail } from './mailing';

const account = (next?: string) => `${ACCOUNT_PATH}${next && next !== ACCOUNT_PATH ? `?next=${encodeURIComponent(next)}` : ''}`;
const p = (cls: string, html: string) => `<p class="${cls}">${html}</p>`;

/** For someone who may not see a members-only thing: the message, and how to get in. */
function prompt(ctx: RenderCtx, levels: string[], message?: string): string {
  const s = memberSettings(ctx.settings.site);
  const v = ctx.viewer;
  const which = levels.length ? levelNames(s, levels) : '';
  const msg = message || s.message || (which ? `This is for ${which} members.` : MEMBERS_MESSAGE);
  let how = '';
  if (!s.enabled) how = '';
  else if (!v) how = `<a href="${escAttr(account(ctx.queried.url.pathname))}">Sign in</a>${s.signup !== 'off' ? ' or create an account' : ''} to see it.`;
  else if (v.member?.status === 'pending') how = 'Your membership is waiting for approval.';
  else if (v.member && !isActive(v.member)) how = `Your membership isn’t active. <a href="${ACCOUNT_PATH}">Your account</a>`;
  else if (v.member) how = `Your membership doesn’t include it.`;
  else how = `You’re signed in as ${esc(v.email)}, without a membership.`;
  return `<div class="c-members-prompt">${p('c-members-prompt__message', esc(msg))}${how ? p('c-members-prompt__how', how) : ''}</div>`;
}

/** A members-only page's content, for someone who may not see it (entry-content). */
export function lockedContent(env: Env, post: Entry): string {
  return prompt(env.ctx, accessOf(post.fields).levels);
}

/** Members only: its blocks for members (of some levels), editors and the editor's canvas; a message for everyone else. */
const members: Renderer = (b, env, inner) => {
  const a = b.attrs;
  const levels: string[] = Array.isArray(a.levels) ? a.levels : [];
  const box = (html: string, extra: string[] = []) => `<div ${attrs(['c-members', ...extra, a.className], styleDecls(a.style), { id: a.anchor })}>${html}</div>`;
  if (env.ctx.editor) {
    const s = memberSettings(env.ctx.settings.site);
    return box(`<p class="c-members__label">Members only${levels.length ? `: ${esc(levelNames(s, levels))}` : ''}</p><div class="c-members__blocks">${inner()}</div>`, ['is-editing']);
  }
  if (mayView(env.ctx.viewer, levels)) return box(inner());
  return a.hide ? '' : box(prompt(env.ctx, levels, a.message), ['is-locked']);
};

const field = (name: string, label: string, type: string, auto: string, extra = '') =>
  `<div class="c-field"><label class="c-field__label" for="member-${name}">${label}</label><input class="c-input" id="member-${name}" name="${name}" type="${type}" autocomplete="${auto}" required${extra} /></div>`;
const form = (action: string, fields: string, button: string, hidden = '') =>
  `<div class="c-form"><form class="c-form__form" method="post" action="${action}">${hidden}<div class="c-form__fields">${fields}</div><div class="c-form__footer"><button type="submit" class="c-button__link c-form__submit">${button}</button></div></form></div>`;
const password = (label = 'Password') => field('password', label, 'password', 'new-password', ' minlength="10"') + field('confirm', 'Repeat it', 'password', 'new-password', ' minlength="10"');
/** A signed-in member's change: their current password first. */
const changePassword = () => field('current', 'Current password', 'password', 'current-password') + password('New password');

const MESSAGES: Record<string, string> = {
  'signed-out': 'You’re signed out.',
  sent: 'If that address has an account, we’ve sent it a link to set a new password.',
  'signed-up': 'Welcome! Your account is ready.',
  pending: 'Thanks! Your account is waiting for approval; we’ll let you know.',
  confirm: 'Thanks! Check your email for a link to confirm your address.',
  'password-saved': 'Your password is saved.',
};


/** Member account: sign in, sign up and reset a password; signed in, the member's details and sign out. */
const memberAccount: Renderer = (_b, env) => {
  const { ctx } = env;
  const s = memberSettings(ctx.settings.site);
  if (!s.enabled) return ctx.editor ? '<p class="c-members-prompt">Turn Members on under Settings > Members.</p>' : '';
  const q = ctx.queried.url.searchParams;
  const v = ctx.viewer;
  const note = MESSAGES[q.get('m') ?? ''] ? `<p class="c-account__message" role="status" tabindex="-1" data-focus>${MESSAGES[q.get('m')!]}</p>` : '';
  const error = q.get('error') ? `<p class="c-account__message is-error" role="alert" tabindex="-1" data-focus>${esc(q.get('error')!.slice(0, 300))}</p>` : '';
  const next = safeNext(q.get('next'));
  const head = (title: string) => `<h2 class="c-account__heading">${title}</h2>${note}${error}`;
  let body: string;
  const token = q.get('view') === 'password' ? (q.get('token') ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : '';
  if (token) {
    // An invitation or password link: setting the password signs them in.
    body = head('Set your password') + form('/api/members/password', password('New password'), 'Save password', `<input type="hidden" name="token" value="${token}" />`);
  } else if (v && q.get('view') === 'password') {
    body = head('Set your password') + p('c-account__note', `For ${esc(v.email)}.`) + form('/api/members/password', changePassword(), 'Save password');
  } else if (v) {
    const m = v.member;
    const level = m ? (s.levels.find((l) => l.id === m.level)?.name ?? m.level) : '';
    const state = !m ? '' : m.status === 'pending' ? 'waiting for approval' : m.status === 'suspended' ? 'suspended' : isActive(m) ? 'active' : 'expired';
    const when = m?.expires_on ? new Date(`${m.expires_on}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }) : '';
    const rows: [string, string][] = [
      ['Name', esc(v.name)],
      ['Email', esc(v.email)],
      ['Membership', m ? `${esc(level || 'Member')} (${state})` : 'None'],
      ...(when ? ([[isActive(m) ? 'Renews by' : 'Expired', esc(when)]] as [string, string][]) : []),
    ];
    body =
      head('Your account') +
      `<dl class="c-account__details">${rows.filter(([, x]) => x).map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join('')}</dl>` +
      (next ? p('c-account__note', `<a href="${escAttr(next)}">Back to where you were</a>`) : '') +
      accountEmail(ctx) +
      `<details class="c-account__more"><summary>Change your password</summary>${form('/api/members/password', changePassword(), 'Save password')}</details>` +
      `<form method="post" action="/api/members/logout" class="c-account__signout"><button type="submit" class="c-button__link">Sign out</button></form>`;
  } else {
    const nextInput = next ? `<input type="hidden" name="next" value="${escAttr(next)}" />` : '';
    const hp = `<div class="c-field is-hp" aria-hidden="true"><label for="member-hp">Leave this empty</label><input id="member-hp" name="_hp" type="text" tabindex="-1" autocomplete="off" /></div>`;
    body =
      head('Sign in') +
      form('/api/members/login', field('email', 'Email', 'email', 'email') + field('password', 'Password', 'password', 'current-password'), 'Sign in', nextInput) +
      `<details class="c-account__more"><summary>Forgot your password?</summary>${form('/api/members/forgot', field('email', 'Email', 'email', 'email').replace(/member-email/g, 'member-forgot-email'), 'Send a link')}</details>` +
      (s.signup !== 'off'
        ? `<h2 class="c-account__heading">Create an account</h2>${s.signup === 'approve' ? p('c-account__note', 'New accounts are approved by us before they become memberships.') : ''}` +
          form('/api/members/signup', field('name', 'Name', 'text', 'name').replace(/member-name/g, 'member-new-name') + field('email', 'Email', 'email', 'email').replace(/member-email/g, 'member-new-email') + password().replace(/member-(password|confirm)/g, 'member-new-$1') + mailOptIn(ctx) + hp, 'Create account', nextInput)
        : '');
  }
  // Invitation links bring the session in the address's fragment; member-account.js hands it to the server.
  const tag = '<script src="/assets/js/member-account.js" defer></script>';
  if (!ctx.scripts.includes(tag)) ctx.scripts.push(tag);
  return `<section class="c-account">${body}</section>`;
};

/** Member sign-up's email opt-in (Mailing on, with lists chosen for members under Settings > Mailing Lists): unticked, with the consent wording. */
function mailOptIn(ctx: RenderCtx): string {
  const m = mailingSettings(ctx.settings.site);
  const lists = ((ctx.data.get(LISTS_KEY) as MailList[] | undefined) ?? []).filter((l) => m.memberLists?.includes(l.id));
  if (!m.enabled || !lists.length) return '';
  return `<div class="c-field"><label class="c-choice" for="member-new-mail"><input id="member-new-mail" type="checkbox" name="mail_optin" value="1" /><span>Send me ${esc(lists.map((l) => l.name).join(' and '))} by email. ${esc(m.consentText || CONSENT_TEXT)}</span></label></div>`;
}

/** Member link: "Sign in", switched to "My account" in the browser for signed-in visitors (member-link.js). */
const memberLink: Renderer = (b, env) => {
  if (!memberSettings(env.ctx.settings.site).enabled) return env.ctx.editor ? '<span class="c-member-link">Sign in</span>' : '';
  const a = b.attrs;
  const tag = '<script src="/assets/js/member-link.js" defer></script>';
  if (!env.ctx.scripts.includes(tag)) env.ctx.scripts.push(tag);
  return `<a ${attrs(['c-member-link', a.className], styleDecls(a.style), { href: ACCOUNT_PATH, 'data-member-link': '', 'data-signed-in': a.signedInLabel || 'My account' })}>${esc(a.label || 'Sign in')}</a>`;
};

export const MEMBERS_RENDERERS: Record<string, Renderer> = {
  members,
  'member-account': memberAccount,
  'member-link': memberLink,
};
