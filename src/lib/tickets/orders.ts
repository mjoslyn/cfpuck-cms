// Ticket orders (table ticket_orders): a checkout from an event's ticket form, the buyer coming back
// from paying, the providers' webhooks, cancelling and refunding from the attendee list, and the
// emails (confirmation at once, reminder before the event, follow-up after it, sent by the hourly
// src/worker.ts). Everything here runs on the server.
import { randomBytes, randomInt } from 'node:crypto';
import type { Db } from '../db/query';
import { serviceClient } from '../db/site';
import { ENTRY_COLUMNS, type Entry } from '../types';
import { defaultHorizon, expandEntry, localToUtc, recurrenceOf } from '../recurrence';
import { permalink } from '../permalink';
import { eventWhen, venueLines } from '../events/model';
import { eventsOnIn } from '../events/on';
import { isActive, type Viewer } from '../members/config';
import { PUBLIC_SCOPE, visibleTo, type LoaderScope } from '../data';
import { isIP } from '../net';
import { emailEvents } from '../events/email';
import { SITE_TZ, site } from '../site';
import { sendMail } from '../forms/mail';
import { emailToSend, mayBuy, priceFor, localNow, maxFor, offSale, offeredTypes, remaining, ticketEmailFrom, ticketSettings, ticketsOf, timedEmail, DEFAULT_MAX_PER_ORDER, type EmailKind, type EventEmail, type EventTickets, type TicketSettings } from './config';
import { PROVIDERS, ProviderError, closeCheckout, pickProvider, providerOf, type CheckoutState, type PaymentEvent, type PaymentProvider } from '../payments';
import { ticketEmail, type EventView, type OrderView } from './email';
import type { EmailPayment } from '../forms/email';
import { MIN_CHARGE, formatMoney } from '../payments/money';
import { defaultTemplate } from '../email-templates';
import { env } from '../env';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Orders one event takes in a minute (all buyers together), against floods. */
const MAX_PER_MINUTE = 30;
/**
 * One buyer's share of an event (ticket_order_create): orders not paid for in an hour, by address and
 * by email (holds, free orders, expired and cancelled ones), and tickets held unpaid at once by one
 * address, as multiples of the most per order. Holds need no payment, so without these one script could
 * hold every ticket.
 */
const BUYER_ORDERS_PER_HOUR = 5;
const BUYER_HELD_ORDERS = 2;

export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'expired' | 'refunded';

export interface OrderRow {
  id: number;
  token: string;
  code: string;
  entry_id: number | null;
  occurrence: string;
  event_title: string;
  /** The page the order was placed on ('': the event's own). */
  page: string;
  /** The member who placed it (member prices, members-only tickets), if any. */
  member_id: string | null;
  status: OrderStatus;
  /** For the attendee list: a payment that came in after the order was cancelled or expired. */
  note: string;
  provider: 'free' | 'stripe' | 'square';
  provider_ref: string | null;
  provider_order: string | null;
  provider_payment: string | null;
  name: string;
  email: string;
  phone: string;
  address: Address | null;
  answers: Record<string, string>;
  items: { type: string; name: string; price: number; quantity: number }[];
  quantity: number;
  amount: number;
  currency: string;
  refunded_amount: number;
  /** The refund being made while its outcome is unknown: a retry of it reuses its idempotency key. */
  refund_attempt: { key: string; amount: number; from: number; at: string } | null;
  expires_at: string | null;
  paid_at: string | null;
  checked_in_at: string | null;
  emailed_at: string | null;
  reminded_at: string | null;
  followed_up_at: string | null;
  created_at: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  zip: string;
  country?: string;
}

export const addressText = (a: Address | null | undefined) => (a ? [a.line1, a.line2, [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), a.country].filter(Boolean).join(', ') : '');

/** The site's address for links in emails: SITE_URL, else the request's. */
export const siteOrigin = (fallback?: string) => (env('SITE_URL') || fallback || 'http://localhost:4321').replace(/\/$/, '');

// ---- Events ----------------------------------------------------------------------------------

export interface LoadedEvent {
  series: Entry;
  /** The occurrence for a recurring event's date, else the event. */
  entry: Entry;
  tickets: EventTickets;
  tz: string;
  /** Local "Y-m-d H:i:s". */
  start: string;
  end: string;
  allDay: boolean;
  startUtc: number | null;
  endUtc: number | null;
  path: string;
  venue?: Entry;
  /** The event's own emails (table ticket_emails), by kind. */
  emails: Partial<Record<EmailKind, EventEmail>>;
}

/**
 * An event (and date, for a recurring one) as tickets see it. `scope`: only an event its viewer may see
 * (published, and members-only ones for those members, as pages); null for any event (the attendee list,
 * emails).
 */
