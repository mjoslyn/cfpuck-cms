// Tickets: what an event sells (its fields.tickets, edited in the event's settings) and the site's
// ticket settings (settings.site.tickets, Settings > Tickets), with the emails buyers get, designed in
// the email builder (src/forms/EmailBuilder.tsx). Read by the renderer, the editor and the server
// alike, so nothing here touches the database or the environment.
import type { EmailDoc } from '../forms/email';
import type { PaymentProvider } from '../payments';
import { CURRENCIES as PAYMENT_CURRENCIES, formatMoney } from '../payments/money';
import { isActive, type MemberRow } from '../members/config';

/** A kind of ticket ("Adult", "Child", "VIP"). Prices are in the currency's smallest unit (cents). */
export interface TicketType {
  id: string;
  name: string;
  description?: string;
  price: number;
  /** How many there are (empty: no limit of its own). */
  capacity?: number | null;
  /** Most of this type in one order (default: the event's). */
  maxPerOrder?: number | null;
  /** On sale from and until, local times in the event's timezone ("Y-m-dTH:i"); empty: always, until the event ends. */
  salesStart?: string;
  salesEnd?: string;
  /** Kept for past orders, no longer offered. */
  hidden?: boolean;
  /** Members' prices by level id, in cents (Members, src/lib/members/); a level without one pays `price`. */
  memberPrices?: Record<string, number>;
  /** Only members may buy it: of `levels`, or any level when none. */
  membersOnly?: boolean;
  levels?: string[];
}

/** One of an event's own questions, asked once per order. */
export interface TicketQuestion {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'number';
  required?: boolean;
  /** For select. */
  choices?: string[];
  help?: string;
}

/** An email: its subject and design (email builder blocks), with merge tags ({name}, {event}...), and
 *  its plain-text version (made from the design when empty). Anything empty takes the default. */
export interface TicketEmail {
  subject?: string;
  design?: EmailDoc;
  text?: string;
}

/** An event's own email of a kind (table ticket_emails), or just the reminder or follow-up turned off. */
export interface EventEmail extends TicketEmail {
  off?: boolean;
}

/** The buyer's emails, and the copy of each order for the site's admin. */
export type EmailKind = 'confirmation' | 'reminder' | 'followUp' | 'waitlist' | 'admin';

/** An event's tickets (fields.tickets). */
export interface EventTickets {
  /** Whether the event sells tickets: it has ticket types (read with ticketsOf; not stored). */
  enabled?: boolean;
  /** Heading over the ticket form (default "Tickets"). */
  heading?: string;
  types: TicketType[];
  /** All types together (empty: no limit). For a recurring event, per date. */
  capacity?: number | null;
  /** Most tickets in one order (default 10). */
  maxPerOrder?: number | null;
  phone?: 'off' | 'optional' | 'required';
  /** off; paid: asked when the order costs something; always. */
  address?: 'off' | 'paid' | 'always';
  questions?: TicketQuestion[];
  /** When sold out, visitors can join a waitlist. auto: when tickets free up, the people waiting are
   *  emailed in order (as many as the tickets free cover); manual: the attendee list's Notify does it. */
  waitlist?: 'off' | 'auto' | 'manual';
}

export const TICKETS_KEY = 'tickets';

/** The site's ticket settings (settings.site.tickets). */
export interface TicketSettings {
  /** Who takes payments when both Stripe and Square have keys in the environment (else the one that does). Free tickets need neither. */
  provider?: PaymentProvider;
  /** ISO code, lower case (default usd). */
  currency?: string;
  /** Minutes an unpaid order holds its tickets while the buyer pays (default 30). */
  hold?: number;
  /** A copy of each order to the site's admin address. */
  notify?: boolean;
  emails?: {
    confirmation?: TicketEmail;
    reminder?: TicketEmail & { on?: boolean; hours?: number };
    followUp?: TicketEmail & { on?: boolean; hours?: number };
    waitlist?: TicketEmail;
    admin?: TicketEmail;
  };
}

/** Currencies with two decimal places (the units prices are stored in). */
/** The currencies offered, as the settings store them (lower case). */
export const CURRENCIES: [string, string][] = PAYMENT_CURRENCIES.map(([code, name]) => [code.toLowerCase(), name]);

export const DEFAULT_MAX_PER_ORDER = 10;
export const DEFAULT_HOLD = 30;
export const DEFAULT_REMINDER_HOURS = 24;
export const DEFAULT_FOLLOW_UP_HOURS = 24;

