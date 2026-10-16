// Mailing (src/lib/mailing/): the Subscribe block (a sign-up form for the public lists, anywhere on the
// site; it posts to /api/mail/subscribe, which emails a confirmation link) and the Email preferences
// block (confirming a sign-up, unsubscribing, and choosing lists, for whoever the page's signed link is
// for, or the signed-in visitor). The built-in /subscribe/, /unsubscribe/ and /email-preferences/ pages
// show them; a page with one of those addresses takes its place. The preferences block's pages depend on
// who views them, so they are never cached.
import type { Renderer, RenderCtx } from '../env';
import { esc } from '../html';
import { attrs, escAttr, styleDecls } from './style';
import { CONSENT_TEXT, PREFERENCES_PATH, SUBSCRIBE_PATH, mailingSettings, type MailList } from '../../lib/mailing/config';
import type { PrefsData } from '../../lib/mailing/page-data';

export const LISTS_KEY = 'mail-lists';
export const PREFS_KEY = 'mail-prefs';

const p = (cls: string, html: string) => `<p class="${cls}">${html}</p>`;
const lists = (ctx: RenderCtx) => (ctx.data.get(LISTS_KEY) as MailList[] | undefined) ?? [];

/** The lists a Subscribe block offers: the public ones it names, else every public one. */
function offered(ctx: RenderCtx, ids: unknown): MailList[] {
  const all = lists(ctx).filter((l) => l.public);
  const chosen = Array.isArray(ids) ? ids.map(Number) : [];
  const named = all.filter((l) => chosen.includes(l.id));
  return named.length ? named : all;
}

const SUBSCRIBE_MESSAGES: Record<string, string> = {
  sent: 'Thanks! Check your email: we’ve sent a link to confirm your subscription.',
};

/** Subscribe: email (and name), the lists to choose from when there are several, the consent wording and a button. */
const subscribe: Renderer = (b, env) => {
  const { ctx } = env;
  const a = b.attrs;
  const s = mailingSettings(ctx.settings.site);
  if (!s.enabled) return ctx.editor ? '<div class="cms-editor-note">Mailing is off (Settings &gt; Mailing): this block shows nothing.</div>' : '';
  const choices = offered(ctx, a.lists);
  if (!choices.length) return ctx.editor ? '<div class="cms-editor-note">No mailing lists yet: add one on the Mailing screen.</div>' : '';
  const id = `subscribe-${b.id}`;
  const q = ctx.queried.url.searchParams;
  const mine = q.get('subscribe_block') === b.id || (!q.get('subscribe_block') && ctx.queried.url.pathname === SUBSCRIBE_PATH);
  const sent = mine && q.get('subscribe') === 'sent';
  const error = mine && q.get('subscribe_error') ? q.get('subscribe_error')!.slice(0, 300) : '';
  const heading = a.heading ? `<h2 class="c-subscribe__heading">${esc(a.heading)}</h2>` : '';
  const intro = a.text ? p('c-subscribe__text', esc(a.text)) : '';
  if (sent) return `<section ${attrs(['c-subscribe', a.className], styleDecls(a.style), { id })}>${heading}<p class="c-subscribe__message" role="status" tabindex="-1" data-focus>${SUBSCRIBE_MESSAGES.sent}</p></section>`;
  const field = (name: string, label: string, type: string, auto: string, required: boolean) =>
    `<div class="c-field c-subscribe__field"><label class="c-field__label" for="${id}-${name}">${label}</label><input class="c-input" id="${id}-${name}" name="${name}" type="${type}" autocomplete="${auto}"${required ? ' required' : ''} /></div>`;
  const listField =
    choices.length > 1
      ? `<fieldset class="c-field c-subscribe__lists"><legend class="c-field__label">${esc(a.listsLabel || 'What would you like to receive?')}</legend><div class="c-choices">${choices
          .map((l, i) => `<label class="c-choice" for="${id}-list-${i}"><input id="${id}-list-${i}" type="checkbox" name="lists" value="${l.id}"${i === 0 ? ' checked' : ''} /><span>${esc(l.name)}${l.description ? `<span class="c-subscribe__desc">${esc(l.description)}</span>` : ''}</span></label>`)
          .join('')}</div></fieldset>`
      : `<input type="hidden" name="lists" value="${choices[0].id}" />`;
  const consent = a.consentText || s.consentText || CONSENT_TEXT;
  const hp = `<div class="c-field is-hp" aria-hidden="true"><label for="${id}-hp">Leave this empty</label><input id="${id}-hp" name="_hp" type="text" tabindex="-1" autocomplete="off" /></div>`;
  const back = ctx.queried.url.pathname;
  const form =
    `<form class="c-subscribe__form${a.layout === 'inline' ? ' is-inline' : ''}" method="post" action="/api/mail/subscribe">` +
    `<input type="hidden" name="back" value="${escAttr(back)}" /><input type="hidden" name="block" value="${escAttr(b.id)}" /><input type="hidden" name="consent" value="${escAttr(consent)}" />` +
    `<div class="c-subscribe__fields">${a.showName ? field('name', 'Name', 'text', 'name', false) : ''}${field('email', 'Email', 'email', 'email', true)}${a.layout === 'inline' ? `<button type="submit" class="c-button__link c-subscribe__submit">${esc(a.button || 'Subscribe')}</button>` : ''}</div>` +
    listField +
    p('c-subscribe__consent', esc(consent)) +
    hp +
    (a.layout === 'inline' ? '' : `<div class="c-subscribe__footer"><button type="submit" class="c-button__link c-subscribe__submit">${esc(a.button || 'Subscribe')}</button></div>`) +
    `</form>`;
  const err = error ? `<p class="c-subscribe__message is-error" role="alert" tabindex="-1" data-focus>${esc(error)}</p>` : '';
  return `<section ${attrs(['c-subscribe', a.className], styleDecls(a.style), { id })}>${heading}${intro}${err}${form}</section>`;
};

