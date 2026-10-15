// Notification emails built with the email builder (src/forms/EmailBuilder.tsx): a Puck document of
// email blocks, rendered here to email-safe HTML: tables for layout, inline styles, a 600px body, a
// preheader, and a media query only to stack columns on phones. The builder's canvas uses the same
// renderer, so what an editor sees is what is sent. Runs in the browser and on the server.
import { PAYMENT_STATUS } from './logic';
import { formatMoney } from '../payments/money';
import type { SubmissionPayment } from './types';

export interface EmailItem {
  type: string;
  props: { id: string; [key: string]: any };
}
export interface EmailRoot {
  background?: string;
  contentBackground?: string;
  width?: number;
  fontFamily?: string;
  textColor?: string;
  linkColor?: string;
  /** Shown after the subject in inbox lists. */
  preheader?: string;
}
export interface EmailDoc {
  root: { props: EmailRoot };
  content: EmailItem[];
}

/** How a render fills in what depends on a submission. */
export interface EmailContext {
  /** Merge tags ({Name:f3}, {form_title}...) in text: HTML-escaped values when `html`. */
  merge: (text: string, html: boolean) => string;
  /** A form field's answer as HTML (`all`: every answer as a table), with or without its label. */
  field: (id: string, showLabel: boolean) => string;
  /** The site's address, for images and links given as /paths. */
  origin: string;
  /** The submission's payment, for the Payment block (none: the block shows nothing). */
  payment?: EmailPayment | null;
  /** Each Events block's events, by block id (src/lib/events/email.ts loads them; none: its empty text). */
  events?: Record<string, EmailEvent[]>;
}

/** An event as the Events block shows it. */
export interface EmailEvent {
  title: string;
  link: string;
  /** "Saturday, October 24, 2026 at 7:00 pm". */
  when: string;
  venue?: string;
  /** The featured image's address. */
  image?: string;
  alt?: string;
  excerpt?: string;
}

/** A payment as the Payment block and {payment_summary} show it. */
export interface EmailPayment {
  items: { name: string; unit: number; quantity: number }[];
  /** Minor units (cents). */
  amount: number;
  currency: string;
  /** As shown: Paid, Processing... */
  status: string;
  /** Stripe or Square. */
  method?: string;
  id?: string;
  /** When it was paid, written out. */
  date?: string;
}

/** A stored payment as the email shows it, its date in the site's timezone. */
export function emailPayment(p: SubmissionPayment, timeZone: string): EmailPayment {
  return {
    items: p.items ?? [],
    amount: p.amount,
    currency: p.currency,
    status: PAYMENT_STATUS[p.status] ?? p.status,
    method: p.provider === 'stripe' ? 'Stripe' : p.provider === 'square' ? 'Square' : undefined,
    id: p.payment_id,
    date: p.paid_at ? new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'long' }).format(new Date(p.paid_at)) : undefined,
  };
}

/** A payment as an email table: each item and its amount, the total, then status, provider, id and date. */
export function paymentTable(pay: EmailPayment, opts: { items?: boolean; details?: boolean } = {}): string {
  const money = (n: number) => esc(formatMoney(n, pay.currency));
  const cell = 'padding:6px 0;border-bottom:1px solid #e5e1dc;vertical-align:top';
  const items = opts.items === false ? '' : pay.items
    .map((it) => `<tr><td style="${cell}">${esc(it.name)}${it.quantity > 1 ? ` <span style="color:#64748b">x ${it.quantity}</span>` : ''}</td><td align="right" style="${cell};padding-left:12px;text-align:right;white-space:nowrap">${money(it.unit * it.quantity)}</td></tr>`)
    .join('');
  const total = `<tr><td style="padding:8px 0;font-weight:700">Total</td><td align="right" style="padding:8px 0 8px 12px;text-align:right;font-weight:700;white-space:nowrap">${money(pay.amount)}</td></tr>`;
  const details = opts.details === false ? [] : [pay.status, pay.method, pay.id && `Payment ID ${pay.id}`, pay.date].filter(Boolean) as string[];
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:15px">${items}${total}</table>` +
    (details.length ? `<p style="margin:8px 0 0 0;font-size:13px;color:#64748b">${details.map(esc).join(' · ')}</p>` : '')
  );
}

