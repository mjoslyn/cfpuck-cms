// Tickets on a page: a ticket's types with quantities (a ticket is its own record, People > Tickets, that
// any number of events attach to and sell from: src/lib/tickets/setup.ts), the buyer's details and the
// ticket's questions, posting to /api/tickets/checkout; a waitlist form when it's sold out; the buyer's
// order when they come back (?order=<token>); and the outcome of a checkout (?tickets=<reason>&event=<ticket
// id>). The Event details block shows the page's event's ticket below its content, unless the page has a
// Tickets block for it. The Tickets block goes on any page or template: it shows the ticket it names
// (`ticket`, and `date` for one date of a ticket for one recurring event, else its next), else the page's
// own event's. Blocks from before tickets were their own records name an event (`event`): its ticket.
// The form posts the page it is on, so the buyer comes back there (src/lib/tickets/orders.ts ticketsAt).
// public/assets/js/tickets.js adds the running total and live availability; without it the form still
// works and the server checks everything.
import type { Env, Renderer, RenderCtx } from '../env';
import { ENTRY_COLUMNS, type Entry } from '../../lib/types';
import { defaultHorizon, expandEntry, recurrenceOf } from '../../lib/recurrence';
import { permalink } from '../../lib/permalink';
import { eventTimes, eventWhen } from '../../lib/events/model';
import { ACCOUNT_PATH, isActive, memberSettings } from '../../lib/members/config';
import { visibleTo } from '../../lib/data';
import { esc } from '../html';
import { ticketSpan } from '../../lib/tickets/span';
import { SITE_TZ } from '../../lib/site';
import {
  CHECKOUT_MESSAGES,
  DEFAULT_MAX_PER_ORDER,
  TICKET_KEY,
  localNow,
  maxFor,
  money,
  offSale,
  offeredTypes,
  remaining,
  forMembers,
  mayBuy,
  priceFor,
  ticketOf,
  ticketSettings,
  ticketsOf,
  type EventTickets,
  type TicketQuestion,
} from '../../lib/tickets/config';

export const TICKETS_SCRIPT = '<script src="/assets/js/tickets.js" defer></script>';

export interface TicketOrderStatus {
  code: string;
  status: string;
  name: string;
  email: string;
  items: { name: string; price: number; quantity: number }[];
  quantity: number;
  amount: number;
  currency: string;
  entry_id: number;
  occurrence: string;
}

interface TicketsData {
  sold: Record<string, number>;
  order?: TicketOrderStatus | null;
}

/** A ticket on a page: the event (date) it is shown for, and the ticket it sells. */
export interface TicketsTarget {
  /** The event, or one date of a recurring one: its title, date and link. */
  e: Entry;
  /** The ticket record: its setup (fields.tickets). */
  ticket: Entry;
  /** The ticket's id (orders, waitlist and what's taken are keyed by it). */
  id: number;
  /** The date, for a ticket of one recurring event (sold per date); else ''. */
  occurrence: string;
  /** The page's own event is attached to it: #tickets, without the event's name over the form. */
  own: boolean;
  /** Its events' timezone (sales windows) and when the last of them ends (sales close). */
  tz: string;
  endUtc: number | null;
  /** A Tickets block's ticket for several events: them, listed over the form under the ticket's name. */
  events?: Entry[];
}

const PAGE_KEY = 'tickets-page';

/** A ticket and the events attached to it, loaded once per page (published ones, as the page's loader sees them). */
async function loadTicket(ctx: RenderCtx, id: number): Promise<{ ticket: Entry; events: Entry[] } | null> {
  const key = `ticket:${id}`;
  if (ctx.data.has(key)) return ctx.data.get(key) as { ticket: Entry; events: Entry[] } | null;
  let found: { ticket: Entry; events: Entry[] } | null = null;
  if (id > 0) {
    const db = ctx.loader.db;
    const { data: ticket } = await db.from('entries').select(ENTRY_COLUMNS).eq('id', id).eq('type', 'ticket').maybeSingle<Entry>();
    if (ticket) {
      const q = db.from('entries').select(ENTRY_COLUMNS).eq('type', 'event').neq('status', 'trash').eq(`fields->>${TICKET_KEY}`, String(id)).order('event_start');
      const { data } = await visibleTo(q, ctx.loader.scope);
      found = { ticket, events: (data ?? []) as Entry[] };
    }
  }
  ctx.data.set(key, found);
  return found;
}

