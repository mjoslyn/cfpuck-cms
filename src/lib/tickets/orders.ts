// Ticket orders (table ticket_orders): a checkout from an event's ticket form, the buyer coming back
// from paying, the providers' webhooks, cancelling and refunding from the attendee list, and the
// emails (confirmation at once, reminder before the event, follow-up after it, sent by the hourly
// netlify/functions/ticket-emails.mts). Everything here runs on the server with the service key.
import { randomBytes, randomInt } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../supabase';
import { ENTRY_COLUMNS, type Entry } from '../types';
import { defaultHorizon, expandEntry, localToUtc, recurrenceOf } from '../recurrence';
import { permalink } from '../permalink';
import { SITE_TZ, site } from '../site';
import { sendMail } from '../forms/mail';
import { emailToSend, localNow, maxFor, offSale, offeredTypes, remaining, ticketEmailFrom, ticketSettings, ticketsOf, timedEmail, DEFAULT_MAX_PER_ORDER, type EmailKind, type EventEmail, type EventTickets, type TicketSettings } from './config';
import { cancelCheckout, createCheckout, paymentState, providerReady, refundPayment, squarePayment } from './providers';
import { ticketEmail, type EventView, type OrderView } from './email';

const env = (k: string) => (import.meta.env?.[k] as string | undefined) ?? process.env[k];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Orders one event takes in a minute (all buyers together), against floods. */
const MAX_PER_MINUTE = 30;

export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'expired' | 'refunded';

export interface OrderRow {
  id: number;
  token: string;
  code: string;
  entry_id: number | null;
  occurrence: string;
  event_title: string;
  status: OrderStatus;
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

/** The site's address for links in emails: SITE_URL, else Netlify's URL, else the request's. */
export const siteOrigin = (fallback?: string) => (env('SITE_URL') || env('URL') || fallback || 'http://localhost:4321').replace(/\/$/, '');

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

/** An event (and date, for a recurring one) as tickets see it. `published`: only a published event. */
export async function loadEvent(db: SupabaseClient, id: number, occurrence: string, published = true): Promise<LoadedEvent | null> {
  if (!id) return null;
  let q = db.from('entries').select(ENTRY_COLUMNS).eq('id', id).eq('type', 'event');
  if (published) q = q.eq('status', 'publish');
  const { data: series, error } = await q.maybeSingle<Entry>();
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


const dayText = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
const timeText = (s: string) => {
  const [h, m] = s.slice(11, 16).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

/** The event as emails show it. */
export function eventView(ev: LoadedEvent, origin: string): EventView {
  const long = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } as const;
  const valid = /^\d{4}-\d{2}-\d{2}/.test(ev.start);
  const sameDay = ev.start.slice(0, 10) === ev.end.slice(0, 10);
  const date = !valid ? 'Date to be announced' : sameDay ? dayText(ev.start, long) : `${dayText(ev.start, { month: 'long', day: 'numeric' })} – ${dayText(ev.end, long)}`;
  const time = valid && !ev.allDay ? ` at ${timeText(ev.start)}` : '';
  const f = ev.venue?.fields ?? {};
  const venue = ev.venue ? [ev.venue.title, f.address, [f.city, [f.state, f.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean) : [];
  return { title: ev.series.title, date, time, venue, link: `${origin}${ev.path}` };
}

/** Tickets taken per type for an event and date. */
export async function soldCounts(db: SupabaseClient, entryId: number, occurrence: string): Promise<Record<string, number>> {
  const { data, error } = await db.rpc('ticket_sold', { p_entry: entryId, p_occurrence: occurrence });
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as { type: string; quantity: number }[]).map((r) => [r.type, Number(r.quantity)]));
}

// ---- Checkout --------------------------------------------------------------------------------

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
const newToken = () => randomBytes(24).toString('base64url');

async function siteTicketSettings(db: SupabaseClient): Promise<TicketSettings> {
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  return ticketSettings(data?.value);
}

/** Expired holds: marked expired, and their checkouts closed (Square's payment links don't expire). */
export async function expireStale(db: SupabaseClient) {
  const { data } = await db.from('ticket_orders').update({ status: 'expired' }).eq('status', 'pending').lt('expires_at', new Date().toISOString()).select('id, provider, provider_ref');
  for (const o of data ?? []) await cancelCheckout(o);
}

const field = (data: FormData, k: string, max = 300) => String(data.get(k) ?? '').trim().slice(0, max);

/**
 * A ticket form posted (/api/tickets/checkout): where to send the buyer next. A free order is
 * confirmed at once; a paid one holds its tickets and goes to the provider's checkout. Problems go
 * back to the event with ?tickets=<reason>. Null when there is no such event.
 */
export async function startCheckout(data: FormData, origin: string): Promise<string | null> {
  const db = serviceClient();
  const ev = await loadEvent(db, Number(data.get('event')), field(data, 'occurrence', 10));
  if (!ev) return null;
  const back = (reason: string) => `${ev.path}?tickets=${reason}#tickets`;
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
    items.push({ type: type.id, name: type.name, price: type.price, quantity: q });
  }
  const quantity = items.reduce((n, i) => n + i.quantity, 0);
  const amount = items.reduce((n, i) => n + i.price * i.quantity, 0);
  if (!quantity || quantity > (t.maxPerOrder || DEFAULT_MAX_PER_ORDER)) return back('invalid');

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
  if (amount > 0 && !(settings.provider && providerReady(settings.provider))) return back('payments-off');
  const { count } = await db.from('ticket_orders').select('id', { count: 'exact', head: true }).eq('entry_id', ev.series.id).gte('created_at', new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) >= MAX_PER_MINUTE) return back('busy');
  await expireStale(db).catch((e) => console.warn(`tickets: expiring holds: ${e.message}`));