export const EMAIL_DEFAULTS: Required<Omit<EmailRoot, 'preheader'>> = {
  background: '#f4f2ef',
  contentBackground: '#ffffff',
  width: 600,
  fontFamily: 'Helvetica, Arial, sans-serif',
  textColor: '#1a1a2e',
  linkColor: '#1f6672',
};

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** A colour as written in a style attribute (hex, rgb(), or a name); anything else is dropped. */
const color = (v: unknown, fallback: string) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|[a-z]+)$/i.test(v.trim()) ? v.trim() : fallback);
const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const align = (v: unknown) => (v === 'center' || v === 'right' ? v : 'left');
/** A link or image address: absolute http(s)/mailto/tel, a /path on the site, or a merge tag. */
function href(v: unknown, origin: string): string {
  const s = String(v ?? '').trim();
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  if (s.startsWith('/')) return origin.replace(/\/$/, '') + s;
  if (/^\{[^{}]+\}$/.test(s)) return s;
  return '';
}

/**
 * Rich text kept to what email clients show the same: paragraphs, line breaks, bold, italic, links and
 * lists, each with inline styles. Everything else is unwrapped; scripts and styles are dropped.
 */
export function emailText(html: string, root: Required<Omit<EmailRoot, 'preheader'>>, origin: string): string {
  const keep = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'a', 'ul', 'ol', 'li']);
  const style: Record<string, string> = {
    p: 'margin:0 0 12px 0;',
    ul: 'margin:0 0 12px 0;padding-left:22px;',
    ol: 'margin:0 0 12px 0;padding-left:22px;',
    li: 'margin:0 0 4px 0;',
    a: `color:${root.linkColor};text-decoration:underline;`,
  };
  return String(html ?? '')
    .replace(/<\s*(script|style|iframe|object)[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(\/?)\s*([a-z0-9]+)([^>]*)>/gi, (_, close: string, tag: string, attrs: string) => {
      const t = tag.toLowerCase() === 'div' ? 'p' : tag.toLowerCase();
      if (!keep.has(t)) return '';
      if (close) return `</${t}>`;
      if (t === 'br') return '<br>';
      if (t === 'a') {
        const m = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)')/i);
        const url = href(m ? (m[2] ?? m[3]) : '', origin);
        return url ? `<a href="${esc(url)}" style="${style.a}">` : '<a>';
      }
      return style[t] ? `<${t} style="${style[t]}">` : `<${t}>`;
    })
    .replace(/<p style="[^"]*">\s*<\/p>/g, '');
}

/** One event of an Events block: its image beside the text (above it on phones), a line under all but the
 *  last. The image isn't a link: in the plain text made from the HTML it would be a bare address. */
function eventRow(ev: EmailEvent, p: Record<string, any>, root: Required<Omit<EmailRoot, 'preheader'>>, first: boolean, last: boolean): string {
  const link = esc(ev.link);
  const muted = 'margin:0;font-size:14px;line-height:1.45;color:#64748b';
  const text = [
    `<p style="margin:0 0 4px 0;font-size:17px;line-height:1.3;font-weight:700"><a href="${link}" style="color:${root.textColor};text-decoration:none">${esc(ev.title)}</a></p>`,
    `<p style="${muted}">${esc(ev.when)}</p>`,
    p.showVenue !== false && ev.venue ? `<p style="${muted}">${esc(ev.venue)}</p>` : '',
    p.showExcerpt !== false && ev.excerpt ? `<p style="margin:8px 0 0 0;font-size:15px;line-height:1.5">${esc(ev.excerpt)}</p>` : '',
    p.linkLabel ? `<p style="margin:8px 0 0 0;font-size:15px"><a href="${link}" style="color:${root.linkColor};font-weight:600;text-decoration:underline">${esc(p.linkLabel)}</a></p>` : '',
  ].join('');
  const image =
    p.showImage !== false && ev.image
      ? `<td class="email-col" width="160" valign="top" style="width:160px;vertical-align:top;padding-right:16px"><img src="${esc(ev.image)}" alt="${esc(ev.alt ?? '')}" width="160" style="display:block;width:100%;max-width:160px;height:auto;border:0;border-radius:4px;margin:0 0 8px 0" /></td>`
      : '';
  const pad = `padding:${first ? 0 : 14}px 0 ${last ? 0 : 14}px 0;${last ? '' : 'border-bottom:1px solid #e5e1dc;'}`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="${pad}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${image}<td${image ? ' class="email-col"' : ''} valign="top" style="vertical-align:top;font-family:${root.fontFamily};color:${root.textColor}">${text}</td></tr></table></td></tr></table>`;
}