/** An event's ticket as a page shows it (`e`: the event, or one of its dates). Null when it has none. */
async function targetFor(ctx: RenderCtx, e: Entry, own: boolean): Promise<TicketsTarget | null> {
  const id = ticketOf(e.fields);
  const t = id ? await loadTicket(ctx, id) : null;
  if (!t) return null;
  // One recurring event sells per date; several events share one pool.
  const occurrence = t.events.length === 1 && recurrenceOf(t.events[0]) ? (e.occurrence ?? '') : '';
  const span = ticketSpan(t.events, occurrence);
  if (!span) return null;
  return { e, ticket: t.ticket, id, occurrence, own, tz: span.tz, endUtc: span.endUtc };
}

/** The page's own event's ticket (loadPageTicket). */
function pageEvent(ctx: RenderCtx): TicketsTarget | null {
  return (ctx.data.get(PAGE_KEY) as TicketsTarget | null | undefined) ?? null;
}

/** Loads the page's own event's ticket, once. */
async function loadPageTicket(ctx: RenderCtx) {
  if (ctx.data.has(PAGE_KEY)) return;
  const e = ctx.queried.entry;
  ctx.data.set(PAGE_KEY, e?.type === 'event' ? await targetFor(ctx, e, true) : null);
}

/** Whether a target is the page's own event's ticket (and date). */
export function isPageTickets(ctx: RenderCtx, t: TicketsTarget | null): boolean {
  const page = pageEvent(ctx);
  return !!t && !!page && page.id === t.id && page.occurrence === t.occurrence;
}

/** The anchor of the page's own event's tickets (ticketsAt in src/lib/tickets/orders.ts). */
export function pageTicketsAnchor(_ctx: RenderCtx): string {
  return '#tickets';
}
const dataKey = (t: Pick<TicketsTarget, 'id' | 'occurrence'>) => `tickets:${t.id}:${t.occurrence}`;
const blockKey = (blockId: string) => `tickets-target:${blockId}`;

/** An event a Tickets block names: its date `date`, or (recurring) its next date. Published only, outside the editor. */
async function namedEvent(ctx: RenderCtx, id: number, date: string): Promise<Entry | null> {
  const [series] = await ctx.loader.entriesByIds([id]);
  if (!series || series.type !== 'event' || (series.status !== 'publish' && !ctx.editor)) return null;
  if (!recurrenceOf(series)) return series;
  const dates = expandEntry(series, defaultHorizon());
  if (date) return dates.find((o) => o.occurrence === date) ?? null;
  const now = Date.now();
  return dates.find((o) => o.event_start && Date.parse(o.event_start) >= now) ?? dates[dates.length - 1] ?? null;
}

/** What a Tickets block shows: its ticket, the event it is for, and (in the editor) whether the block is part of what is being edited. */
interface TicketsBlock {
  target: TicketsTarget | null;
  /** The event the block's ticket is shown for, or the page's own (null: neither). */
  event: Entry | null;
  /** The ticket the block names, if it is there. */
  ticket: Entry | null;
  /** In the editor: the block is the page's own content, or the document being edited is a template. */
  editable: boolean;
}

/**
 * A ticket a Tickets block names, as the page shows it: for one event, that event (a recurring one's date
 * `date`, else its next); for several, all of them under the ticket's name. Null when it sells at no
 * event the page may show.
 */
