// Ticket emails: the purchase confirmation, the reminder before the event and the follow-up after it,
// and the copy of each order for the site's admin. Messages are plain text with merge tags (written
// under Settings > Tickets or in the event's ticket settings); here they become email-safe HTML (a
// 600px table, inline styles, links made clickable) with the order's details below the message.
import { money, MERGE_TAGS, type EmailKind } from './config';

export interface OrderView {
  code: string;
  name: string;
  email: string;
  phone?: string;
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
const linkify = (s: string) => s.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" style="color:#1a56db">${u}</a>`);

export const ticketsLine = (o: OrderView) => o.items.map((i) => `${i.quantity} × ${i.name}${i.price ? ` (${money(i.price, o.currency)})` : ''}`).join(', ');

/** The merge tags' values for an order and its event. */
export function tagValues(o: OrderView, ev: EventView, orderLink: string): Record<string, string> {
  return {
    '{name}': o.name,
    '{first_name}': o.name.split(/\s+/)[0] ?? o.name,
    '{event}': ev.title,
    '{date}': ev.date,
    '{time}': ev.time,
    '{venue}': ev.venue.join(', '),
    '{tickets}': ticketsLine(o),
    '{total}': money(o.amount, o.currency),
    '{code}': o.code,
    '{order_link}': orderLink,
    '{event_link}': ev.link,
  };
}

export const merge = (text: string, values: Record<string, string>) => MERGE_TAGS.reduce((s, [tag]) => s.split(tag).join(values[tag] ?? ''), text);

function summary(o: OrderView, ev: EventView, orderLink: string): string {
  const row = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#6b7280;width:120px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;vertical-align:top">${v}</td></tr>`;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #e5e7eb;font-size:14px;line-height:1.5">` +
    row('Event', `<a href="${esc(ev.link)}" style="color:#1a56db">${esc(ev.title)}</a>`) +
    row('When', esc(`${ev.date}${ev.time}`)) +
    (ev.venue.length ? row('Where', ev.venue.map(esc).join('<br />')) : '') +
    row('Order code', `<strong style="font-size:16px;letter-spacing:0.08em">${esc(o.code)}</strong>`) +
    row('Tickets', o.items.map((i) => `${i.quantity} × ${esc(i.name)}${i.price ? ` <span style="color:#6b7280">(${esc(money(i.price, o.currency))} each)</span>` : ''}`).join('<br />')) +
    row('Total', esc(money(o.amount, o.currency))) +
    (o.answers ?? []).map(([k, v]) => row(k, esc(v))).join('') +
    `</table>` +
    `<p style="margin:24px 0 0"><a href="${esc(orderLink)}" style="display:inline-block;padding:10px 18px;border-radius:4px;background:#1f2937;color:#ffffff;text-decoration:none;font-weight:600">View your order</a></p>`
  );
}

function layout(title: string, body: string, siteName: string): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /><title>${esc(title)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:6px"><tr><td style="padding:32px 28px;font-size:15px;line-height:1.6">${body}</td></tr></table>` +
    `<p style="margin:16px 0 0;color:#9ca3af;font-size:12px">${esc(siteName)}</p>` +
    `</td></tr></table></body></html>`
  );
}

/** The buyer's email of a kind: subject, HTML and text. */
export function buyerEmail(kind: EmailKind, text: { subject: string; message: string }, o: OrderView, ev: EventView, orderLink: string, siteName: string) {
  const values = tagValues(o, ev, orderLink);
  const subject = merge(text.subject, values);
  const message = merge(text.message, values);
  const paragraphs = message
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${linkify(esc(p.trim())).replace(/\n/g, '<br />')}</p>`)
    .join('');
  // The confirmation and reminder carry the order; the follow-up and the waitlist's email have none.
  const withOrder = kind === 'confirmation' || kind === 'reminder';
  const details = withOrder ? summary(o, ev, orderLink) : '';
  const plain = `${message}\n\n${!withOrder ? '' : `${ev.title}\n${ev.date}${ev.time}\n${ev.venue.join(', ')}\nOrder code: ${o.code}\nTickets: ${ticketsLine(o)}\nTotal: ${money(o.amount, o.currency)}\n${orderLink}\n`}`;
  return { subject, html: layout(subject, paragraphs + details, siteName), text: plain.trim() };
}

/** The admin's copy of a new order. */
export function adminEmail(o: OrderView, ev: EventView, adminLink: string, siteName: string, extra: [string, string][]) {
  const subject = `New ticket order ${o.code}: ${ev.title}`;
  const rows: [string, string][] = [['Name', o.name], ['Email', o.email], ...(o.phone ? [['Phone', o.phone] as [string, string]] : []), ...extra];
  const body =
    `<p style="margin:0 0 14px">${esc(o.name)} ordered ${esc(ticketsLine(o))} for <strong>${esc(ev.title)}</strong> (${esc(`${ev.date}${ev.time}`)}). Total ${esc(money(o.amount, o.currency))}.</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#6b7280;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('')}</table>` +
    `<p style="margin:20px 0 0"><a href="${esc(adminLink)}" style="color:#1a56db">See the attendee list</a></p>`;
  return { subject, html: layout(subject, body, siteName), text: `${o.name} <${o.email}> ordered ${ticketsLine(o)} for ${ev.title} (${ev.date}${ev.time}). Total ${money(o.amount, o.currency)}.\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n${adminLink}` };
}