/** Each block in a full-width table row, so spacing holds in Outlook too. */
const row = (inner: string, td = '') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td${td}>${inner}</td></tr></table>`;

/** One block (and what is inside it) as email HTML. */
export function renderBlock(item: EmailItem, ctx: EmailContext, rootIn: EmailRoot): string {
  const root = { ...EMAIL_DEFAULTS, ...stripEmpty(rootIn) };
  const p = item.props ?? {};
  const font = `font-family:${root.fontFamily};`;
  switch (item.type) {
    case 'Heading': {
      const level = num(p.level, 2, 1, 3);
      const size = { 1: 28, 2: 22, 3: 18 }[level as 1 | 2 | 3];
      return row(`<h${level} style="margin:0 0 12px 0;${font}font-size:${size}px;line-height:1.25;font-weight:700;color:${color(p.color, root.textColor)};text-align:${align(p.align)}">${ctx.merge(esc(p.text ?? ''), true)}</h${level}>`);
    }
    case 'Text':
      return row(`<div style="${font}font-size:16px;line-height:1.55;color:${color(p.color, root.textColor)};text-align:${align(p.align)}">${ctx.merge(emailText(p.html ?? '', root, ctx.origin), true)}</div>`);
    case 'Button': {
      const url = href(ctx.merge(String(p.url ?? ''), false), ctx.origin);
      const bg = color(p.background, root.linkColor);
      const fg = color(p.color, '#ffffff');
      const label = ctx.merge(esc(p.label || 'Button'), true);
      const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align(p.align)}"><tr><td bgcolor="${bg}" style="border-radius:4px;background:${bg}"><a href="${esc(url || '#')}" style="display:inline-block;padding:12px 24px;${font}font-size:16px;font-weight:600;line-height:1.2;color:${fg};text-decoration:none;border-radius:4px">${label}</a></td></tr></table>`;
      return row(button, ` align="${align(p.align)}" style="padding:4px 0 16px 0"`);
    }
    case 'Image': {
      const src = href(p.src, ctx.origin);
      if (!src) return '';
      const width = num(p.width, root.width, 20, root.width);
      let img = `<img src="${esc(src)}" alt="${esc(p.alt ?? '')}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none" />`;
      const link = href(ctx.merge(String(p.href ?? ''), false), ctx.origin);
      if (link) img = `<a href="${esc(link)}" style="text-decoration:none">${img}</a>`;
      return row(img, ` align="${align(p.align)}" style="padding:0 0 16px 0"`);
    }
    case 'Divider':
      return row(`<div style="border-top:1px solid ${color(p.color, '#e5e1dc')};height:1px;line-height:1px;font-size:1px">&nbsp;</div>`, ' style="padding:8px 0 20px 0"');
    case 'Spacer': {
      const h = num(p.height, 24, 4, 200);
      return row('&nbsp;', ` height="${h}" style="height:${h}px;line-height:${h}px;font-size:${h}px"`);
    }
    case 'FormField':
      return row(`<div style="${font}font-size:16px;line-height:1.55;color:${root.textColor}">${ctx.field(String(p.field || 'all'), p.showLabel !== false)}</div>`, ' style="padding:0 0 12px 0"');
    case 'Payment': {
      if (!ctx.payment) return '';
      const heading = p.heading ? `<p style="margin:0 0 8px 0;font-weight:700">${ctx.merge(esc(p.heading), true)}</p>` : '';
      return row(`<div style="${font}font-size:16px;line-height:1.55;color:${root.textColor}">${heading}${paymentTable(ctx.payment, { items: p.showItems !== false, details: p.showDetails !== false })}</div>`, ' style="padding:0 0 12px 0"');
    }
    case 'Events': {
      const list = ctx.events?.[p.id] ?? [];
      const heading = p.heading ? `<h3 style="margin:0 0 12px 0;${font}font-size:20px;line-height:1.25;font-weight:700;color:${root.textColor}">${ctx.merge(esc(p.heading), true)}</h3>` : '';
      if (!list.length) return p.empty ? row(`${heading}<p style="margin:0;${font}font-size:15px;color:#64748b">${ctx.merge(esc(p.empty), true)}</p>`, ' style="padding:0 0 16px 0"') : '';
      return row(heading + list.map((ev, i) => eventRow(ev, p, root, i === 0, i === list.length - 1)).join(''), ' style="padding:0 0 16px 0"');
    }
    case 'Section': {
      const bg = color(p.background, 'transparent');
      const pad = num(p.padding, 24, 0, 80);
      const inner = (p.content ?? []).map((c: EmailItem) => renderBlock(c, ctx, rootIn)).join('');
      return row(inner, `${bg !== 'transparent' ? ` bgcolor="${bg}"` : ''} style="padding:${pad}px;background:${bg};border-radius:${num(p.radius, 0, 0, 24)}px"`) + row('&nbsp;', ' height="12" style="height:12px;line-height:12px;font-size:12px"');
    }
    case 'Columns': {
      const gap = num(p.gap, 24, 0, 60);
      const cols = [p.left, p.right].map((list: EmailItem[] | undefined) => (list ?? []).map((c) => renderBlock(c, ctx, rootIn)).join(''));
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cols
        .map((c, i) => `<td class="email-col" width="50%" valign="top" style="width:50%;vertical-align:top;${i === 0 ? `padding-right:${gap / 2}px` : `padding-left:${gap / 2}px`}">${c}</td>`)
        .join('')}</tr></table>`;
    }
  }
  return '';
}

const stripEmpty = (o: EmailRoot) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== '' && v !== undefined && v !== null)) as EmailRoot;

/** The blocks of a document, without the page around them (the builder's canvas). */
export const renderEmailBody = (doc: EmailDoc, ctx: EmailContext) => (doc.content ?? []).map((item) => renderBlock(item, ctx, doc.root?.props ?? {})).join('');

/** A whole email: the document, its 600px body and preheader. */
export function renderEmail(doc: EmailDoc, ctx: EmailContext, title = ''): string {
  const root = { ...EMAIL_DEFAULTS, ...stripEmpty(doc.root?.props ?? {}) };
  const width = num(root.width, 600, 320, 800);
  const preheader = doc.root?.props?.preheader ? ctx.merge(esc(doc.root.props.preheader), true) : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><title>${esc(title)}</title>
<style>@media (max-width:${width + 20}px){.email-wrap{width:100% !important}.email-col{display:block !important;width:100% !important;padding:0 !important}}</style></head>
<body style="margin:0;padding:0;background:${color(root.background, EMAIL_DEFAULTS.background)}">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>` : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${color(root.background, EMAIL_DEFAULTS.background)}" style="background:${color(root.background, EMAIL_DEFAULTS.background)}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" class="email-wrap" width="${width}" cellpadding="0" cellspacing="0" border="0" bgcolor="${color(root.contentBackground, '#ffffff')}" style="width:${width}px;max-width:${width}px;background:${color(root.contentBackground, '#ffffff')}"><tr><td style="padding:32px;font-family:${root.fontFamily};color:${color(root.textColor, EMAIL_DEFAULTS.textColor)};font-size:16px;line-height:1.55">
${renderEmailBody(doc, ctx)}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