async function namedTicket(ctx: RenderCtx, id: number, date: string): Promise<{ target: TicketsTarget | null; event: Entry | null; ticket: Entry | null }> {
  const t = await loadTicket(ctx, id);
  if (!t) return { target: null, event: null, ticket: null };
  const events = ctx.editor ? t.events : t.events.filter((e) => e.status === 'publish');
  if (!events.length) return { target: null, event: null, ticket: t.ticket };
  if (events.length === 1) {
    const event = await namedEvent(ctx, events[0].id, date);
    return { target: event ? await targetFor(ctx, event, false) : null, event, ticket: t.ticket };
  }
  const span = ticketSpan(t.events, '');
  if (!span) return { target: null, event: null, ticket: t.ticket };
  const e = { ...t.ticket, type: 'ticket' } as Entry;
  return { target: { e, ticket: t.ticket, id, occurrence: '', own: false, tz: span.tz, endUtc: span.endUtc, events }, event: null, ticket: t.ticket };
}

/** Whether a ticket sells: Tickets on, with ticket types to offer. */
const setUp = (t: TicketsTarget) => {
  const tickets = ticketsOf(t.ticket.fields);
  return !!tickets.enabled && offeredTypes(tickets).length > 0;
};

/** Whether a block id is among some items (and their slots). */
function hasBlock(items: unknown, id: string): boolean {
  if (!Array.isArray(items)) return false;
  return items.some((it: any) => it?.props?.id === id || Object.values(it?.props ?? {}).some((v) => Array.isArray(v) && hasBlock(v, id)));
}

/**
 * In the editor, whether a block is part of what is being edited: in content mode the page's own content
 * (its content documents are set before prepare), not the template around it; otherwise (a template,
 * or a page edited as its template) all of it.
 */
function editableBlock(ctx: RenderCtx, blockId: string): boolean {
  const e = ctx.queried.entry;
  const docs = e ? [...ctx.docs].filter(([key]) => key === `content:${e.id}` || key.startsWith(`content:${e.id}:`)) : [];
  return !docs.length || docs.some(([, items]) => hasBlock(items, blockId));
}

/** A Tickets block's ticket (prepare.ts): the one it names, else the page's own event's. Returns it, if any. */
export async function prepareTicketsBlock(ctx: RenderCtx, blockId: string, attrs: Record<string, any>): Promise<TicketsTarget | null> {
  // Worked out before the walk loads the page's content (the site), when only the editor has set it.
  const editable = !!ctx.editor && editableBlock(ctx, blockId);
  await loadPageTicket(ctx);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(attrs.date ?? '')) ? attrs.date : '';
  const ticketId = Number(attrs.ticket) || 0;
  const eventId = Number(attrs.event) || 0;
  let block: Omit<TicketsBlock, 'editable'> = { target: pageEvent(ctx), event: ctx.queried.entry?.type === 'event' ? ctx.queried.entry : null, ticket: pageEvent(ctx)?.ticket ?? null };
  if (ticketId) block = await namedTicket(ctx, ticketId, date);
  else if (eventId) {
    // Chosen before tickets were their own records: the event's ticket.
    const event = await namedEvent(ctx, eventId, date);
    const target = event ? await targetFor(ctx, event, false) : null;
    block = { target, event, ticket: target?.ticket ?? null };
  }
  const { target } = block;
  if (target && (ticketId || eventId) && isPageTickets(ctx, target)) target.own = true;
  ctx.data.set(blockKey(blockId), { ...block, editable } satisfies TicketsBlock);
  if (target) await prepareTickets(ctx, target);
  return target;
}

/** Loads what's taken and the buyer's order (for the Tickets and Event details blocks). */
export async function prepareTickets(ctx: RenderCtx, given?: TicketsTarget | null) {
  await loadPageTicket(ctx);
  const target = given === undefined ? pageEvent(ctx) : given;
  const tickets = target ? ticketsOf(target.ticket.fields) : null;
  if (!target || !tickets?.enabled) return;
  // Member prices and members-only tickets depend on who is buying.
  if (forMembers(tickets) && memberSettings(ctx.settings.site).enabled) ctx.personal = true;
  const { id, occurrence } = target;
  const key = dataKey(target);
  if (ctx.data.has(key) || id <= 0) return;
  const data: TicketsData = { sold: {} };
  const { data: sold } = await ctx.loader.db.rpc('ticket_sold', { p_entry: id, p_occurrence: occurrence });
  for (const r of (sold ?? []) as { type: string; quantity: number }[]) data.sold[r.type] = Number(r.quantity);
  const token = ctx.queried.url.searchParams.get('order');
  if (token) {
    const { data: rows } = await ctx.loader.db.rpc('ticket_order_status', { p_token: token });
    const order = (rows as TicketOrderStatus[] | null)?.[0];
    if (order && order.entry_id === id && order.occurrence === occurrence) data.order = order;
  }
  ctx.data.set(key, data);
  ctx.headScripts ??= [];
  if (!ctx.headScripts.includes(TICKETS_SCRIPT)) ctx.headScripts.push(TICKETS_SCRIPT);
}

