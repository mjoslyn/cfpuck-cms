// Tickets: what an event sells (its fields.tickets, edited in the event's settings) and the site's
// ticket settings (settings.site.tickets, Settings > Tickets). Read by the renderer, the editor and the
// server alike, so nothing here touches the database or the environment.

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

/** An email's text: a subject and a message with merge tags ({name}, {event}...); empty: the default. */
export interface TicketEmail {
  subject?: string;
  message?: string;
}

export type EmailKind = 'confirmation' | 'reminder' | 'followUp' | 'waitlist';

/** An event's tickets (fields.tickets). */
export interface EventTickets {
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
  /** The event's own wording for its emails, and the reminder and follow-up turned off for it. */
  emails?: Partial<Record<EmailKind, TicketEmail & { off?: boolean }>>;
}

export const TICKETS_KEY = 'tickets';

/** The site's ticket settings (settings.site.tickets). */
export interface TicketSettings {
  /** Who takes payments: Stripe or Square (their keys in the environment). Free tickets need neither. */
  provider?: 'stripe' | 'square';
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
  };
}

/** Currencies with two decimal places (the units prices are stored in). */
export const CURRENCIES: [string, string][] = [
  ['usd', 'US dollar'],
  ['cad', 'Canadian dollar'],
  ['eur', 'Euro'],
  ['gbp', 'Pound sterling'],
  ['aud', 'Australian dollar'],
  ['nzd', 'New Zealand dollar'],
];

export const DEFAULT_MAX_PER_ORDER = 10;
export const DEFAULT_HOLD = 30;
export const DEFAULT_REMINDER_HOURS = 24;
export const DEFAULT_FOLLOW_UP_HOURS = 24;

export const MERGE_TAGS: [string, string][] = [
  ['{name}', "Buyer's name"],
  ['{first_name}', 'First name'],
  ['{event}', 'Event title'],
  ['{date}', 'Event date'],
  ['{time}', 'Event time'],
  ['{venue}', 'Venue and address'],
  ['{tickets}', 'Tickets bought'],
  ['{total}', 'Total paid'],
  ['{code}', 'Order code (not on waitlist emails)'],
  ['{order_link}', 'Link to the order'],
  ['{event_link}', 'Link to the event'],
];

export const DEFAULT_EMAILS: Record<EmailKind, Required<TicketEmail>> = {
  confirmation: {
    subject: 'Your tickets for {event}',
    message: "Hi {first_name},\n\nYou're all set for {event} on {date}{time}.\n\nShow your order code {code} at the door, on your phone or printed. Your order: {order_link}\n\nSee you there!",
  },
  reminder: {
    subject: 'Reminder: {event} is coming up',
    message: 'Hi {first_name},\n\nThis is a reminder that {event} is on {date}{time}.\n\n{venue}\n\nYour order code is {code}. Event details: {event_link}',
  },
  followUp: {
    subject: 'Thanks for coming to {event}',
    message: 'Hi {first_name},\n\nThank you for coming to {event}. We hope you enjoyed it, and we hope to see you again soon.',
  },
  waitlist: {
    subject: 'Tickets are available for {event}',
    message: "Hi {first_name},\n\nGood news: tickets have become available for {event} on {date}{time}. You were on the waitlist, so we're letting you know first. They go to whoever buys first:\n\n{event_link}",
  },
};

const num = (v: unknown): number | null => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.max(0, Math.floor(Number(v))));
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const localTime = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : undefined);

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
    enabled: t.enabled === true,
    heading: str(t.heading, 200) || undefined,
    types,
    capacity: num(t.capacity),
    maxPerOrder: num(t.maxPerOrder),
    phone: ['optional', 'required'].includes(t.phone) ? t.phone : 'off',
    address: ['paid', 'always'].includes(t.address) ? t.address : 'off',
    questions,
    waitlist: ['auto', 'manual'].includes(t.waitlist) ? t.waitlist : 'off',
    emails: t.emails && typeof t.emails === 'object' ? t.emails : undefined,
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

/** The settings as the settings API stores them (known keys only). */
export function ticketSettingsFrom(v: unknown): TicketSettings | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const s = ticketSettings({ tickets: v });
  const email = (e: any, timed: boolean) => {
    if (!e || typeof e !== 'object') return undefined;
    const out: Record<string, unknown> = { subject: str(e.subject, 300) || undefined, message: str(e.message, 10_000) || undefined };
    if (timed) Object.assign(out, { on: e.on === true, hours: Math.min(Math.max(num(e.hours) ?? 24, 1), 24 * 30) });
    return out;
  };
  const e = (v as TicketSettings).emails ?? {};
  return { ...s, emails: { confirmation: email(e.confirmation, false), reminder: email(e.reminder, true), followUp: email(e.followUp, true), waitlist: email(e.waitlist, false) } };
}

/** An email's subject and message: the event's own, else the site's, else the default. */
export function emailText(kind: EmailKind, site: TicketSettings, event: EventTickets): Required<TicketEmail> {
  const own = event.emails?.[kind];
  const siteText = site.emails?.[kind];
  return {
    subject: own?.subject?.trim() || siteText?.subject?.trim() || DEFAULT_EMAILS[kind].subject,
    message: own?.message?.trim() || siteText?.message?.trim() || DEFAULT_EMAILS[kind].message,
  };
}

/** Whether the reminder (or follow-up) goes out for this event, and how many hours before (after) it. */
export function timedEmail(kind: 'reminder' | 'followUp', site: TicketSettings, event: EventTickets): number | null {
  const s = site.emails?.[kind];
  if (!s?.on || event.emails?.[kind]?.off) return null;
  return s.hours || (kind === 'reminder' ? DEFAULT_REMINDER_HOURS : DEFAULT_FOLLOW_UP_HOURS);
}

/** "$25.00", "Free". */
export function money(cents: number, currency = 'usd', free = 'Free'): string {
  if (!cents) return free;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

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
};