const newId = (type: string) => `${type}-${Math.random().toString(36).slice(2, 10)}`;

/** A new notification's email: a heading and every answer. */
export const defaultEmail = (): EmailDoc => ({
  root: { props: {} },
  content: [
    { type: 'Heading', props: { id: newId('Heading'), text: 'New submission: {form_title}', level: 2 } },
    { type: 'FormField', props: { id: newId('FormField'), field: 'all', showLabel: true } },
  ],
});

/**
 * An older notification's message as a document: {all_fields} alone becomes the Form field block; any
 * other message a Text block (plain-text messages as paragraphs), with {all_fields} where it was.
 */
export function emailFromMessage(message: string): EmailDoc {
  const m = (message ?? '').trim();
  if (!m || m === '{all_fields}') return { root: { props: {} }, content: [{ type: 'FormField', props: { id: newId('FormField'), field: 'all', showLabel: true } }] };
  const html = /<(p|br|div|ul|ol|li|strong|b|em|i|a|h[1-6])\b/i.test(m)
    ? m
    : m
        .split(/\n{2,}/)
        .map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`)
        .join('');
  return { root: { props: {} }, content: [{ type: 'Text', props: { id: newId('Text'), html } }] };
}

/** The plain-text version of an HTML message (links keep their address). */
export function textVersion(html: string): string {
  return html
    .replace(/<\s*(style|script)[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      const t = text.replace(/<[^>]+>/g, '').trim();
      return t && t !== href ? `${t} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|table)>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