const when = (local: string) => {
  const d = new Date(`${local.slice(0, 16)}:00Z`);
  return d.toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm');
};

/** "Saturday, October 24, 2026 at 7:00 pm". */
function eventDateText(e: Entry): string {
  const { start, end, allDay } = eventTimes(e);
  const { date, time } = eventWhen(start, end, allDay);
  return date + time;
}

function orderView(o: TicketOrderStatus): string {
  const lines = o.items.map((i) => `<li>${i.quantity} × ${esc(i.name)}${i.price ? ` <span class="c-tickets__muted">(${esc(money(i.price, o.currency))} each)</span>` : ''}</li>`).join('');
  const details = `<ul class="c-tickets__lines">${lines}</ul><p class="c-tickets__muted">Total: ${esc(money(o.amount, o.currency))}</p>`;
  switch (o.status) {
    case 'paid':
      return (
        `<div class="c-tickets__order is-paid" role="status" tabindex="-1" data-focus>` +
        `<p class="c-tickets__order-title">You're going, ${esc(o.name.split(/\s+/)[0])}!</p>` +
        `<p>Your order code is <strong class="c-tickets__code">${esc(o.code)}</strong>. Show it at the door. We sent a confirmation to ${esc(o.email)}.</p>` +
        details +
        `</div>`
      );
    case 'pending':
      return `<div class="c-tickets__order is-pending" role="status" data-tickets-pending><p class="c-tickets__order-title">Confirming your payment…</p><p>This takes a moment. The page will update on its own; you can also refresh it.</p>${details}</div>`;
    case 'refunded':
      return `<div class="c-tickets__order" role="status"><p class="c-tickets__order-title">Order ${esc(o.code)} was refunded.</p>${details}</div>`;
    default:
      return `<div class="c-tickets__order" role="status"><p class="c-tickets__order-title">Order ${esc(o.code)} is ${o.status === 'expired' ? 'expired: it was not paid in time' : 'cancelled'}.</p><p>No tickets were issued. You can order again below.</p></div>`;
  }
}

function question(q: TicketQuestion, uid: string): string {
  const id = `${uid}-a-${q.id}`;
  const req = q.required ? ' required aria-required="true"' : '';
  const label = `${esc(q.label)}${q.required ? ' <span class="c-field__req">(Required)</span>' : ''}`;
  const help = q.help ? `<p class="c-field__desc" id="${id}-desc">${esc(q.help)}</p>` : '';
  const desc = q.help ? ` aria-describedby="${id}-desc"` : '';
  const name = `a[${esc(q.id)}]`;
  switch (q.type) {
    case 'textarea':
      return `<div class="c-field is-textarea"><label class="c-field__label" for="${id}">${label}</label><textarea class="c-input" id="${id}" name="${name}" rows="4"${req}${desc}></textarea>${help}</div>`;
    case 'select':
      return `<div class="c-field is-select"><label class="c-field__label" for="${id}">${label}</label><select class="c-input" id="${id}" name="${name}"${req}${desc}><option value="">Choose…</option>${(q.choices ?? []).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>${help}</div>`;
    case 'checkbox':
      return `<div class="c-field is-consent"><label class="c-choice" for="${id}"><input id="${id}" type="checkbox" name="${name}" value="1"${req}${desc} /><span>${label}</span></label>${help}</div>`;
    default:
      return `<div class="c-field is-${q.type}"><label class="c-field__label" for="${id}">${label}</label><input class="c-input" id="${id}" name="${name}" type="${q.type === 'number' ? 'number' : 'text'}"${q.type === 'number' ? ' step="any" inputmode="decimal"' : ''}${req}${desc} /></div>`;
  }
}