export async function loadEvent(db: Db, id: number, occurrence: string, scope: LoaderScope | null = PUBLIC_SCOPE): Promise<LoadedEvent | null> {
  if (!id) return null;
  const q = db.from('entries').select(ENTRY_COLUMNS).eq('id', id).eq('type', 'event');
  const { data: series, error } = await (scope ? visibleTo(q, scope) : q).maybeSingle<Entry>();
  if (error) throw error;
  if (!series) return null;
  let entry: Entry = series;
  if (recurrenceOf(series)) {
    // A date of the series; tickets are sold per date.
    const occ = occurrence ? expandEntry(series, defaultHorizon(new Date(Date.now() + 366 * 86400000))).find((o) => o.occurrence === occurrence) : undefined;
    if (!occ) return null;
    entry = occ;
  } else if (occurrence) return null;
  const tz = series.fields?.timezone || SITE_TZ;
  const start = String(entry.fields?.start ?? '');
  const end = String(entry.fields?.end ?? start);
  const allDay = entry.fields?.all_day === true || entry.event_all_day === true;
  const utc = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? Date.parse(localToUtc(s.length === 10 ? `${s} 00:00:00` : s, tz)) : null);
  // An all-day event lasts to the end of its last day.
  const endUtc = allDay && /^\d{4}-\d{2}-\d{2}/.test(end) ? utc(`${end.slice(0, 10)} 23:59:59`) : utc(end);
  let venue: Entry | undefined;
  const venueId = Number(series.fields?.venue) || 0;
  if (venueId) venue = (await db.from('entries').select(ENTRY_COLUMNS).eq('id', venueId).maybeSingle<Entry>()).data ?? undefined;
  const { data: own } = await db.from('ticket_emails').select('kind, subject, design, text, off').eq('entry_id', series.id);
  const emails = Object.fromEntries((own ?? []).map((r) => [r.kind, { ...ticketEmailFrom(r), off: r.off === true }]));
  return { series, entry, tickets: ticketsOf(series.fields), tz, start, end, allDay, startUtc: utc(start), endUtc, path: permalink(entry), venue, emails };
}


/** The event as emails show it. */
export function eventView(ev: LoadedEvent, origin: string): EventView {
  return { title: ev.series.title, ...eventWhen(ev.start, ev.end, ev.allDay), venue: venueLines(ev.venue), link: `${origin}${ev.path}` };
}

/** Tickets taken per type for an event and date. */
export async function soldCounts(db: Db, entryId: number, occurrence: string): Promise<Record<string, number>> {
  const { data, error } = await db.rpc('ticket_sold', { p_entry: entryId, p_occurrence: occurrence });
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as { type: string; quantity: number }[]).map((r) => [r.type, Number(r.quantity)]));
}

// ---- Checkout --------------------------------------------------------------------------------

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
const newToken = () => randomBytes(24).toString('base64url');

async function siteTicketSettings(db: Db): Promise<TicketSettings> {
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  return ticketSettings(data?.value);
}

/** Expired holds: marked expired, and their checkouts closed (Square's payment links don't expire). */
export async function expireStale(db: Db) {
  const { data } = await db.from('ticket_orders').update({ status: 'expired' }).eq('status', 'pending').lt('expires_at', new Date().toISOString()).select('id, provider, provider_ref');
  for (const o of data ?? []) await closeCheckout(o.provider, o.provider_ref);
}

const field = (data: FormData, k: string, max = 300) => String(data.get(k) ?? '').trim().slice(0, max);

/** A buyer's address as orders keep it: IPv4 whole, IPv6 as its /64 (what one connection is given). */
export function buyerAddress(ip: string): string {
  const v4 = ip.trim().replace(/^::ffff:/i, '');
  if (isIP(v4) === 4) return v4;
  if (isIP(ip.trim()) !== 6) return '';
  const [head, tail = ''] = ip.trim().toLowerCase().split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  return `${full.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

/** The page a ticket form was posted from: a path on this site, else '' (the event's own page). */
const postedPage = (data: FormData) => {
  const p = field(data, 'page', 500);
  return /^\/(?![\/\\])[^\s?#\\]*$/.test(p) ? p : '';
};

/**
 * Where an event's tickets show: the page the form was on (a Tickets block can be on any page), else
 * the event's own; and the section's anchor there (#tickets on the event's own page, else
 * #tickets-<event id>, as src/render/c/tickets.ts names it).
 */
export function ticketsAt(ev: Pick<LoadedEvent, 'path' | 'series'>, page = ''): { path: string; anchor: string } {
  const path = page || ev.path;
  return { path, anchor: path === ev.path ? '#tickets' : `#tickets-${ev.series.id}` };
}
const backTo = (ev: LoadedEvent, page: string) => {
  const at = ticketsAt(ev, page);
  return (reason: string) => `${at.path}?tickets=${reason}&event=${ev.series.id}${at.anchor}`;
};

/**
 * A ticket form posted (/api/tickets/checkout): where to send the buyer next. A free order is
 * confirmed at once; a paid one holds its tickets and goes to the provider's checkout. Problems go
 * back to the event with ?tickets=<reason>. Null when there is no such event, or not one the buyer may
 * see. `viewer`: the signed-in buyer (no membership while Members is off); `ip`: their address.
 */