export const EMAIL_KINDS: [EmailKind, string][] = [
  ['confirmation', 'Confirmation'],
  ['reminder', 'Reminder'],
  ['followUp', 'Follow-up'],
  ['waitlist', 'Waitlist: tickets available'],
  ['admin', 'Copy to the admin'],
];

export const MERGE_TAGS: [string, string][] = [
  ['{name}', "Buyer's name"],
  ['{first_name}', 'First name'],
  ['{email}', "Buyer's email"],
  ['{phone}', "Buyer's phone"],
  ['{address}', "Buyer's address"],
  ['{event}', 'Event title'],
  ['{date}', 'Event date'],
  ['{time}', 'Event time'],
  ['{venue}', 'Venue and address'],
  ['{tickets}', 'Tickets bought'],
  ['{total}', 'Total paid'],
  ['{code}', 'Order code'],
  ['{answers}', 'Answers to the questions'],
  ['{order_summary}', 'Order summary'],
  ['{payment_summary}', 'Payment: items, total and details (paid orders)'],
  ['{order_link}', 'Link to the order (waitlist: to the tickets)'],
  ['{event_link}', 'Link to the event'],
  ['{attendee_link}', 'Link to the attendee list (for the admin)'],
];

/** What the email builder's Order details block can show ('all': the order summary as a table). */
export const ORDER_DETAILS: [string, string][] = [
  ['all', 'Order summary (a table)'],
  ['when', 'Date and time'],
  ['venue', 'Venue and address'],
  ['code', 'Order code'],
  ['tickets', 'Tickets bought'],
  ['total', 'Total paid'],
  ['answers', 'Answers to the questions'],
  ['contact', "The buyer's name, email, phone and address"],
];

const block = (type: string, id: string, props: Record<string, unknown>) => ({ type, props: { id: `${type}-${id}`, ...props } });
const doc = (...content: ReturnType<typeof block>[]): EmailDoc => ({ root: { props: {} }, content });

/** Each email as it is until someone designs their own. */
export const DEFAULT_EMAILS: Record<EmailKind, Required<Omit<TicketEmail, 'text'>>> = {
  confirmation: {
    subject: 'Your tickets for {event}',
    design: doc(
      block('Heading', 'h', { text: "You're going to {event}", level: 2 }),
      block('Text', 't', { html: "<p>Hi {first_name},</p><p>You're all set for {event} on {date}{time}. Show your order code at the door, on your phone or printed.</p>" }),
      block('FormField', 'f', { field: 'all', showLabel: true }),
      block('Button', 'b', { label: 'View your order', url: '{order_link}' }),
      block('Text', 'e', { html: '<p>See you there!</p>' }),
    ),
  },
  reminder: {
    subject: 'Reminder: {event} is coming up',
    design: doc(
      block('Heading', 'h', { text: '{event} is coming up', level: 2 }),
      block('Text', 't', { html: '<p>Hi {first_name},</p><p>This is a reminder that {event} is on {date}{time}.</p>' }),
      block('FormField', 'f', { field: 'all', showLabel: true }),
      block('Button', 'b', { label: 'Event details', url: '{event_link}' }),
    ),
  },
  followUp: {
    subject: 'Thanks for coming to {event}',
    design: doc(
      block('Heading', 'h', { text: 'Thanks for coming', level: 2 }),
      block('Text', 't', { html: '<p>Hi {first_name},</p><p>Thank you for coming to {event}. We hope you enjoyed it, and we hope to see you again soon.</p>' }),
    ),
  },
  waitlist: {
    subject: 'Tickets are available for {event}',
    design: doc(
      block('Heading', 'h', { text: 'Tickets are available', level: 2 }),
      block('Text', 't', { html: "<p>Hi {first_name},</p><p>Good news: tickets have become available for {event} on {date}{time}. You were on the waitlist, so we're letting you know first. They go to whoever buys first.</p>" }),
      block('Button', 'b', { label: 'Get tickets', url: '{order_link}' }),
    ),
  },
  admin: {
    subject: 'New ticket order {code}: {event}',
    design: doc(
      block('Heading', 'h', { text: 'New order: {event}', level: 2 }),
      block('Text', 't', { html: '<p>{name} ordered {tickets} for {event} ({date}{time}). Total {total}.</p>' }),
      block('FormField', 'c', { field: 'contact', showLabel: true }),
      block('FormField', 'f', { field: 'all', showLabel: true }),
      block('Button', 'b', { label: 'See the attendee list', url: '{attendee_link}' }),
    ),
  },
};

const num = (v: unknown): number | null => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.max(0, Math.floor(Number(v))));
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const localTime = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : undefined);