/** Name, email and phone (as the event asks), for orders and the waitlist. */
function contactFields(t: EventTickets, uid: string): string {
  const field = (key: string, label: string, type: string, auto: string, required: boolean, span = 'span-6') =>
    `<div class="c-field ${span}"><label class="c-field__label" for="${uid}-${key}">${label}${required ? ' <span class="c-field__req">(Required)</span>' : ''}</label><input class="c-input" id="${uid}-${key}" name="${key}" type="${type}" autocomplete="${auto}"${required ? ' required aria-required="true"' : ''} /></div>`;
  return (
    field('name', 'Name', 'text', 'name', true) +
    field('email', 'Email', 'email', 'email', true) +
    (t.phone !== 'off' ? field('phone', 'Phone', 'tel', 'tel', t.phone === 'required') : '')
  );
}

function addressFields(t: EventTickets, uid: string): string {
  if (t.address === 'off') return '';
  // Asked only for paid orders: tickets.js shows it (and requires it) when the total isn't zero.
  const paidOnly = t.address === 'paid';
  const req = paidOnly ? '' : ' required aria-required="true"';
  const f = (key: string, label: string, auto: string, required: boolean, span: string) =>
    `<div class="c-field ${span}"><label class="c-field__label" for="${uid}-addr-${key}">${label}</label><input class="c-input" id="${uid}-addr-${key}" name="address[${key}]" type="text" autocomplete="${auto}"${required ? `${req} data-required` : ''} /></div>`;
  return (
    `<fieldset class="c-field c-tickets__address"${paidOnly ? ' data-tickets-paid-only' : ''}><legend class="c-field__label">Address${paidOnly ? ' <span class="c-field__req">(for paid tickets)</span>' : ''}</legend><div class="c-form__fields">` +
    f('line1', 'Street address', 'address-line1', true, '') +
    f('line2', 'Apartment, suite, etc.', 'address-line2', false, '') +
    f('city', 'City', 'address-level2', true, 'span-6') +
    f('state', 'State / province', 'address-level1', false, 'span-3') +
    f('zip', 'Postal code', 'postal-code', true, 'span-3') +
    f('country', 'Country', 'country-name', false, '') +
    `</div></fieldset>`
  );
}

const HONEYPOT = (uid: string) => `<div class="c-field is-hp" aria-hidden="true"><label for="${uid}-hp">Leave this empty</label><input id="${uid}-hp" name="_hp" type="text" tabindex="-1" autocomplete="off" /></div>`;

function waitlistForm(t: EventTickets, id: number, occurrence: string, uid: string, pageInput: string): string {
  const max = t.maxPerOrder || DEFAULT_MAX_PER_ORDER;
  return (
    `<div class="c-form c-tickets__waitlist"><p class="c-tickets__note">Join the waitlist and we'll email you if tickets become available.</p>` +
    `<form class="c-form__form" method="post" action="/api/tickets/waitlist">` +
    `<input type="hidden" name="event" value="${id}" /><input type="hidden" name="occurrence" value="${esc(occurrence)}" />${pageInput}` +
    `<div class="c-form__fields">${contactFields(t, `${uid}-w`)}` +
    `<div class="c-field span-6"><label class="c-field__label" for="${uid}-w-quantity">Tickets wanted</label><select class="c-input" id="${uid}-w-quantity" name="quantity">${Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select></div>` +
    `${HONEYPOT(`${uid}-w`)}</div>` +
    `<div class="c-form__footer"><button type="submit" class="c-button__link c-form__submit">Join the waitlist</button></div></form></div>`
  );
}