export async function startCheckout(data: FormData, origin: string, viewer: Viewer | null = null, ip = ''): Promise<string | null> {
  const db = serviceClient();
  const member = viewer?.member ?? null;
  const ev = await loadEvent(db, Number(data.get('event')), field(data, 'occurrence', 10), { published: true, viewer });
  if (!ev) return null;
  const page = postedPage(data);
  const back = backTo(ev, page);
  const t = ev.tickets;
  if (field(data, '_hp')) return back('invalid');
  if (!t.enabled || (ev.endUtc != null && ev.endUtc < Date.now())) return back('closed');

  const now = localNow(ev.tz);
  const items: OrderRow['items'] = [];
  for (const type of offeredTypes(t)) {
    const q = Math.floor(Number(data.get(`q[${type.id}]`)) || 0);
    if (q <= 0) continue;
    if (offSale(type, now)) return back('closed');
    if (q > maxFor(type, t)) return back('invalid');
    if (!mayBuy(type, member)) return back('members-only');
    // A member pays their level's price (checked here: the form's prices are only shown).
    items.push({ type: type.id, name: type.name, price: priceFor(type, member), quantity: q });
  }
  const quantity = items.reduce((n, i) => n + i.quantity, 0);
  const amount = items.reduce((n, i) => n + i.price * i.quantity, 0);
  if (!quantity || quantity > (t.maxPerOrder || DEFAULT_MAX_PER_ORDER)) return back('invalid');
  // The providers take nothing smaller (forms refuse it too); a total of 0 is free.
  if (amount > 0 && amount < MIN_CHARGE) return back('below-minimum');

  const name = field(data, 'name', 200);
  const email = field(data, 'email', 254);
  const phone = t.phone === 'off' ? '' : field(data, 'phone', 40);
  if (!name || !EMAIL.test(email) || (t.phone === 'required' && phone.replace(/\D/g, '').length < 7)) return back('invalid');
  let address: Address | null = null;
  if (t.address === 'always' || (t.address === 'paid' && amount > 0)) {
    address = { line1: field(data, 'address[line1]'), line2: field(data, 'address[line2]') || undefined, city: field(data, 'address[city]', 100), state: field(data, 'address[state]', 100) || undefined, zip: field(data, 'address[zip]', 20), country: field(data, 'address[country]', 100) || undefined };
    if (!address.line1 || !address.city || !address.zip) return back('invalid');
  }
  const answers: Record<string, string> = {};
  for (const q of t.questions ?? []) {
    let v = field(data, `a[${q.id}]`, 5000);
    if (q.type === 'checkbox') v = v ? 'Yes' : '';
    if (q.type === 'select' && v && !(q.choices ?? []).includes(v)) return back('invalid');
    if (q.type === 'number' && v && Number.isNaN(Number(v))) return back('invalid');
    if (q.required && !v) return back('invalid');
    if (v) answers[q.id] = v;
  }

  const settings = await siteTicketSettings(db);
  const providerName = amount > 0 ? pickProvider(settings.provider) : undefined;
  if (amount > 0 && !providerName) return back('payments-off');
  const { count } = await db.from('ticket_orders').select('id', { count: 'exact', head: true }).eq('entry_id', ev.series.id).gte('created_at', new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) >= MAX_PER_MINUTE) return back('busy');
  await expireStale(db).catch((e) => console.warn(`tickets: expiring holds: ${e.message}`));

  const free = amount === 0;
  const token = newToken();
  const code = newCode();
  const hold = (settings.hold ?? 30) * 60_000;
  const currency = settings.currency ?? 'usd';
  const limits = {
    // Empty: no limit; 0: none left.
    total: t.capacity ?? null,
    types: Object.fromEntries(t.types.map((x) => [x.id, x.capacity ?? null])),
    client: { orders: BUYER_ORDERS_PER_HOUR, tickets: BUYER_HELD_ORDERS * (t.maxPerOrder || DEFAULT_MAX_PER_ORDER) },
  };
  const { data: made, error } = await db.rpc('ticket_order_create', {
    p_order: {
      token, code, entry_id: ev.series.id, occurrence: (ev.entry as { occurrence?: string }).occurrence ?? '', event_title: ev.series.title, page, member_id: isActive(member) ? member.user_id : null, ip: buyerAddress(ip),
      status: free ? 'paid' : 'pending', provider: free ? 'free' : providerName, name, email, phone, address, answers, items, amount, currency,
      // A paid order holds its tickets a little longer than the checkout takes payment.
      expires_at: free ? null : new Date(Date.now() + hold + 2 * 60_000).toISOString(),
      paid_at: free ? new Date().toISOString() : null,
    },
    p_limits: limits,
  });
  if (error) throw error;
  if (made?.client) return back('limit');
  if (!made?.ok) return back('sold-out');
  const at = ticketsAt(ev, page);
  const orderLink = `${at.path}?order=${token}${at.anchor}`;
  const { data: order } = await db.from('ticket_orders').select('*').eq('id', made.id).single<OrderRow>();
  if (free) {
    await sendConfirmation(db, order!, siteOrigin(origin), ev, settings);
    return orderLink;
  }
  try {
    const label = (n: string) => `${ev.series.title}${(ev.entry as { occurrence?: string }).occurrence ? ` (${eventView(ev, origin).date})` : ''}: ${n}`;
    const returnUrl = `${origin}/api/tickets/return?order=${token}`;
    const checkout = await PROVIDERS[providerName!].create({
      reference: code,
      idempotencyKey: `checkout-${token}`,
      email,
      currency,
      items: items.filter((i) => i.price > 0).map((i) => ({ name: label(i.name), unit: i.price, quantity: i.quantity })),
      returnUrl,
      cancelUrl: `${returnUrl}&cancel=1`,
      expiresAt: new Date(Date.now() + hold),
    });
    await db.from('ticket_orders').update({ provider_ref: checkout.ref, provider_order: checkout.order ?? null }).eq('id', made.id);
    return checkout.url;
  } catch (e) {
    console.error(`tickets: checkout for order ${code} failed: ${(e as Error).message}`);
    await db.from('ticket_orders').update({ status: 'cancelled' }).eq('id', made.id);
    return back('payment-error');
  }
}