function memberPricesOf(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, p]) => [k.slice(0, 40), num(p)]).filter(([, p]) => p != null)) as Record<string, number>;
  return Object.keys(out).length ? out : undefined;
}

/** What a ticket costs a buyer: their level's member price, else its price. */
export const priceFor = (t: TicketType, member: MemberRow | null | undefined) => (isActive(member) && t.memberPrices?.[member.level] != null ? t.memberPrices[member.level] : t.price);

/** Whether a buyer may buy a ticket: anyone, or for a members-only one an active member of its levels. */
export const mayBuy = (t: TicketType, member: MemberRow | null | undefined) =>
  !t.membersOnly || (isActive(member) && (!t.levels?.length || t.levels.includes(member.level)));

/** Whether an event's tickets depend on who buys them (member prices, members-only types). */
export const forMembers = (t: EventTickets) => t.types.some((x) => x.membersOnly || (x.memberPrices && Object.keys(x.memberPrices).length));

/** An event's tickets as stored, cleaned up (anything missing takes its default). */
export function ticketsOf(fields: Record<string, any> | null | undefined): EventTickets {
  const t = fields?.[TICKETS_KEY];
  if (!t || typeof t !== 'object') return { types: [] };
  const types: TicketType[] = (Array.isArray(t.types) ? t.types : [])
    .filter((x: any) => x && typeof x.id === 'string' && x.id)
    .map((x: any) => ({
      id: x.id.slice(0, 40),
      name: str(x.name, 200) || 'Ticket',
      description: str(x.description, 1000) || undefined,
      price: num(x.price) ?? 0,
      capacity: num(x.capacity),
      maxPerOrder: num(x.maxPerOrder),
      salesStart: localTime(x.salesStart),
      salesEnd: localTime(x.salesEnd),
      hidden: x.hidden === true || undefined,
      memberPrices: memberPricesOf(x.memberPrices),
      membersOnly: x.membersOnly === true || undefined,
      levels: Array.isArray(x.levels) ? x.levels.filter((l: unknown) => typeof l === 'string' && l).slice(0, 50) : undefined,
    }));
  const questions: TicketQuestion[] = (Array.isArray(t.questions) ? t.questions : [])
    .filter((q: any) => q && typeof q.id === 'string' && q.id && str(q.label))
    .map((q: any) => ({
      id: q.id.slice(0, 40),
      label: str(q.label, 300),
      type: ['text', 'textarea', 'select', 'checkbox', 'number'].includes(q.type) ? q.type : 'text',
      required: q.required === true || undefined,
      choices: Array.isArray(q.choices) ? q.choices.map((c: unknown) => str(c, 200)).filter(Boolean) : undefined,
      help: str(q.help, 500) || undefined,
    }));
  return {
    enabled: types.length > 0,
    heading: str(t.heading, 200) || undefined,
    types,
    capacity: num(t.capacity),
    maxPerOrder: num(t.maxPerOrder),
    phone: ['optional', 'required'].includes(t.phone) ? t.phone : 'off',
    address: ['paid', 'always'].includes(t.address) ? t.address : 'off',
    questions,
    waitlist: ['auto', 'manual'].includes(t.waitlist) ? t.waitlist : 'off',
  };
}

/** The site's ticket settings, cleaned up. */
export function ticketSettings(site: Record<string, any> | null | undefined): TicketSettings {
  const t = site?.tickets ?? {};
  return {
    provider: t.provider === 'stripe' || t.provider === 'square' ? t.provider : undefined,
    currency: CURRENCIES.some(([c]) => c === t.currency) ? t.currency : 'usd',
    hold: Math.min(Math.max(num(t.hold) ?? DEFAULT_HOLD, 30), 120),
    notify: t.notify !== false,
    emails: t.emails && typeof t.emails === 'object' ? t.emails : {},
  };
}

/** An email builder document as stored (its shape checked, at most 200 KB), or undefined. */
export function emailDocFrom(v: unknown): EmailDoc | undefined {
  const d = v as EmailDoc | undefined;
  if (!d || typeof d !== 'object' || !Array.isArray(d.content) || typeof d.root !== 'object') return undefined;
  return JSON.stringify(d).length <= 200_000 ? { root: { props: d.root?.props ?? {} }, content: d.content } : undefined;
}

/** An email as stored: subject, design and plain text (each only when set). */
export function ticketEmailFrom(e: any): TicketEmail {
  return { subject: str(e?.subject, 300) || undefined, design: emailDocFrom(e?.design), text: str(e?.text, 20_000) || undefined };
}