/** The tickets section for an event, the page's own by default ('' when it doesn't sell tickets). `note`: the editor's, under the heading. */
export function ticketsSection(env: Env, heading?: string, target = pageEvent(env.ctx), note = ''): string {
  if (!target) return '';
  const { e, id, occurrence } = target;
  const t = ticketsOf(target.ticket.fields);
  if (!t.enabled) return '';
  const data = (env.ctx.data.get(dataKey(target)) as TicketsData | undefined) ?? { sold: {} };
  const currency = ticketSettings(env.ctx.settings.site).currency ?? 'usd';
  const uid = `tickets-${id}${occurrence ? `-${occurrence}` : ''}`;
  const params = env.ctx.queried.url.searchParams;
  // A checkout's outcome shows on the section of the event it was for.
  const reason = !params.get('event') || params.get('event') === String(id) ? (params.get('tickets') ?? '') : '';
  const message = CHECKOUT_MESSAGES[reason] ? `<p class="c-tickets__message${reason === 'waitlisted' || reason === 'cancelled' ? '' : ' is-error'}" role="${reason === 'waitlisted' ? 'status' : 'alert'}" tabindex="-1" data-focus>${esc(CHECKOUT_MESSAGES[reason])}</p>` : '';
  const order = data.order ? orderView(data.order) : '';
  // The anchor the server sends buyers back to (ticketsAt in src/lib/tickets/orders.ts).
  const anchor = target.own ? 'tickets' : `tickets-${id}`;
  const title = heading || t.heading || 'Tickets';
  // Another event than the page's: which one, and when; a ticket for several: its name and theirs.
  const eventLine = (x: Entry) => `<a href="${esc(permalink(x))}">${esc(x.title)}</a><br /><span class="c-tickets__muted">${esc(eventDateText(x))}</span>`;
  const named = target.own
    ? ''
    : target.events?.length
      ? `<p class="c-tickets__event">${esc(target.ticket.title)}</p><ul class="c-tickets__events">${target.events.map((x) => `<li>${eventLine(x)}</li>`).join('')}</ul>`
      : `<p class="c-tickets__event">${eventLine(e)}</p>`;
  const head = `<section class="c-tickets${target.own ? '' : ' is-other'}" id="${anchor}" aria-labelledby="${uid}-title"><h2 class="c-tickets__heading" id="${uid}-title">${esc(title)}</h2>${note}${named}${message}${order}`;
  const pageInput = `<input type="hidden" name="page" value="${esc(env.ctx.queried.url.pathname)}" />`;
  const close = (body: string) => `${head}${body}</section>`;

  const now = localNow(target.tz);
  if (target.endUtc != null && target.endUtc < Date.now() && !env.ctx.editor) return close(`<p class="c-tickets__note">Ticket sales for this event have closed.</p>`);
  const types = offeredTypes(t);
  if (!types.length) return env.ctx.editor ? close('<p class="c-tickets__note">Add ticket types to its ticket under People &gt; Tickets.</p>') : '';
  const left = remaining(t, data.sold);
  const open = types.filter((x) => !offSale(x, now));
  if (!open.length) {
    const next = types.map((x) => x.salesStart).filter((s): s is string => !!s && s > now).sort()[0];
    return close(`<p class="c-tickets__note">${next ? `Tickets go on sale ${esc(when(next))}.` : 'Ticket sales for this event have closed.'}</p>`);
  }
  const soldOut = open.every((x) => left.types[x.id] === 0);
  // Member prices and members-only tickets: the buyer's membership (RenderCtx.viewer; none when Members is off).
  const member = env.ctx.viewer?.member ?? null;
  const members = memberSettings(env.ctx.settings.site);
  const buyable = open.filter((x) => mayBuy(x, member));
  const signIn = members.enabled ? ` <a href="${esc(`${ACCOUNT_PATH}?next=${encodeURIComponent(env.ctx.queried.url.pathname)}`)}">Sign in</a>` : '';
  if (soldOut) return close(`<p class="c-tickets__note is-sold-out">Sold out.</p>${t.waitlist !== 'off' ? waitlistForm(t, id, occurrence, uid, pageInput) : ''}`);

  const rows = types
    .map((x) => {
      const own = left.types[x.id];
      const off = offSale(x, now);
      const max = Math.min(maxFor(x, t), own ?? Infinity);
      const price = priceFor(x, member);
      const pick =
        off === 'not-yet' ? `<span class="c-tickets__state">On sale ${esc(when(x.salesStart!))}</span>`
        : off === 'ended' ? '<span class="c-tickets__state">Sales ended</span>'
        : own === 0 ? '<span class="c-tickets__state">Sold out</span>'
        : !mayBuy(x, member) ? `<span class="c-tickets__state">Members only</span>`
        : `<label class="c-sr-only" for="${uid}-q-${esc(x.id)}">${esc(x.name)}: how many</label><select class="c-input c-tickets__select" id="${uid}-q-${esc(x.id)}" name="q[${esc(x.id)}]" data-price="${price}">${Array.from({ length: max + 1 }, (_, i) => `<option value="${i}"${i === 1 && buyable.length === 1 ? ' selected' : ''}>${i}</option>`).join('')}</select>`;
      const few = own != null && own > 0 && own <= 10 && !off ? `<p class="c-tickets__left">${own} left</p>` : '';
      // A member's own price, or what members pay (the lowest of their prices) for everyone else.
      const memberPrices = Object.entries(x.memberPrices ?? {}).filter(([level]) => members.levels.some((l) => l.id === level)).map(([, p]) => p);
      const memberNote = !members.enabled ? ''
        : price !== x.price ? '<span class="c-tickets__member">Member price</span>'
        : !isActive(member) && memberPrices.length && Math.min(...memberPrices) < x.price ? `<span class="c-tickets__member">Members: ${esc(money(Math.min(...memberPrices), currency))}</span>`
        : '';
      return `<li class="c-tickets__type" data-type="${esc(x.id)}"><div class="c-tickets__info"><p class="c-tickets__name">${esc(x.name)}</p>${x.description ? `<p class="c-tickets__desc">${esc(x.description)}</p>` : ''}${few}</div><p class="c-tickets__price">${esc(money(price, currency))}${memberNote}</p><div class="c-tickets__qty">${pick}</div></li>`;
    })
    .join('');
  // Every ticket on sale is for members: the list, and how to sign in.
  if (!buyable.length) return close(`<ul class="c-tickets__types">${rows}</ul><p class="c-tickets__note">These tickets are for members.${isActive(member) ? ' Your membership doesn’t include them.' : signIn}</p>`);
  const anyPaid = buyable.some((x) => priceFor(x, member) > 0);
  const membersNote = buyable.length < open.length && !isActive(member) && signIn ? `<p class="c-tickets__note">Members: ${signIn.trim()} for members’ tickets and prices.</p>` : '';
  return close(
    membersNote +
    `<div class="c-form c-tickets__buy"><form class="c-form__form c-tickets__form" method="post" action="/api/tickets/checkout" data-tickets data-event="${id}" data-date="${esc(occurrence)}" data-currency="${esc(currency)}" data-max="${t.maxPerOrder || DEFAULT_MAX_PER_ORDER}">` +
      `<input type="hidden" name="event" value="${id}" /><input type="hidden" name="occurrence" value="${esc(occurrence)}" />${pageInput}` +
      `<ul class="c-tickets__types">${rows}</ul>` +
      `<p class="c-tickets__total" data-tickets-total hidden></p>` +
      `<div class="c-form__fields">${contactFields(t, uid)}${addressFields(t, uid)}${(t.questions ?? []).map((q) => question(q, uid)).join('')}${HONEYPOT(uid)}</div>` +
      `<div class="c-form__footer"><button type="submit" class="c-button__link c-form__submit" data-label-free="Register" data-label-paid="Continue to payment">${anyPaid ? 'Continue to payment' : 'Register'}</button></div>` +
      (anyPaid ? `<p class="c-tickets__muted c-tickets__fine">You'll pay on a secure checkout page. Your tickets are held for a few minutes while you pay.</p>` : '') +
      `</form></div>`,
  );
}