/** The buyer back from the provider (/api/tickets/return): the order checked, and where to show it. */
export async function returnFromCheckout(token: string, cancelled: boolean): Promise<string | null> {
  const db = serviceClient();
  const { data: order } = await db.from('ticket_orders').select('*').eq('token', token).maybeSingle<OrderRow>();
  if (!order) return null;
  const ev = order.entry_id ? await loadEvent(db, order.entry_id, order.occurrence, null) : null;
  const { path, anchor } = ev ? ticketsAt(ev, order.page) : { path: '/', anchor: '' };
  if (cancelled && order.status === 'pending') {
    // Paid after all (the buyer pressed back after paying): keep it. Cancelled only when the provider
    // says it isn't paid; a check that fails (or a payment on its way) leaves the order as it is.
    const state = await paymentState(order).catch((e): null => (console.warn(`tickets: checking order ${order.code}: ${(e as Error).message}`), null));
    if (state?.status === 'paid') await markPaid(db, order, state.paymentId);
    else if (state && state.status !== 'processing') {
      await closeCheckout(order.provider, order.provider_ref);
      await db.from('ticket_orders').update({ status: 'cancelled' }).eq('id', order.id).eq('status', 'pending');
      return `${path}?tickets=cancelled&event=${order.entry_id}${anchor}`;
    }
  } else if (UNPAID.includes(order.status)) {
    try {
      const state = await paymentState(order);
      if (state.status === 'paid') await markPaid(db, order, state.paymentId);
    } catch (e) {
      // The webhook will confirm it; the order page says it's being confirmed meanwhile.
      console.warn(`tickets: checking order ${order.code}: ${(e as Error).message}`);
    }
  }
  return `${path}?order=${token}${anchor}`;
}

/** Where an order's payment stands at its provider. */
async function paymentState(o: OrderRow): Promise<CheckoutState> {
  const p = providerOf(o.provider);
  return p && o.provider_ref ? p.check({ ref: o.provider_ref, order: o.provider_order }) : { status: 'pending' };
}

/** Orders not paid for (yet) whose checkout can still turn out paid. */
const UNPAID: OrderStatus[] = ['pending', 'expired', 'cancelled'];

/**
 * Mark an order paid (once: a webhook and the buyer's return can both get here) and send its
 * confirmation. Only once its provider says it is paid. An order cancelled or expired before the payment
 * came in is marked paid too, since the money was taken, with a note for the attendee list: its tickets
 * went back on sale meanwhile (an admin can refund it).
 */
export async function markPaid(db: Db, order: Pick<OrderRow, 'id'>, payment?: string) {
  const at = new Date().toISOString();
  for (const was of UNPAID) {
    const note = was === 'pending' ? {} : { note: `Paid after the order was ${was}: its tickets had gone back on sale, so the event may be over capacity. Refund it if they can't be honoured.` };
    const { data } = await db
      .from('ticket_orders')
      .update({ status: 'paid', paid_at: at, ...(payment ? { provider_payment: payment } : {}), ...note })
      .eq('id', order.id)
      .eq('status', was)
      .select('*')
      .maybeSingle<OrderRow>();
    if (data) {
      if (was !== 'pending') console.warn(`tickets: order ${data.code} paid after it was ${was}`);
      await sendConfirmation(db, data, siteOrigin());
      return;
    }
  }
}

/**
 * Refunds the provider reports (made here or in its dashboard): `refunded` is the payment's total as the
 * provider has it now, so a refund that failed comes off again (and a fully refunded order whose refund
 * failed is paid again). A full refund frees the tickets, so the waitlist is told, as after a refund
 * from the attendee list.
 */
export async function recordRefund(db: Db, order: OrderRow, refunded: number, origin?: string) {
  const status = refunded >= order.amount ? (order.status === 'paid' ? 'refunded' : order.status) : order.status === 'refunded' ? 'paid' : order.status;
  if (refunded === order.refunded_amount && status === order.status) return;
  if (status !== order.status) console.warn(`tickets: order ${order.code} ${order.status} -> ${status}: ${refunded} of ${order.amount} refunded at the provider`);
  const { data } = await db.from('ticket_orders').update({ refunded_amount: refunded, status }).eq('id', order.id).eq('status', order.status).select('id');
  if (data?.length && order.status === 'paid' && status === 'refunded') await waitlistAfterRelease(db, order.entry_id, order.occurrence, origin);
}