const PREFS_MESSAGES: Record<string, string> = {
  saved: 'Your choices are saved.',
  unsubscribed: 'You’re unsubscribed. You won’t get any more email from us.',
  'unsubscribed-list': 'You’re unsubscribed from that list.',
  confirmed: 'Thanks! Your subscription is confirmed.',
  sent: 'Check your email: we’ve sent a link to confirm.',
};

const button = (label: string, extra = '') => `<button type="submit" class="c-button__link"${extra}>${label}</button>`;
const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escAttr(value)}" />`;

/** The public lists with a checkbox each (ticked: subscribed), and Save. */
function listForm(ctx: RenderCtx, d: PrefsData, back: string): string {
  const all = lists(ctx).filter((l) => l.public);
  if (!all.length) return '';
  const on = (id: number) => d.contact?.status === 'subscribed' && d.lists[id] === 'subscribed';
  return (
    `<form class="c-prefs__form" method="post" action="/api/mail/preferences">${d.token ? hidden('t', d.token) : ''}${hidden('back', back)}${hidden('action', 'save')}` +
    `<fieldset class="c-field"><legend class="c-field__label">Email you receive</legend><div class="c-choices">${all
      .map((l, i) => `<label class="c-choice" for="prefs-${i}"><input id="prefs-${i}" type="checkbox" name="lists" value="${l.id}"${on(l.id) ? ' checked' : ''} /><span>${esc(l.name)}${l.description ? `<span class="c-subscribe__desc">${esc(l.description)}</span>` : ''}</span></label>`)
      .join('')}</div></fieldset><div class="c-prefs__actions">${button('Save')}</div></form>`
  );
}

function unsubscribeForm(d: PrefsData, back: string, label = 'Unsubscribe from all', list?: number, campaign?: string): string {
  return `<form class="c-prefs__unsubscribe" method="post" action="/api/mail/unsubscribe">${hidden('t', d.token)}${hidden('back', back)}${list ? hidden('l', String(list)) : ''}${campaign ? hidden('c', campaign) : ''}${button(label)}</form>`;
}

