// Tickets for an event: its ticket types with quantities, the buyer's details and the event's own
// questions, posting to /api/tickets/checkout; a waitlist form when it's sold out; the buyer's order when
// they come back (?order=<token>); and the outcome of a checkout (?tickets=<reason>&event=<id>). The
// Event details block shows the page's event's below its content, unless the page has a Tickets block
// for it. The Tickets block goes on any page or template: it shows the event it names (`event`, and
// `date` for one date of a recurring event, else its next), else the page's own event. The form posts
// the page it is on, so the buyer comes back there (src/lib/tickets/orders.ts ticketsAt).
// public/assets/js/tickets.js adds the running total and live availability; without it the form still
// works and the server checks everything.
import type { Env, Renderer, RenderCtx } from '../env';
import type { Entry } from '../../lib/types';
import { defaultHorizon, expandEntry, recurrenceOf } from '../../lib/recurrence';
import { permalink } from '../../lib/permalink';
import { eventTimes, eventWhen } from '../../lib/events/model';
import { esc } from '../html';
import { SITE_TZ } from '../../lib/site';
import {
  CHECKOUT_MESSAGES,
  DEFAULT_MAX_PER_ORDER,
  localNow,
  maxFor,
  money,
  offSale,
  offeredTypes,
  remaining,
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

/** An event (one date of a recurring one) whose tickets are shown; `own`: the page's own event. */
export interface TicketsTarget {
  e: Entry;
  id: number;
  occurrence: string;
  own: boolean;
}

const targetOf = (e: Entry, own: boolean): TicketsTarget => ({ e, id: e.series_id ?? e.id, occurrence: e.occurrence ?? '', own });

/** The page's own event. */
function pageEvent(ctx: RenderCtx): TicketsTarget | null {
  const e = ctx.queried.entry;
  return e && e.type === 'event' ? targetOf(e, true) : null;
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

/** What a Tickets block shows: its event, and (in the editor) whether the block is part of what is being edited. */
interface TicketsBlock {
  target: TicketsTarget | null;
  /** In the editor: the block is the page's own content, or the document being edited is a template. */
  editable: boolean;
}

/** Whether an event sells tickets: Tickets on, with ticket types to offer. */
const setUp = (t: TicketsTarget) => {
  const tickets = ticketsOf(t.e.fields);
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

/** A Tickets block's event (prepare.ts): the one it names, else the page's own. Returns it, if any. */
export async function prepareTicketsBlock(ctx: RenderCtx, blockId: string, attrs: Record<string, any>): Promise<TicketsTarget | null> {
  // Worked out before the walk loads the page's content (the site), when only the editor has set it.
  const editable = !!ctx.editor && editableBlock(ctx, blockId);
  const page = pageEvent(ctx);
  const id = Number(attrs.event) || 0;
  let target = page;
  if (id) {
    const e = await namedEvent(ctx, id, /^\d{4}-\d{2}-\d{2}$/.test(String(attrs.date ?? '')) ? attrs.date : '');
    target = e ? targetOf(e, !!page && page.id === (e.series_id ?? e.id) && page.occurrence === (e.occurrence ?? '')) : null;
  }
  ctx.data.set(blockKey(blockId), { target, editable } satisfies TicketsBlock);
  if (target) await prepareTickets(ctx, target);
  return target;
}

/** Loads what's taken and the buyer's order (for the Tickets and Event details blocks). */
export async function prepareTickets(ctx: RenderCtx, target = pageEvent(ctx)) {
  if (!target || !ticketsOf(target.e.fields).enabled) return;
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

/** The event's end as a local "Y-m-dTH:i" (all day: the end of its last day). */
function endsAt(e: Entry): string {
  const f = e.fields ?? {};
  const end = String(f.end || f.start || '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(end)) return '';
  return f.all_day === true || e.event_all_day === true ? `${end.slice(0, 10)}T23:59` : end.slice(0, 16).replace(' ', 'T');
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
  const t = ticketsOf(e.fields);
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
  // Another event than the page's: which one, and when.
  const named = target.own ? '' : `<p class="c-tickets__event"><a href="${esc(permalink(e))}">${esc(e.title)}</a><br /><span class="c-tickets__muted">${esc(eventDateText(e))}</span></p>`;
  const head = `<section class="c-tickets${target.own ? '' : ' is-other'}" id="${anchor}" aria-labelledby="${uid}-title"><h2 class="c-tickets__heading" id="${uid}-title">${esc(title)}</h2>${note}${named}${message}${order}`;
  const pageInput = `<input type="hidden" name="page" value="${esc(env.ctx.queried.url.pathname)}" />`;
  const close = (body: string) => `${head}${body}</section>`;

  const tz = e.fields?.timezone || SITE_TZ;
  const now = localNow(tz);
  const end = endsAt(e);
  if (end && now >= end && !env.ctx.editor) return close(`<p class="c-tickets__note">Ticket sales for this event have closed.</p>`);
  const types = offeredTypes(t);
  if (!types.length) return env.ctx.editor ? close('<p class="c-tickets__note">Add ticket types in the event settings (Tickets).</p>') : '';
  const left = remaining(t, data.sold);
  const open = types.filter((x) => !offSale(x, now));
  if (!open.length) {
    const next = types.map((x) => x.salesStart).filter((s): s is string => !!s && s > now).sort()[0];
    return close(`<p class="c-tickets__note">${next ? `Tickets go on sale ${esc(when(next))}.` : 'Ticket sales for this event have closed.'}</p>`);
  }
  const soldOut = open.every((x) => left.types[x.id] === 0);
  if (soldOut) return close(`<p class="c-tickets__note is-sold-out">Sold out.</p>${t.waitlist !== 'off' ? waitlistForm(t, id, occurrence, uid, pageInput) : ''}`);

  const rows = types
    .map((x) => {
      const own = left.types[x.id];
      const off = offSale(x, now);
      const max = Math.min(maxFor(x, t), own ?? Infinity);
      const pick =
        off === 'not-yet' ? `<span class="c-tickets__state">On sale ${esc(when(x.salesStart!))}</span>`
        : off === 'ended' ? '<span class="c-tickets__state">Sales ended</span>'
        : own === 0 ? '<span class="c-tickets__state">Sold out</span>'
        : `<label class="c-sr-only" for="${uid}-q-${esc(x.id)}">${esc(x.name)}: how many</label><select class="c-input c-tickets__select" id="${uid}-q-${esc(x.id)}" name="q[${esc(x.id)}]" data-price="${x.price}">${Array.from({ length: max + 1 }, (_, i) => `<option value="${i}"${i === 1 && open.length === 1 ? ' selected' : ''}>${i}</option>`).join('')}</select>`;
      const few = own != null && own > 0 && own <= 10 && !off ? `<p class="c-tickets__left">${own} left</p>` : '';
      return `<li class="c-tickets__type" data-type="${esc(x.id)}"><div class="c-tickets__info"><p class="c-tickets__name">${esc(x.name)}</p>${x.description ? `<p class="c-tickets__desc">${esc(x.description)}</p>` : ''}${few}</div><p class="c-tickets__price">${esc(money(x.price, currency))}</p><div class="c-tickets__qty">${pick}</div></li>`;
    })
    .join('');
  const anyPaid = open.some((x) => x.price > 0);
  return close(
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

/** "From $25" / "Free" / "$10 – $40", for the event's details sidebar. */
export function ticketPriceSummary(env: Env): string {
  const ev = pageEvent(env.ctx);
  if (!ev) return '';
  const t = ticketsOf(ev.e.fields);
  const types = offeredTypes(t);
  if (!t.enabled || !types.length) return '';
  const end = endsAt(ev.e);
  if (end && localNow(ev.e.fields?.timezone || SITE_TZ) >= end) return '';
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

/** The block in the editor without an event that sells tickets: the form as it would be, with sample ticket types. */
function sampleTickets(env: Env, b: { attrs: Record<string, any> }, target: TicketsTarget | null): string {
  const base = target?.e;
  const why = b.attrs.event && !target
    ? 'That event isn’t there, or has no such date.'
    : base
      ? `${target!.own ? 'This event' : esc(base.title)} doesn’t sell tickets yet (turn on Tickets and add ticket types in its settings), so the site shows nothing here.`
      : 'On an event’s page this shows its tickets, and nothing for events that don’t sell any. Or choose an event in the block’s settings.';
  const note = `<p class="c-tickets__note c-tickets__sample">Sample tickets. ${why}</p>`;
  const fields = { ...(base?.fields ?? {}), tickets: { ...ticketsOf(base?.fields), enabled: true, types: SAMPLE_TYPES } };
  const e = { ...(base ?? { id: 0, type: 'event', slug: 'sample', title: 'Event' }), fields } as Entry;
  return ticketsSection(env, b.attrs.heading, { e, id: target?.id ?? 0, occurrence: target?.occurrence ?? '', own: target?.own ?? true }, note);
}

export const TICKETS_RENDERERS: Record<string, Renderer> = {
  tickets: (b, env) => {
    const { target = null, editable = false } = (env.ctx.data.get(blockKey(b.id)) ?? {}) as Partial<TicketsBlock>;
    if (target && setUp(target)) return ticketsSection(env, b.attrs.heading, target);
    // An event that doesn't sell tickets shows nothing, as does a template's block on such an event's page
    // in the editor; a block being edited shows the form with sample tickets.
    return env.ctx.editor && editable ? sampleTickets(env, b, target) : '';
  },
};