// ---- Webhooks --------------------------------------------------------------------------------

const orderBy = async (db: Db, column: string, value: unknown) => (value ? (await db.from('ticket_orders').select('*').eq(column, String(value)).maybeSingle<OrderRow>()).data : null);

/**
 * A provider's webhook (/api/payments/<provider>, signature checked there): the order's payment asked of
 * the provider, or its refunds recorded. Orders not found are another feature's.
 */
export async function ticketsWebhook(provider: PaymentProvider, event: PaymentEvent, origin?: string) {
  const db = serviceClient();
  if (event.kind === 'refund') {
    const order = await orderBy(db, 'provider_payment', event.payment);
    if (order?.provider === provider) await recordRefund(db, order, event.refunded, origin);
    return;
  }
  const order = event.ref ? await orderBy(db, 'provider_ref', event.ref) : await orderBy(db, 'provider_order', event.order);
  // A cancelled or expired order is looked at too: a payment that completed anyway is recorded.
  if (!order || order.provider !== provider || !UNPAID.includes(order.status)) return;
  if (event.failed || event.expired) {
    await db.from('ticket_orders').update({ status: 'expired' }).eq('id', order.id).eq('status', 'pending');
    return;
  }
  const state = await paymentState(order);
  if (state.status === 'paid') await markPaid(db, order, state.paymentId);
}

// ---- The attendee list -----------------------------------------------------------------------

/**
 * Cancel an order: an unpaid one's checkout closes; its tickets go back on sale. Paid orders are refunded
 * instead. An unpaid one is asked of its provider first: paid there after all (its webhook not in yet),
 * it is marked paid and not cancelled (`paid`); a check that fails cancels nothing.
 */
export async function cancelOrder(db: Db, id: number): Promise<{ paid?: boolean }> {
  const { data: order } = await db.from('ticket_orders').select('*').eq('id', id).maybeSingle<OrderRow>();
  if (!order) throw new Error('No such order.');
  if (order.status === 'paid' && order.amount > order.refunded_amount) throw new Error('Refund a paid order to cancel it.');
  if (!['pending', 'paid', 'expired'].includes(order.status)) throw new Error('This order is already closed.');
  const provider = providerOf(order.provider);
  if (order.status !== 'paid' && provider && order.provider_ref) {
    const state = await paymentState(order).catch((e) => {
      throw new Error(`Could not check the payment at ${provider.label} (${(e as Error).message}), so the order was not cancelled. Try again in a moment.`);
    });
    if (state.status === 'paid') {
      await markPaid(db, order, state.paymentId);
      return { paid: true };
    }
    if (state.status === 'processing') throw new Error(`Its payment is on its way at ${provider.label} (a bank payment can take days), so the order was not cancelled.`);
    if (order.status === 'pending') await closeCheckout(order.provider, order.provider_ref);
  }
  // As it was when read: an order paid meanwhile isn't cancelled.
  const { error } = await db.from('ticket_orders').update({ status: 'cancelled' }).eq('id', id).eq('status', order.status);
  if (error) throw error;
  return {};
}

/** Refund `amount` of a paid order at its provider. All of it: the order is refunded and its tickets go back on sale. */
export async function refundOrder(db: Db, id: number, amount: number) {
  const { data: order } = await db.from('ticket_orders').select('*').eq('id', id).maybeSingle<OrderRow>();
  if (!order) throw new Error('No such order.');
  if (order.status !== 'paid') throw new Error('Only paid orders can be refunded.');
  const left = order.amount - (order.refunded_amount ?? 0);
  if (amount <= 0 || amount > left) throw new ProviderError('Refund between 0.01 and what is left of the order.');
  const provider = providerOf(order.provider);
  if (!provider) throw new ProviderError('Free orders have nothing to refund.');
  if (!order.provider_payment) throw new ProviderError('This order has no payment recorded at the provider; refund it from its dashboard.');
  // Each refund has its own idempotency key, kept with the order while its outcome is unknown: retrying
  // a refund whose request got no answer reuses it (so it is made once), and any other refund gets a new
  // one, so the provider never replays an earlier refund's answer (one that failed, say) for it.
  const last = order.refund_attempt;
  const key = last && last.amount === amount && last.from === order.refunded_amount ? last.key : `${order.id}-${randomBytes(9).toString('base64url')}`;
  await db.from('ticket_orders').update({ refund_attempt: { key, amount, from: order.refunded_amount, at: new Date().toISOString() } }).eq('id', id);
  const made = await provider.refund(order.provider_payment, amount, order.currency, key);
  await db.from('ticket_orders').update({ refund_attempt: null }).eq('id', id);
  if (made.status === 'failed') throw new ProviderError(`${provider.label} did not make the refund${made.reason ? ` (${made.reason})` : ''}. Nothing was recorded.`);
  // The provider's webhook may have recorded this refund already: the total is what it was plus this one.
  const { data: now } = await db.from('ticket_orders').select('refunded_amount').eq('id', id).single();
  const total = Math.max(now?.refunded_amount ?? 0, order.refunded_amount + amount);
  await db.from('ticket_orders').update({ refunded_amount: total, ...(total >= order.amount ? { status: 'refunded' } : {}) }).eq('id', id).in('status', ['paid', 'refunded']);
  return { refunded: total, full: total >= order.amount };
}

