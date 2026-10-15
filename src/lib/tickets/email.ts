// Ticket emails: the purchase confirmation, the reminder before the event, the follow-up after it and
// the waitlist's notice, and the copy of each order for the site's admin: designed in the email builder
// (src/forms/EmailBuilder.tsx; Settings > Tickets, or an event's own on its attendee list) and rendered
// by the same code as form notifications (src/lib/forms/email.ts), here with the order's merge tags and
// its Order details block. Runs in the browser (the builder's preview) and on the server.
import { money } from './config';
import { renderEmail, textVersion, type EmailContext, type EmailDoc } from '../forms/email';

export interface OrderView {
  /** '' for a waitlist email: no order yet. */
  code: string;
  name: string;
  email: string;
  phone?: string;
  /** One line. */
  address?: string;
  items: { name: string; price: number; quantity: number }[];
  amount: number;
  currency: string;
  answers?: [string, string][];
}

export interface EventView {
  title: string;
  /** "Saturday, October 24, 2026". */
  date: string;
  /** " at 7:00 pm" (or ""). */
  time: string;
  venue: string[];
  link: string;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const ticketsLine = (o: OrderView) => o.items.map((i) => `${i.quantity} × ${i.name}${i.price ? ` (${money(i.price, o.currency)})` : ''}`).join(', ');

/** The order summary's rows: [label, text]. */
function summaryRows(o: OrderView, ev: EventView): [string, string][] {
  return [
    ['Event', ev.title],
    ['When', `${ev.date}${ev.time}`],
    ...(ev.venue.length ? [['Where', ev.venue.join(', ')] as [string, string]] : []),
    ...(o.code ? ([['Order code', o.code], ['Tickets', ticketsLine(o)], ['Total', money(o.amount, o.currency)]] as [string, string][]) : []),
    ...(o.answers ?? []),
  ];
}

/** Where an email's links go: the buyer's order, and the event's attendee list (for the admin's copy). */
export interface EmailLinks {
  order: string;
  attendees?: string;
}

/** The merge tags' values for an order and its event, as text. */
export function tagValues(o: OrderView, ev: EventView, links: EmailLinks): Record<string, string> {
  return {
    '{name}': o.name,
    '{first_name}': o.name.split(/\s+/)[0] ?? o.name,
    '{email}': o.email,
    '{phone}': o.phone ?? '',
    '{address}': o.address ?? '',
    '{event}': ev.title,
    '{date}': ev.date,
    '{time}': ev.time,
    '{venue}': ev.venue.join(', '),
    '{tickets}': o.code ? ticketsLine(o) : '',
    '{total}': o.code ? money(o.amount, o.currency) : '',
    '{code}': o.code,
    '{answers}': (o.answers ?? []).map(([k, v]) => `${k}: ${v}`).join('\n'),
    '{order_summary}': summaryRows(o, ev).map(([k, v]) => `${k}: ${v}`).join('\n'),
    '{order_link}': o.code ? links.order : ev.link,
    '{event_link}': ev.link,
    '{attendee_link}': links.attendees ?? '',
  };
}

/** Merge tags filled in, in one pass (a value that looks like a tag stays as it is): HTML-escaped
 *  values (line breaks kept) when `html`. Unknown tags are left as written. */
export const merge = (text: string, values: Record<string, string>, html = false) =>
  text.replace(/\{[a-z_]+\}/g, (tag) => (tag in values ? (html ? esc(values[tag]).replace(/\n/g, '<br>') : values[tag]) : tag));

/** The Order details block: the summary as a table, or one detail, with or without its label. */
function orderDetail(id: string, showLabel: boolean, o: OrderView, ev: EventView): string {
  const p = (label: string, value: string) => (value ? `${showLabel ? `<p style="margin:0 0 4px 0;font-weight:600">${esc(label)}</p>` : ''}<p style="margin:0">${value}</p>` : '');
  switch (id) {
    case 'when':
      return p('When', esc(`${ev.date}${ev.time}`));
    case 'venue':
      return p('Where', ev.venue.map(esc).join('<br>'));
    case 'code':
      return o.code ? p('Order code', `<strong style="font-size:20px;letter-spacing:0.08em">${esc(o.code)}</strong>`) : '';
    case 'tickets':
      return o.code ? p('Tickets', o.items.map((i) => `${i.quantity} × ${esc(i.name)}${i.price ? ` (${esc(money(i.price, o.currency))} each)` : ''}`).join('<br>')) : '';
    case 'total':
      return o.code ? p('Total', esc(money(o.amount, o.currency))) : '';
    case 'contact':
      return [p('Name', esc(o.name)), p('Email', `<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>`), o.phone ? p('Phone', esc(o.phone)) : '', o.address ? p('Address', esc(o.address)) : ''].filter(Boolean).join('<div style="height:8px"></div>');
    case 'answers':
      return (o.answers ?? []).map(([k, v]) => p(k, esc(v).replace(/\n/g, '<br>'))).join('<div style="height:8px"></div>');
  }
  const rows = summaryRows(o, ev);
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:14px;line-height:1.5">` +
    rows.map(([k, v]) => `<tr>${showLabel ? `<td style="padding:6px 12px 6px 0;color:#6b7280;width:120px;vertical-align:top;border-bottom:1px solid #e5e1dc">${esc(k)}</td>` : ''}<td style="padding:6px 0;vertical-align:top;border-bottom:1px solid #e5e1dc">${k === 'Order code' ? `<strong style="letter-spacing:0.08em">${esc(v)}</strong>` : esc(v)}</td></tr>`).join('') +
    `</table>`
  );
}

/** How the email builder's renderer fills in an order's email. */
export function ticketEmailContext(o: OrderView, ev: EventView, links: EmailLinks, origin: string): EmailContext {
  const values = tagValues(o, ev, links);
  return { merge: (text, html) => merge(text, values, html), field: (id, showLabel) => orderDetail(id, showLabel, o, ev), origin };
}

/** An email for an order: subject, HTML and text (the email's own plain text, else made from the HTML). */
export function ticketEmail(email: { subject: string; design: EmailDoc; text?: string }, o: OrderView, ev: EventView, links: EmailLinks, origin: string) {
  const ctx = ticketEmailContext(o, ev, links, origin);
  const values = tagValues(o, ev, links);
  const subject = merge(email.subject, values);
  const html = renderEmail(email.design, ctx, subject);
  return { subject, html, text: email.text?.trim() ? merge(email.text, values) : textVersion(html) };
}

/** A made-up order, for the builder's preview. */
export const SAMPLE_ORDER: OrderView = {
  code: 'K7QZ-4MXA',
  name: 'Alex Sample',
  email: 'alex@example.com',
  phone: '(716) 555-0100',
  address: '12 Elm Street, Example Town, NY 14731',
  items: [{ name: 'General admission', price: 2500, quantity: 2 }],
  amount: 5000,
  currency: 'usd',
  answers: [['Dietary needs', 'Vegetarian']],
};
export const sampleEvent = (title = 'Sample event', origin = ''): EventView => ({ title, date: 'Saturday, October 24, 2026', time: ' at 7:00 pm', venue: ['Town Hall', '1 Main Street, Example Town'], link: `${origin}/event/sample/` });