  const free = amount === 0;
  const token = newToken();
  const code = newCode();
  const hold = (settings.hold ?? 30) * 60_000;
  const currency = settings.currency ?? 'usd';
  const limits = { total: t.capacity || null, types: Object.fromEntries(t.types.map((x) => [x.id, x.capacity || null])) };
  const { data: made, error } = await db.rpc('ticket_order_create', {
    p_order: {
      token, code, entry_id: ev.series.id, occurrence: (ev.entry as { occurrence?: string }).occurrence ?? '', event_title: ev.series.title,
      status: free ? 'paid' : 'pending', provider: free ? 'free' : settings.provider, name, email, phone, address, answers, items, amount, currency,
      // A paid order holds its tickets a little longer than the checkout takes payment.
      expires_at: free ? null : new Date(Date.now() + hold + 2 * 60_000).toISOString(),
      paid_at: free ? new Date().toISOString() : null,
    },
    p_limits: limits,
  });
  if (error) throw error;
  if (!made?.ok) return back('sold-out');
  const orderLink = `${ev.path}?order=${token}#tickets`;
  const { data: order } = await db.from('ticket_orders').select('*').eq('id', made.id).single<OrderRow>();
  if (free) {
    await sendConfirmation(db, order!, siteOrigin(origin), ev, settings);
    return orderLink;
  }
  try {
    const label = (n: string) => `${ev.series.title}${(ev.entry as { occurrence?: string }).occurrence ? ` (${eventView(ev, origin).date})` : ''}: ${n}`;
    const returnUrl = `${origin}/api/tickets/return?order=${token}`;
    const checkout = await createCheckout(settings.provider!, {
      token, code, email, currency,
      lines: items.filter((i) => i.price > 0 || items.every((x) => !x.price)).map((i) => ({ name: label(i.name), price: i.price, quantity: i.quantity })),
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
  const ev = order.entry_id ? await loadEvent(db, order.entry_id, order.occurrence, false) : null;
  const path = ev?.path ?? '/';
  if (cancelled && order.status === 'pending') {
    // Paid after all (the buyer pressed back after paying): keep it.
    const state = await paymentState(order).catch(() => ({ paid: false, payment: undefined }));
    if (state.paid) await markPaid(db, order, state.payment);
    else {
      await cancelCheckout(order);
      await db.from('ticket_orders').update({ status: 'cancelled' }).eq('id', order.id).eq('status', 'pending');
      return `${path}?tickets=cancelled#tickets`;
    }
  } else if (order.status === 'pending' || order.status === 'expired') {
    try {
      const state = await paymentState(order);
      if (state.paid) await markPaid(db, order, state.payment);
    } catch (e) {
      // The webhook will confirm it; the order page says it's being confirmed meanwhile.
      console.warn(`tickets: checking order ${order.code}: ${(e as Error).message}`);
    }
  }
  return `${path}?order=${token}#tickets`;
}

/** Mark an order paid (once: a webhook and the buyer's return can both get here) and send its confirmation. */
export async function markPaid(db: SupabaseClient, order: Pick<OrderRow, 'id'>, payment?: string) {
  const { data } = await db
    .from('ticket_orders')
    .update({ status: 'paid', paid_at: new Date().toISOString(), ...(payment ? { provider_payment: payment } : {}) })
    .eq('id', order.id)
    .in('status', ['pending', 'expired'])
    .select('*')
    .maybeSingle<OrderRow>();
  if (data) await sendConfirmation(db, data, siteOrigin());
}

/** A refund the provider reports (made here or in its dashboard): `refunded` is the payment's total refunded. */
export async function recordRefund(db: SupabaseClient, order: OrderRow, refunded: number) {
  const total = Math.max(order.refunded_amount ?? 0, refunded);
  await db.from('ticket_orders').update({ refunded_amount: total, ...(total >= order.amount && order.status === 'paid' ? { status: 'refunded' } : {}) }).eq('id', order.id);
}

// ---- Webhooks --------------------------------------------------------------------------------

const orderBy = async (db: SupabaseClient, column: string, value: unknown) => (value ? (await db.from('ticket_orders').select('*').eq(column, String(value)).maybeSingle<OrderRow>()).data : null);

export async function stripeWebhook(event: any) {
  const db = serviceClient();
  const o = event?.data?.object ?? {};
  switch (event?.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const order = await orderBy(db, 'provider_ref', o.id);
      if (order && o.payment_status === 'paid') await markPaid(db, order, typeof o.payment_intent === 'string' ? o.payment_intent : o.payment_intent?.id);
      break;
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const order = await orderBy(db, 'provider_ref', o.id);
      if (order?.status === 'pending') await db.from('ticket_orders').update({ status: 'expired' }).eq('id', order.id).eq('status', 'pending');
      break;
    }
    case 'charge.refunded': {
      const order = await orderBy(db, 'provider_payment', o.payment_intent);
      if (order) await recordRefund(db, order, Number(o.amount_refunded) || 0);
      break;
    }
  }
}

export async function squareWebhook(event: any) {
  const db = serviceClient();
  const obj = event?.data?.object ?? {};
  if (event?.type === 'payment.created' || event?.type === 'payment.updated') {
    const p = obj.payment ?? {};
    const order = await orderBy(db, 'provider_order', p.order_id);
    if (order && p.status === 'COMPLETED') await markPaid(db, order, p.id);
  } else if (event?.type === 'refund.created' || event?.type === 'refund.updated') {
    const r = obj.refund ?? {};
    if (r.status !== 'COMPLETED') return;
    const order = await orderBy(db, 'provider_payment', r.payment_id);
    if (order) await recordRefund(db, order, (await squarePayment(r.payment_id)).refunded);
  }
}

// ---- The attendee list -----------------------------------------------------------------------

/** Cancel an order: an unpaid one's checkout closes; its tickets go back on sale. Paid orders are refunded instead. */
export async function cancelOrder(db: SupabaseClient, id: number) {
  const { data: order } = await db.from('ticket_orders').select('*').eq('id', id).maybeSingle<OrderRow>();
  if (!order) throw new Error('No such order.');
  if (order.status === 'paid' && order.amount > order.refunded_amount) throw new Error('Refund a paid order to cancel it.');
  if (order.status === 'pending') await cancelCheckout(order);
  await db.from('ticket_orders').update({ status: 'cancelled' }).eq('id', id).in('status', ['pending', 'paid', 'expired']);
}

/** Refund `amount` of a paid order at its provider. All of it: the order is refunded and its tickets go back on sale. */
export async function refundOrder(db: SupabaseClient, id: number, amount: number) {
  const { data: order } = await db.from('ticket_orders').select('*').eq('id', id).maybeSingle<OrderRow>();
  if (!order) throw new Error('No such order.');
  if (order.status !== 'paid') throw new Error('Only paid orders can be refunded.');
  await refundPayment(order, amount, `${order.id}-${order.refunded_amount}-${amount}`);
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
  status: 'waiting' | 'notified' | 'bought' | 'removed';
  notified_at: string | null;
  created_at: string;
}

/** How long a notified person's tickets count as spoken for before the next people are told. */
const WAITLIST_CLAIM = 24 * 3600_000;

/** A waitlist form posted (/api/tickets/waitlist): where to send the visitor next. Null: no such event. */
export async function joinWaitlist(data: FormData): Promise<string | null> {
  const db = serviceClient();
  const ev = await loadEvent(db, Number(data.get('event')), field(data, 'occurrence', 10));
  if (!ev) return null;
  const back = (reason: string) => `${ev.path}?tickets=${reason}#tickets`;
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
  // Joining again keeps one place: the new details, waiting again.
  const { error } = await db.from('ticket_waitlist').upsert({ entry_id: ev.series.id, occurrence, name, email: email.toLowerCase(), phone, quantity, status: 'waiting', notified_at: null }, { onConflict: 'entry_id,occurrence,email' });
  if (error) throw error;
  return back('waitlisted');
}

/** Tickets on sale now (null: no limit). */
async function availableNow(db: SupabaseClient, ev: LoadedEvent): Promise<number | null> {
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
export async function notifyWaitlist(db: SupabaseClient, ev: LoadedEvent, origin: string, ids?: number[]): Promise<number> {
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
  const email = emailToSend('waitlist', settings, ev.emails.waitlist);
  const view = eventView(ev, origin);
  let sent = 0;
  for (const p of (people ?? []) as WaitlistRow[]) {
    if (p.quantity > budget) continue;
    const mail = ticketEmail(email, { code: '', name: p.name, email: p.email, phone: p.phone, items: [], amount: 0, currency: settings.currency ?? 'usd' }, view, { order: `${view.link}#tickets` }, origin);
    if (!(await sendMail({ to: [p.email], ...mail }))) throw new Error('No mail server is set up (SMTP_* in the environment).');
    await db.from('ticket_waitlist').update({ status: 'notified', notified_at: new Date().toISOString() }).eq('id', p.id);
    budget -= p.quantity;
    sent++;
  }
  return sent;
}

/** After tickets free up (a cancellation or refund): the waitlist told, when the event does that itself. */
export async function waitlistAfterRelease(db: SupabaseClient, entryId: number | null, occurrence: string, origin: string) {
  if (!entryId) return;
  const ev = await loadEvent(db, entryId, occurrence, false);
  if (ev?.tickets.waitlist === 'auto' && (ev.endUtc == null || ev.endUtc > Date.now())) {
    await notifyWaitlist(db, ev, siteOrigin(origin)).catch((e) => console.error(`tickets: waitlist for ${ev.series.title}: ${e.message}`));
  }
}

// ---- Emails ----------------------------------------------------------------------------------

function orderView(o: OrderRow, t: EventTickets): OrderView {
  const labels = new Map((t.questions ?? []).map((q) => [q.id, q.label]));
  return { code: o.code, name: o.name, email: o.email, phone: o.phone, address: addressText(o.address) || undefined, items: o.items, amount: o.amount, currency: o.currency, answers: Object.entries(o.answers ?? {}).map(([k, v]) => [labels.get(k) ?? k, v]) };
}

const notifyAddress = () => env('TICKETS_NOTIFY_EMAIL') || env('FORMS_ADMIN_EMAIL') || site.adminEmail;

/** An order's email of a kind: to the buyer, or (admin) to the site's admin address, replying to the buyer. */
async function sendOrderEmail(kind: EmailKind, o: OrderRow, ev: LoadedEvent, settings: TicketSettings, origin: string) {
  const links = { order: `${origin}${ev.path}?order=${o.token}#tickets`, attendees: `${origin}/admin/tickets/${ev.series.id}/${o.occurrence ? `?date=${o.occurrence}` : ''}` };
  const mail = ticketEmail(emailToSend(kind, settings, ev.emails[kind]), orderView(o, ev.tickets), eventView(ev, origin), links, origin);
  return kind === 'admin' ? sendMail({ to: [notifyAddress()], replyTo: o.email, ...mail }) : sendMail({ to: [o.email], ...mail });
}

/** The confirmation to the buyer, and a copy for the site's admin (unless turned off). */
export async function sendConfirmation(db: SupabaseClient, o: OrderRow, origin: string, ev?: LoadedEvent | null, settings?: TicketSettings) {
  ev ??= o.entry_id ? await loadEvent(db, o.entry_id, o.occurrence, false) : null;
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
export async function resendConfirmation(db: SupabaseClient, id: number, origin: string) {
  const { data: o } = await db.from('ticket_orders').select('*').eq('id', id).maybeSingle<OrderRow>();
  if (!o || o.status !== 'paid') throw new Error('Only paid orders have a confirmation.');
  const ev = o.entry_id ? await loadEvent(db, o.entry_id, o.occurrence, false) : null;
  if (!ev) throw new Error('The event is gone.');
  if (!(await sendOrderEmail('confirmation', o, ev, await siteTicketSettings(db), siteOrigin(origin)))) throw new Error('No mail server is set up (SMTP_* in the environment).');
  await db.from('ticket_orders').update({ emailed_at: new Date().toISOString() }).eq('id', id);
}

/**
 * Reminders and follow-ups that are due (hourly, netlify/functions/ticket-emails.mts). A reminder goes
 * out in the hours before the event (not to orders made inside that window: their confirmation is
 * recent); a follow-up the hours after it ends, for up to three days. Orders past either are marked
 * done, so turning an email on later doesn't send it for events long gone.
 */
export async function sendDueTicketEmails(origin = siteOrigin()): Promise<string> {
  const db = serviceClient();
  await expireStale(db).catch(() => {});
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
    if (!events.has(key)) events.set(key, o.entry_id ? await loadEvent(db, o.entry_id, o.occurrence, false).catch(() => null) : null);
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
    const ev = await loadEvent(db, Number(id), occurrence, false).catch(() => null);
    if (ev?.tickets.waitlist === 'auto' && ev.tickets.enabled && (ev.endUtc == null || ev.endUtc > now)) told += await notifyWaitlist(db, ev, origin).catch((e) => (console.error(`tickets: waitlist ${key}: ${e.message}`), 0));
  }
  return `${reminders} reminder${reminders === 1 ? '' : 's'}, ${followUps} follow-up${followUps === 1 ? '' : 's'}, ${told} told from waitlists`;
}