// ---- Waitlist --------------------------------------------------------------------------------

export interface WaitlistRow {
  id: number;
  entry_id: number;
  occurrence: string;
  name: string;
  email: string;
  phone: string;
  quantity: number;
  /** The page they joined on ('': the event's own). */
  page: string;
  status: 'waiting' | 'notified' | 'bought' | 'removed';
  notified_at: string | null;
  created_at: string;
}

/** How long a notified person's tickets count as spoken for before the next people are told. */
const WAITLIST_CLAIM = 24 * 3600_000;

/** A waitlist form posted (/api/tickets/waitlist): where to send the visitor next. Null: no such event (or not one `viewer` may see). */
export async function joinWaitlist(data: FormData, viewer: Viewer | null = null): Promise<string | null> {
  const db = serviceClient();
  const ev = await loadEvent(db, Number(data.get('event')), field(data, 'occurrence', 10), { published: true, viewer });
  if (!ev) return null;
  const page = postedPage(data);
  const back = backTo(ev, page);
  const t = ev.tickets;
  if (field(data, '_hp')) return back('invalid');
  if (!t.enabled || t.waitlist === 'off' || (ev.endUtc != null && ev.endUtc < Date.now())) return back('closed');
  const name = field(data, 'name', 200);
  const email = field(data, 'email', 254);
  const phone = t.phone === 'off' ? '' : field(data, 'phone', 40);
  const quantity = Math.floor(Number(data.get('quantity')) || 1);
  if (!name || !EMAIL.test(email) || quantity < 1 || quantity > (t.maxPerOrder || DEFAULT_MAX_PER_ORDER)) return back('invalid');
  const occurrence = (ev.entry as { occurrence?: string }).occurrence ?? '';
  const { count } = await db.from('ticket_waitlist').select('id', { count: 'exact', head: true }).eq('entry_id', ev.series.id).gte('created_at', new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) >= MAX_PER_MINUTE) return back('busy');
  // Anyone can post any address, so joining again changes little: a place keeps its name, phone, status
  // and turn, and only one still waiting takes the new number of tickets and page. A place removed or
  // bought stays so. The answer is the same either way, so it tells nothing about who is on the list.
  const row = { entry_id: ev.series.id, occurrence, email: email.toLowerCase() };
  const { data: added, error } = await db.from('ticket_waitlist').upsert({ ...row, name, phone, quantity, page, status: 'waiting' }, { onConflict: 'entry_id,occurrence,email', ignoreDuplicates: true }).select('id');
  if (error) throw error;
  if (!added?.length) {
    const { error: again } = await db.from('ticket_waitlist').update({ quantity, page }).eq('entry_id', row.entry_id).eq('occurrence', occurrence).eq('email', row.email).eq('status', 'waiting');
    if (again) throw again;
  }
  return back('waitlisted');
}

/** Tickets on sale now (null: no limit). */
async function availableNow(db: Db, ev: LoadedEvent): Promise<number | null> {
  const occurrence = (ev.entry as { occurrence?: string }).occurrence ?? '';
  const left = remaining(ev.tickets, await soldCounts(db, ev.series.id, occurrence));
  const now = localNow(ev.tz);
  const open = offeredTypes(ev.tickets).filter((t) => !offSale(t, now));
  if (!open.length) return 0;
  const perType = open.map((t) => left.types[t.id]);
  const sum = perType.some((n) => n == null) ? null : perType.reduce((a, b) => a! + b!, 0);
  return left.total == null ? sum : sum == null ? left.total : Math.min(sum, left.total);
}

/**
 * Tell people on the waitlist that tickets are available. `ids`: those people (the attendee list's
 * Notify); otherwise as many waiting people, in the order they joined, as the free tickets cover,
 * counting those told in the last day as still deciding. Returns how many were emailed.
 */
export async function notifyWaitlist(db: Db, ev: LoadedEvent, origin: string, ids?: number[]): Promise<number> {
  const occurrence = (ev.entry as { occurrence?: string }).occurrence ?? '';
  let q = db.from('ticket_waitlist').select('*').eq('entry_id', ev.series.id).eq('occurrence', occurrence).order('id');
  q = ids ? q.in('id', ids).in('status', ['waiting', 'notified']) : q.eq('status', 'waiting');
  const { data: people, error } = await q.limit(500);
  if (error) throw error;
  let budget = Infinity;
  if (!ids) {
    const free = await availableNow(db, ev);
    const { data: told } = await db.from('ticket_waitlist').select('quantity').eq('entry_id', ev.series.id).eq('occurrence', occurrence).eq('status', 'notified').gte('notified_at', new Date(Date.now() - WAITLIST_CLAIM).toISOString());
    budget = free == null ? Infinity : free - (told ?? []).reduce((n, r) => n + r.quantity, 0);
  }
  const settings = await siteTicketSettings(db);
  const email = emailToSend('waitlist', settings, ev.emails.waitlist, await defaultTemplate(db, 'ticket:waitlist'));
  const view = eventView(ev, origin);
  const events = await emailEvents(db, email.design, origin);
  let sent = 0;
  for (const p of (people ?? []) as WaitlistRow[]) {
    if (p.quantity > budget) continue;
    const mail = ticketEmail(email, { code: '', name: p.name, email: p.email, phone: p.phone, items: [], amount: 0, currency: settings.currency ?? 'usd' }, view, { order: waitlistLink(ev, p.page, origin) }, origin, events);
    if (!(await sendMail({ to: [p.email], ...mail }))) throw new Error('No mail server is set up (SMTP_* in the environment).');
    await db.from('ticket_waitlist').update({ status: 'notified', notified_at: new Date().toISOString() }).eq('id', p.id);
    budget -= p.quantity;
    sent++;
  }
  return sent;
}