/** The settings as the settings API stores them (known keys only). */
export function ticketSettingsFrom(v: unknown): TicketSettings | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const s = ticketSettings({ tickets: v });
  const e = (v as TicketSettings).emails ?? {};
  const timed = (x: any) => ({ ...ticketEmailFrom(x), on: x?.on === true, hours: Math.min(Math.max(num(x?.hours) ?? 24, 1), 24 * 30) });
  return { ...s, emails: { confirmation: ticketEmailFrom(e.confirmation), reminder: timed(e.reminder), followUp: timed(e.followUp), waitlist: ticketEmailFrom(e.waitlist), admin: ticketEmailFrom(e.admin) } };
}

/**
 * The email that is sent: the event's own design (and its subject and text), else the site's, else the
 * default. A subject left empty comes from the next one down.
 */
export function emailToSend(kind: EmailKind, site: TicketSettings, own?: EventEmail): { subject: string; design: EmailDoc; text?: string } {
  const siteEmail = site.emails?.[kind];
  const from = own?.design ? own : siteEmail?.design ? siteEmail : undefined;
  return {
    subject: own?.subject?.trim() || siteEmail?.subject?.trim() || DEFAULT_EMAILS[kind].subject,
    design: from?.design ?? DEFAULT_EMAILS[kind].design,
    text: from?.text,
  };
}

/** Whether the reminder (or follow-up) goes out for this event, and how many hours before (after) it. */
export function timedEmail(kind: 'reminder' | 'followUp', site: TicketSettings, own?: EventEmail): number | null {
  const s = site.emails?.[kind];
  if (!s?.on || own?.off) return null;
  return s.hours || (kind === 'reminder' ? DEFAULT_REMINDER_HOURS : DEFAULT_FOLLOW_UP_HOURS);
}

/** "$25.00", "Free". */
export const money = (cents: number, currency = 'usd', free = 'Free'): string => (cents ? formatMoney(cents, currency) : free);

/** "25.00" -> 2500 (an editor's price as cents); null when it isn't a price. */
export function parsePrice(s: string): number | null {
  const m = s.trim().replace(/[$,\s]/g, '').match(/^(\d*)(?:\.(\d{0,2}))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] || 0) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** The most of a type one order can take. */
export const maxFor = (t: TicketType, ev: EventTickets) => Math.max(1, Math.min(t.maxPerOrder || Infinity, ev.maxPerOrder || DEFAULT_MAX_PER_ORDER));

/** Why a type isn't on sale at `now` (local "Y-m-dTH:i" in the event's timezone), or '' when it is. */
export function offSale(t: TicketType, now: string): '' | 'not-yet' | 'ended' {
  if (t.salesStart && now < t.salesStart) return 'not-yet';
  if (t.salesEnd && now >= t.salesEnd) return 'ended';
  return '';
}

/** The types offered to buyers (not hidden). */
export const offeredTypes = (ev: EventTickets) => ev.types.filter((t) => !t.hidden);

/** What's left: per type, and of the event (null: no limit), given what's taken. */
export function remaining(ev: EventTickets, sold: Record<string, number>) {
  const taken = Object.values(sold).reduce((a, b) => a + b, 0);
  const total = ev.capacity ? Math.max(ev.capacity - taken, 0) : null;
  const types: Record<string, number | null> = {};
  for (const t of ev.types) {
    const own = t.capacity ? Math.max(t.capacity - (sold[t.id] ?? 0), 0) : null;
    types[t.id] = own == null ? total : total == null ? own : Math.min(own, total);
  }
  return { total, types };
}

/** Now as a local "Y-m-dTH:i" in `tz` (how sales windows are written). */
export function localNow(tz: string, now = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Ids for new ticket types and questions. */
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Messages for ?tickets=<code> after a checkout comes back. */
export const CHECKOUT_MESSAGES: Record<string, string> = {
  'sold-out': 'Sorry, there are not enough tickets left for that order. Please choose fewer.',
  closed: 'Ticket sales for this event are closed.',
  invalid: 'Please check your order: choose at least one ticket and fill in the required fields.',
  busy: 'We are receiving a lot of orders. Please try again in a minute.',
  'payments-off': 'Online payment is not available right now. Please contact us to buy tickets.',
  'payment-error': 'We could not start the payment. Please try again.',
  cancelled: 'Your payment was cancelled and nothing was charged. You can try again below.',
  expired: 'Your order expired before it was paid. Please start again.',
  waitlisted: "You're on the waitlist. We'll email you if tickets become available.",
  'members-only': 'Some of those tickets are for members. Sign in to buy them.',
};