/**
 * The page's own event's tickets, under its Page content block (main area) when nothing else on the page
 * shows them: no Tickets block for it and no Event details block (which shows them itself). So an event
 * whose template has neither still sells the tickets added to it.
 */
export function ticketsAfterContent(env: Env): string {
  const target = pageEvent(env.ctx);
  if (!target || !setUp(target) || env.ctx.data.get('tickets-block') || env.ctx.data.get('event-details')) return '';
  return ticketsSection(env, undefined, target);
}

/** "From $25" / "Free" / "$10 – $40", for the event's details sidebar. */
export function ticketPriceSummary(env: Env): string {
  const ev = pageEvent(env.ctx);
  if (!ev) return '';
  const t = ticketsOf(ev.ticket.fields);
  const types = offeredTypes(t);
  if (!t.enabled || !types.length) return '';
  if (ev.endUtc != null && ev.endUtc < Date.now()) return '';
  const currency = ticketSettings(env.ctx.settings.site).currency ?? 'usd';
  const prices = types.map((x) => x.price).sort((a, b) => a - b);
  const [lo, hi] = [prices[0], prices[prices.length - 1]];
  return lo === hi ? money(lo, currency) : `${money(lo, currency)} – ${money(hi, currency)}`;
}

/** Ticket types the editor shows when there are no real ones, so the block can be seen and styled. */
const SAMPLE_TYPES = [
  { id: 'sample-1', name: 'General admission', price: 2500 },
  { id: 'sample-2', name: 'Student', description: 'With a student ID', price: 1500 },
];

