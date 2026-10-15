// Tickets on an event page: the event's ticket types with quantities, the buyer's details and the
// event's own questions, posting to /api/tickets/checkout; a waitlist form when it's sold out; the
// buyer's order when they come back (?order=<token>); and the outcome of a checkout (?tickets=<reason>).
// The Event details block shows it below the event's content, unless the page has a Tickets block of
// its own. public/assets/js/tickets.js adds the running total and live availability; without it the
// form still works and the server checks everything.
import type { Env, Renderer, RenderCtx } from '../env';
import type { Entry } from '../../lib/types';
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

/** The event shown and its ticket data's key ("tickets:<series id>:<date>"). */
function eventOf(env: Env): { e: Entry; id: number; occurrence: string } | null {
  const e = env.ctx.queried.entry;
  if (!e || e.type !== 'event') return null;
  return { e, id: e.series_id ?? e.id, occurrence: e.occurrence ?? '' };
}
const dataKey = (id: number, occurrence: string) => `tickets:${id}:${occurrence}`;

/** Loads what's taken and the buyer's order (prepare.ts, for the Tickets and Event details blocks). */
export async function prepareTickets(ctx: RenderCtx) {
  const e = ctx.queried.entry;
  if (!e || e.type !== 'event' || !ticketsOf(e.fields).enabled) return;
  const id = e.series_id ?? e.id;
  const occurrence = e.occurrence ?? '';
  const key = dataKey(id, occurrence);
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

function waitlistForm(t: EventTickets, id: number, occurrence: string, uid: string): string {
  const max = t.maxPerOrder || DEFAULT_MAX_PER_ORDER;
  return (
    `<div class="c-form c-tickets__waitlist"><p class="c-tickets__note">Join the waitlist and we'll email you if tickets become available.</p>` +
    `<form class="c-form__form" method="post" action="/api/tickets/waitlist">` +
    `<input type="hidden" name="event" value="${id}" /><input type="hidden" name="occurrence" value="${esc(occurrence)}" />` +
    `<div class="c-form__fields">${contactFields(t, `${uid}-w`)}` +
    `<div class="c-field span-6"><label class="c-field__label" for="${uid}-w-quantity">Tickets wanted</label><select class="c-input" id="${uid}-w-quantity" name="quantity">${Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select></div>` +
    `${HONEYPOT(`${uid}-w`)}</div>` +
    `<div class="c-form__footer"><button type="submit" class="c-button__link c-form__submit">Join the waitlist</button></div></form></div>`
  );
}

/** The tickets section for the event being shown ('' when it doesn't sell tickets). */
export function ticketsSection(env: Env, heading?: string): string {
  const ev = eventOf(env);
  if (!ev) return '';
  const { e, id, occurrence } = ev;
  const t = ticketsOf(e.fields);
  if (!t.enabled) return '';
  const data = (env.ctx.data.get(dataKey(id, occurrence)) as TicketsData | undefined) ?? { sold: {} };
  const currency = ticketSettings(env.ctx.settings.site).currency ?? 'usd';
  const uid = `tickets-${id}${occurrence ? `-${occurrence}` : ''}`;
  const reason = env.ctx.queried.url.searchParams.get('tickets') ?? '';
  const message = CHECKOUT_MESSAGES[reason] ? `<p class="c-tickets__message${reason === 'waitlisted' || reason === 'cancelled' ? '' : ' is-error'}" role="${reason === 'waitlisted' ? 'status' : 'alert'}" tabindex="-1" data-focus>${esc(CHECKOUT_MESSAGES[reason])}</p>` : '';
  const order = data.order ? orderView(data.order) : '';
  const head = `<section class="c-tickets" id="tickets" aria-labelledby="${uid}-title"><h2 class="c-tickets__heading" id="${uid}-title">${esc(heading || t.heading || 'Tickets')}</h2>${message}${order}`;
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
  if (soldOut) return close(`<p class="c-tickets__note is-sold-out">Sold out.</p>${t.waitlist !== 'off' ? waitlistForm(t, id, occurrence, uid) : ''}`);

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
      `<input type="hidden" name="event" value="${id}" /><input type="hidden" name="occurrence" value="${esc(occurrence)}" />` +
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
  const ev = eventOf(env);
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

export const TICKETS_RENDERERS: Record<string, Renderer> = {
  tickets: (b, env) => ticketsSection(env, b.attrs.heading),
};