/** Where a waitlist email sends people: the tickets where they joined. */
function waitlistLink(ev: LoadedEvent, page: string, origin: string) {
  const at = ticketsAt(ev, page);
  return `${origin}${at.path}${at.anchor}`;
}

/** After tickets free up (a cancellation or refund): the waitlist told, when the event does that itself. */
export async function waitlistAfterRelease(db: Db, entryId: number | null, occurrence: string, origin?: string) {
  if (!entryId) return;
  const ev = await loadEvent(db, entryId, occurrence, null);
  if (ev?.tickets.waitlist === 'auto' && (ev.endUtc == null || ev.endUtc > Date.now())) {
    await notifyWaitlist(db, ev, siteOrigin(origin)).catch((e) => console.error(`tickets: waitlist for ${ev.series.title}: ${e.message}`));
  }
}

// ---- Emails ----------------------------------------------------------------------------------

const ORDER_STATUS: Partial<Record<OrderStatus, string>> = { paid: 'Paid', refunded: 'Refunded' };

/** A paid order's payment as the Payment block shows it; free and unpaid orders have none. */
function orderPayment(o: OrderRow): EmailPayment | null {
  const provider = providerOf(o.provider);
  if (!provider || !ORDER_STATUS[o.status]) return null;
  const status = o.refunded_amount && o.status === 'paid' ? `Paid, ${formatMoney(o.refunded_amount, o.currency)} refunded` : ORDER_STATUS[o.status]!;
  return {
    items: o.items.filter((i) => i.price > 0).map((i) => ({ name: i.name, unit: i.price, quantity: i.quantity })),
    amount: o.amount,
    currency: o.currency,
    status,
    method: provider.label,
    id: o.provider_payment ?? undefined,
    date: o.paid_at ? new Intl.DateTimeFormat('en-US', { timeZone: SITE_TZ, dateStyle: 'long' }).format(new Date(o.paid_at)) : undefined,
  };
}

function orderView(o: OrderRow, t: EventTickets): OrderView {
  const labels = new Map((t.questions ?? []).map((q) => [q.id, q.label]));
  return { code: o.code, name: o.name, email: o.email, phone: o.phone, address: addressText(o.address) || undefined, items: o.items, amount: o.amount, currency: o.currency, answers: Object.entries(o.answers ?? {}).map(([k, v]) => [labels.get(k) ?? k, v]), payment: orderPayment(o) };
}

const notifyAddress = () => env('TICKETS_NOTIFY_EMAIL') || env('FORMS_ADMIN_EMAIL') || site.adminEmail;

/** An order's email of a kind: to the buyer, or (admin) to the site's admin address, replying to the buyer. */
async function sendOrderEmail(kind: EmailKind, o: OrderRow, ev: LoadedEvent, settings: TicketSettings, origin: string) {
  const at = ticketsAt(ev, o.page);
  const links = { order: `${origin}${at.path}?order=${o.token}${at.anchor}`, attendees: `${origin}/admin/tickets/${ev.series.id}/${o.occurrence ? `?date=${o.occurrence}` : ''}` };
  const email = emailToSend(kind, settings, ev.emails[kind], await defaultTemplate(serviceClient(), `ticket:${kind}`));
  const mail = ticketEmail(email, orderView(o, ev.tickets), eventView(ev, origin), links, origin, await emailEvents(serviceClient(), email.design, origin));
  return kind === 'admin' ? sendMail({ to: [notifyAddress()], replyTo: o.email, ...mail }) : sendMail({ to: [o.email], ...mail });
}

/** The confirmation to the buyer, and a copy for the site's admin (unless turned off). */
export async function sendConfirmation(db: Db, o: OrderRow, origin: string, ev?: LoadedEvent | null, settings?: TicketSettings) {
  ev ??= o.entry_id ? await loadEvent(db, o.entry_id, o.occurrence, null) : null;
  if (!ev) return;
  settings ??= await siteTicketSettings(db);
  // Someone on the waitlist who bought is off it.
  await db.from('ticket_waitlist').update({ status: 'bought' }).eq('entry_id', ev.series.id).eq('occurrence', o.occurrence).ilike('email', o.email.replace(/[%_\\]/g, '\\$&')).in('status', ['waiting', 'notified']);
  try {
    if (await sendOrderEmail('confirmation', o, ev, settings, origin)) await db.from('ticket_orders').update({ emailed_at: new Date().toISOString() }).eq('id', o.id);
    if (settings.notify) await sendOrderEmail('admin', o, ev, settings, origin);
  } catch (e) {
    // The order stands either way; the attendee list can send the confirmation again.
    console.error(`tickets: confirmation for ${o.code} failed: ${(e as Error).message}`);
  }
}