/** Email preferences: confirm, unsubscribe or choose lists (`attrs.view`: preferences, the default, or unsubscribe). */
const mailPreferences: Renderer = (b, env) => {
  const { ctx } = env;
  const a = b.attrs;
  if (!mailingSettings(ctx.settings.site).enabled) return ctx.editor ? '<div class="cms-editor-note">Mailing is off (Settings &gt; Mailing): this block shows nothing.</div>' : '';
  const box = (html: string) => `<section ${attrs(['c-prefs', a.className], styleDecls(a.style), { id: a.anchor })}>${html}</section>`;
  if (ctx.editor) return box(`<h2 class="c-prefs__heading">${a.view === 'unsubscribe' ? 'Unsubscribe' : 'Email preferences'}</h2>${p('c-prefs__note', 'Shows the subscription of whoever followed a link from one of the site’s emails (or the signed-in member): confirm, choose lists, unsubscribe.')}`);
  const d = (ctx.data.get(PREFS_KEY) as PrefsData | undefined) ?? { mode: 'none', contact: null, lists: {}, token: '' };
  const q = ctx.queried.url.searchParams;
  const back = ctx.queried.url.pathname;
  const note = PREFS_MESSAGES[q.get('m') ?? ''] ? `<p class="c-prefs__message" role="status" tabindex="-1" data-focus>${PREFS_MESSAGES[q.get('m')!]}</p>` : '';
  const error = q.get('error') ? `<p class="c-prefs__message is-error" role="alert" tabindex="-1" data-focus>${esc(q.get('error')!.slice(0, 300))}</p>` : '';
  const head = (title: string) => `<h2 class="c-prefs__heading">${title}</h2>${note}${error}`;
  const c = d.contact;
  if (d.mode === 'none' || !c) {
    const signedIn = ctx.viewer?.email;
    if (signedIn && d.mode === 'viewer') {
      return box(head('Email preferences') + p('c-prefs__note', `Choose what we send to ${esc(signedIn)}. New subscriptions are confirmed by email.`) + listForm(ctx, d, back));
    }
    return box(head(a.view === 'unsubscribe' ? 'Unsubscribe' : 'Email preferences') + p('c-prefs__note', `Use the link at the bottom of any of our emails to manage your subscription${mailingSettings(ctx.settings.site).enabled ? `, or <a href="${SUBSCRIBE_PATH}">subscribe</a>` : ''}.`));
  }
  const who = esc(c.email);
  if (d.mode === 'confirm') {
    const waiting = lists(ctx).filter((l) => d.lists[l.id] === 'pending');
    if (c.status === 'subscribed' && !waiting.length) return box(head('You’re subscribed') + p('c-prefs__note', `${who} is confirmed.`) + listForm(ctx, { ...d, mode: 'manage', token: d.manage! }, PREFERENCES_PATH));
    const which = waiting.length ? waiting.map((l) => esc(l.name)).join(', ') : 'our email';
    return box(head('Confirm your subscription') + p('c-prefs__note', `Send ${which} to ${who}?`) + `<form method="post" action="/api/mail/confirm">${hidden('confirm', d.token)}${button('Confirm my subscription')}</form>`);
  }
  if (['bounced', 'complained'].includes(c.status)) {
    return box(head('Email preferences') + p('c-prefs__note', `We don’t send to ${who} any more${c.status === 'bounced' ? ': our emails to it bounced' : ''}. <a href="${SUBSCRIBE_PATH}">Sign up again</a> to start receiving email.`));
  }
  if (a.view === 'unsubscribe' && q.get('m') !== 'unsubscribed') {
    const listId = Number(q.get('l')) || 0;
    const list = listId ? lists(ctx).find((l) => l.id === listId) : undefined;
    const campaign = /^\d+$/.test(q.get('c') ?? '') ? q.get('c')! : undefined;
    if (c.status === 'unsubscribed') return box(head('You’re unsubscribed') + p('c-prefs__note', `${who} gets no email from us.`) + p('c-prefs__note', `<a href="${PREFERENCES_PATH}?t=${escAttr(d.token)}">Changed your mind?</a>`));
    return box(
      head('Unsubscribe') +
        p('c-prefs__note', `Stop sending email to ${who}?`) +
        (list ? unsubscribeForm(d, back, `Unsubscribe from ${esc(list.name)} only`, list.id, campaign) : '') +
        unsubscribeForm(d, back, 'Unsubscribe from all', undefined, campaign) +
        p('c-prefs__note', `<a href="${PREFERENCES_PATH}?t=${escAttr(d.token)}">Choose which emails you get instead</a>`),
    );
  }
  const status = c.status === 'pending' ? p('c-prefs__note', 'Your subscription is waiting for confirmation: use the link in the email we sent.') : c.status === 'unsubscribed' ? p('c-prefs__note', `${who} is unsubscribed. Tick a list to subscribe again.`) : p('c-prefs__note', `For ${who}.`);
  return box(head('Email preferences') + status + listForm(ctx, d, PREFERENCES_PATH) + (c.status === 'subscribed' ? unsubscribeForm(d, PREFERENCES_PATH) : ''));
};

/** The member account page's email section (the signed-in member's own subscription). */
export function accountEmail(ctx: RenderCtx): string {
  if (!mailingSettings(ctx.settings.site).enabled || !ctx.viewer) return '';
  const d = (ctx.data.get(PREFS_KEY) as PrefsData | undefined) ?? { mode: 'viewer', contact: null, lists: {}, token: '' };
  const all = lists(ctx).filter((l) => l.public || mailingSettings(ctx.settings.site).memberLists?.includes(l.id));
  if (!all.length) return '';
  const on = (id: number) => d.contact?.status === 'subscribed' && d.lists[id] === 'subscribed';
  const pending = d.contact?.status === 'pending' || Object.values(d.lists).includes('pending');
  return (
    `<h2 class="c-account__heading">Email</h2>` +
    (pending ? p('c-account__note', 'A subscription is waiting for you to confirm it: use the link in the email we sent.') : '') +
    `<form class="c-prefs__form" method="post" action="/api/mail/preferences">${hidden('back', ctx.queried.url.pathname)}${hidden('action', 'save')}<div class="c-choices">${all
      .map((l, i) => `<label class="c-choice" for="account-list-${i}"><input id="account-list-${i}" type="checkbox" name="lists" value="${l.id}"${on(l.id) ? ' checked' : ''} /><span>${esc(l.name)}</span></label>`)
      .join('')}</div><div class="c-prefs__actions">${button('Save email choices')}</div></form>`
  );
}

export const MAILING_RENDERERS: Record<string, Renderer> = {
  subscribe,
  'mail-preferences': mailPreferences,
};