/** The block in the editor without a ticket that sells: the form as it would be, with sample ticket types. */
function sampleTickets(env: Env, b: { attrs: Record<string, any> }, block: Partial<TicketsBlock>): string {
  const target = block.target ?? null;
  const base = block.event ?? null;
  const chosen = b.attrs.ticket || b.attrs.event;
  const why = b.attrs.ticket
    ? !block.ticket
      ? 'That ticket isn’t there.'
      : !target
        ? `${esc(block.ticket.title)} isn’t sold at a published event${base ? ' on that date' : ''} (attach events to it under People &gt; Tickets), so the site shows nothing here.`
        : `${esc(block.ticket.title)} has no ticket types yet (add them under People &gt; Tickets), so the site shows nothing here.`
    : b.attrs.event && !base
      ? 'That event isn’t there, or has no such date.'
      : base
        ? `${target?.own !== false && !chosen ? 'This event' : esc(base.title)} doesn’t sell tickets yet (attach it to a ticket with ticket types under People &gt; Tickets), so the site shows nothing here.`
        : 'On an event’s page this shows its tickets, and nothing for events that don’t sell any. Or choose a ticket in the block’s settings.';
  const note = `<p class="c-tickets__note c-tickets__sample">Sample tickets. ${why}</p>`;
  const source = target?.ticket ?? block.ticket ?? null;
  const fields = { tickets: { ...ticketsOf(source?.fields), enabled: true, types: SAMPLE_TYPES } };
  const ticket = { ...(source ?? { id: 0, type: 'ticket', slug: 'sample', title: 'Tickets' }), fields } as Entry;
  const e = (base ?? { id: 0, type: 'event', slug: 'sample', title: 'Event', fields: {} }) as Entry;
  return ticketsSection(env, b.attrs.heading, { e, ticket, id: target?.id ?? 0, occurrence: target?.occurrence ?? '', own: target?.own ?? (!chosen || !base), tz: target?.tz ?? SITE_TZ, endUtc: null, events: target?.events }, note);
}

export const TICKETS_RENDERERS: Record<string, Renderer> = {
  tickets: (b, env) => {
    const block = (env.ctx.data.get(blockKey(b.id)) ?? {}) as Partial<TicketsBlock>;
    if (block.target && setUp(block.target)) return ticketsSection(env, b.attrs.heading, block.target);
    // An event that doesn't sell tickets shows nothing, as does a template's block on such an event's page
    // in the editor; a block being edited shows the form with sample tickets.
    return env.ctx.editor && block.editable ? sampleTickets(env, b, block) : '';
  },
};