/** Resend an order's confirmation (the attendee list). */
export async function resendConfirmation(db: Db, id: number, origin: string) {
  const { data: o } = await db.from('ticket_orders').select('*').eq('id', id).maybeSingle<OrderRow>();
  if (!o || o.status !== 'paid') throw new Error('Only paid orders have a confirmation.');
  const ev = o.entry_id ? await loadEvent(db, o.entry_id, o.occurrence, null) : null;
  if (!ev) throw new Error('The event is gone.');
  if (!(await sendOrderEmail('confirmation', o, ev, await siteTicketSettings(db), siteOrigin(origin)))) throw new Error('No mail server is set up (SMTP_* in the environment).');
  await db.from('ticket_orders').update({ emailed_at: new Date().toISOString() }).eq('id', id);
}

/**
 * Reminders and follow-ups that are due (hourly, src/worker.ts). A reminder goes
 * out in the hours before the event (not to orders made inside that window: their confirmation is
 * recent); a follow-up the hours after it ends, for up to three days. Orders past either are marked
 * done, so turning an email on later doesn't send it for events long gone.
 */
export async function sendDueTicketEmails(origin = siteOrigin()): Promise<string> {
  const db = serviceClient();
  await expireStale(db).catch(() => {});
  // Events off (Settings > Events): their pages are gone, so no reminders, follow-ups or waitlist notices.
  if (!(await eventsOnIn(db))) return 'events are off';
  const settings = await siteTicketSettings(db);
  const { data: orders, error } = await db
    .from('ticket_orders')
    .select('*')
    .eq('status', 'paid')
    .or('reminded_at.is.null,followed_up_at.is.null')
    .gte('created_at', new Date(Date.now() - 400 * 86400000).toISOString())
    .order('id')
    .limit(2000);
  if (error) throw error;
  const events = new Map<string, LoadedEvent | null>();
  const now = Date.now();
  let reminders = 0;
  let followUps = 0;
  for (const o of (orders ?? []) as OrderRow[]) {
    const key = `${o.entry_id}:${o.occurrence}`;
    if (!events.has(key)) events.set(key, o.entry_id ? await loadEvent(db, o.entry_id, o.occurrence, null).catch(() => null) : null);
    const ev = events.get(key);
    const patch: Partial<OrderRow> = {};
    if (!ev || ev.startUtc == null) {
      // No event (or no date) to remind about.
      if (!ev) Object.assign(patch, { reminded_at: new Date().toISOString(), followed_up_at: new Date().toISOString() });
    } else {
      const before = timedEmail('reminder', settings, ev.emails.reminder);
      if (!o.reminded_at) {
        const from = before != null ? ev.startUtc - before * 3600_000 : Infinity;
        if (now >= ev.startUtc) patch.reminded_at = new Date().toISOString();
        else if (now >= from) {
          if (Date.parse(o.paid_at ?? o.created_at) < from && (await sendOrderEmail('reminder', o, ev, settings, origin).catch((e) => (console.error(`tickets: reminder ${o.code}: ${e.message}`), false)))) reminders++;
          patch.reminded_at = new Date().toISOString();
        }
      }
      const after = timedEmail('followUp', settings, ev.emails.followUp);
      const end = ev.endUtc ?? ev.startUtc;
      if (!o.followed_up_at && now >= end) {
        const at = end + (after ?? 0) * 3600_000;
        if (after == null || now >= at + 3 * 86400000) patch.followed_up_at = new Date().toISOString();
        else if (now >= at) {
          if (await sendOrderEmail('followUp', o, ev, settings, origin).catch((e) => (console.error(`tickets: follow-up ${o.code}: ${e.message}`), false))) followUps++;
          patch.followed_up_at = new Date().toISOString();
        }
      }
    }
    if (Object.keys(patch).length) await db.from('ticket_orders').update(patch).eq('id', o.id);
  }
  // Waitlists of events that tell them on their own, for tickets freed by expired holds.
  const { data: waiting } = await db.from('ticket_waitlist').select('entry_id, occurrence').eq('status', 'waiting').limit(2000);
  let told = 0;
  for (const key of new Set((waiting ?? []).map((w) => `${w.entry_id}|${w.occurrence}`))) {
    const [id, occurrence] = key.split('|');
    const ev = await loadEvent(db, Number(id), occurrence, null).catch(() => null);
    if (ev?.tickets.waitlist === 'auto' && ev.tickets.enabled && (ev.endUtc == null || ev.endUtc > now)) told += await notifyWaitlist(db, ev, origin).catch((e) => (console.error(`tickets: waitlist ${key}: ${e.message}`), 0));
  }
  return `${reminders} reminder${reminders === 1 ? '' : 's'}, ${followUps} follow-up${followUps === 1 ? '' : 's'}, ${told} told from waitlists`;
}
