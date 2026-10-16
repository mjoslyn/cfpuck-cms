// A campaign's email as Mailgun sends it: the email builder's design rendered by the same code as the
// site's other emails (src/lib/forms/email.ts), its merge tags turned into Mailgun's per-recipient
// variables (%recipient.<name>%), the footer every marketing email must carry (who it's from, the
// postal address, unsubscribe and preferences links) added under the design where it can't be removed,
// and, with link tracking on, each link sent through the site (/m/c/<link>/<recipient>) plus one hidden
// link only machines follow (src/lib/mailing/clicks.ts). Server only.
import { renderEmail, textVersion, type EmailContext, type EmailDoc, type EmailEvent } from '../forms/email';
import { PREFERENCES_PATH, UNSUBSCRIBE_PATH } from './config';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The merge tags a campaign offers: [tag, label]. A tag can carry a fallback for an empty value: {first_name|friend}. */
export const MAILING_TAGS: [string, string][] = [
  ['{first_name}', 'First name'],
  ['{last_name}', 'Last name'],
  ['{name}', 'Full name'],
  ['{email}', 'Email address'],
  ['{site_name}', 'Site name'],
  ['{unsubscribe_url}', 'Unsubscribe link'],
  ['{preferences_url}', 'Email preferences link'],
];

/** Per-recipient values a tag can stand for, besides the site's contact fields ({<key>}, `field:<key>`). */
export const RECIPIENT_FIELDS = ['first_name', 'last_name', 'name', 'email'] as const;
export type RecipientField = (typeof RECIPIENT_FIELDS)[number] | `field:${string}`;

/** A tag in use and the variable it became: `v<n>` plain (subject, text), `v<n>_h` HTML-escaped (the HTML). */
export interface VarSpec {
  name: string;
  field: RecipientField;
  fallback: string;
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
  vars: VarSpec[];
}

export interface RenderInput {
  campaignId: number;
  subject: string;
  design: EmailDoc;
  /** The editor's own plain text (empty: made from the HTML). */
  text?: string;
  siteName: string;
  /** The postal address. */
  address: string;
  origin: string;
  events?: Record<string, EmailEvent[]>;
  entries?: Record<string, EmailEvent[]>;
  /** The site's contact field keys: {<key>} is that field. */
  fields?: string[];
}

const TAG = /\{([a-z][a-z0-9_]*)(?:\|([^{}]*))?\}/g;

/** The email with its tags as Mailgun variables; links not yet tracked. */
export function renderCampaign(input: RenderInput): Rendered {
  const vars: VarSpec[] = [];
  const unsubscribe = `${input.origin}${UNSUBSCRIBE_PATH}?t=%recipient.t%&c=${input.campaignId}`;
  const preferences = `${input.origin}${PREFERENCES_PATH}?t=%recipient.t%`;
  const variable = (field: RecipientField, fallback: string) => {
    let v = vars.find((x) => x.field === field && x.fallback === fallback);
    if (!v) vars.push((v = { name: `v${vars.length + 1}`, field, fallback }));
    return v.name;
  };
  // In HTML a tag's value is escaped (the _h variable); in the subject and text it isn't.
  const merge = (text: string, html: boolean) =>
    text.replace(TAG, (whole, key: string, fallback?: string) => {
      if ((RECIPIENT_FIELDS as readonly string[]).includes(key)) return `%recipient.${variable(key as RecipientField, (fallback ?? '').trim())}${html ? '_h' : ''}%`;
      if (input.fields?.includes(key)) return `%recipient.${variable(`field:${key}`, (fallback ?? '').trim())}${html ? '_h' : ''}%`;
      if (key === 'site_name') return html ? esc(input.siteName) : input.siteName;
      if (key === 'unsubscribe_url') return unsubscribe;
      if (key === 'preferences_url') return preferences;
      return whole;
    });
  const ctx: EmailContext = {
    // Text blocks arrive escaped; a fallback typed in them is escaped too, and goes out as typed.
    merge: (text, html) => merge(html ? text.replace(/\{([a-z][a-z0-9_]*)\|([^{}]*)\}/g, (_, k, f) => `{${k}|${f.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")}}`) : text, html),
    field: (id) => `%recipient.${variable((RECIPIENT_FIELDS as readonly string[]).includes(id) ? (id as RecipientField) : id.startsWith('field:') && input.fields?.includes(id.slice(6)) ? (id as RecipientField) : 'name', '')}_h%`,
    origin: input.origin,
    events: input.events,
    entries: input.entries,
  };
  const footer =
    `<p style="margin:0 0 6px 0">You’re receiving this because you signed up for email from ${esc(input.siteName)}.</p>` +
    (input.address ? `<p style="margin:0 0 6px 0">${esc(input.siteName)} · ${esc(input.address).replace(/\n/g, ', ')}</p>` : '') +
    `<p style="margin:0"><a href="${unsubscribe}" style="color:#64748b;text-decoration:underline">Unsubscribe</a> · <a href="${preferences}" style="color:#64748b;text-decoration:underline">Email preferences</a></p>`;
  const subject = merge(input.subject, false);
  const html = renderEmail(input.design, ctx, subject.replace(/%recipient\.[a-z0-9_]+%/g, ''), footer);
  const own = (input.text ?? '').trim();
  const text = own
    ? `${merge(own, false)}\n\n--\nYou’re receiving this because you signed up for email from ${input.siteName}.${input.address ? `\n${input.siteName}, ${input.address.replace(/\n/g, ', ')}` : ''}\nUnsubscribe: ${unsubscribe}\nEmail preferences: ${preferences}\n`
    : plainText(html);
  return { subject, html, text, vars };
}

/** The text part made from the HTML: the preheader left out, and each escaped variable as its plain one. */
export function plainText(html: string): string {
  return textVersion(html.replace(/<div style="display:none[^"]*">[\s\S]*?<\/div>/, '')).replace(/%recipient\.([a-z0-9]+)_h%/g, '%recipient.$1%');
}

/** Who a variable is filled in for. */
export interface Recipient {
  email: string;
  first_name?: string;
  last_name?: string;
  attributes?: Record<string, unknown> | null;
}

/** One recipient's values for the variables, plain and escaped, with the signed tokens for their links. */
export function recipientValues(specs: VarSpec[], person: Recipient, tokens: { t: string; ct: string }): Record<string, string> {
  const first = (person.first_name ?? '').trim();
  const last = (person.last_name ?? '').trim();
  const value = (f: RecipientField) =>
    f === 'email' ? person.email : f === 'first_name' ? first : f === 'last_name' ? last : f === 'name' ? [first, last].filter(Boolean).join(' ') : String(person.attributes?.[f.slice(6)] ?? '').trim();
  const out: Record<string, string> = { t: tokens.t, ct: tokens.ct };
  for (const v of specs) {
    const plain = value(v.field) || v.fallback;
    out[v.name] = plain;
    out[`${v.name}_h`] = esc(plain);
  }
  return out;
}

/** A link in the email: its address and what it says (its text, or an image's alt). */
export interface FoundLink {
  url: string;
  label: string;
}

/** Links to track in the HTML, in order: web links, but not the unsubscribe and preferences links (anything with a variable in it). */
export function findLinks(html: string): FoundLink[] {
  const out: FoundLink[] = [];
  for (const m of html.matchAll(/<a\b([^>]*?)\bhref="(https?:\/\/[^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const url = m[2].replace(/&amp;/g, '&');
    if (url.includes('%recipient.')) continue;
    const inner = m[4];
    const text = inner.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const alt = inner.match(/\balt="([^"]*)"/i)?.[1] ?? '';
    out.push({ url, label: (text || (alt ? `Image: ${alt}` : 'Image')).replace(/&amp;/g, '&').slice(0, 200) });
  }
  return out;
}

/** UTM parameters on a link to the site itself (links that already carry their own keep them). */
export function withUtm(url: string, origin: string, campaign: string): string {
  try {
    const u = new URL(url);
    if (u.origin !== new URL(origin).origin || [...u.searchParams.keys()].some((k) => k.startsWith('utm_'))) return url;
    u.searchParams.set('utm_source', 'newsletter');
    u.searchParams.set('utm_medium', 'email');
    u.searchParams.set('utm_campaign', campaign);
    return u.toString();
  } catch {
    return url;
  }
}

/** The tracked address of a link for each recipient. */
export const trackedUrl = (origin: string, linkId: number) => `${origin}/m/c/${linkId}/%recipient.ct%`;

/** Each tracked link's address swapped for its tracked one, in the order findLinks found them (`ids`). */
export function trackLinks(html: string, origin: string, ids: number[]): string {
  let i = 0;
  return html.replace(/(<a\b[^>]*?\bhref=")(https?:\/\/[^"]+)(")/gi, (whole, a: string, url: string, b: string) => {
    if (url.includes('%recipient.')) return whole;
    const id = ids[i++];
    return id ? `${a}${trackedUrl(origin, id)}${b}` : whole;
  });
}

/** The hidden link only machines follow: no text, out of view, skipped by screen readers and keyboards (HTML part only). */
export function addHoneypot(html: string, origin: string, id: number): string {
  const trap = `<a href="${trackedUrl(origin, id)}" aria-hidden="true" tabindex="-1" style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all"></a>`;
  return html.replace(/<\/body>/i, `${trap}</body>`);
}

/** Links straight to their address with UTM parameters added (tracking off). */
export function utmLinks(html: string, origin: string, campaign: string): string {
  return html.replace(/(<a\b[^>]*?\bhref=")(https?:\/\/[^"]+)(")/gi, (whole, a: string, url: string, b: string) => (url.includes('%recipient.') ? whole : `${a}${withUtm(url.replace(/&amp;/g, '&'), origin, campaign).replace(/&/g, '&amp;')}${b}`));
}

/** The own plain text's links swapped too (each address the HTML tracked; others stay). */
export function trackText(text: string, links: { id: number; url: string; original: string }[], origin: string): string {
  const byUrl = new Map<string, number>();
  for (const l of links) {
    if (!byUrl.has(l.original)) byUrl.set(l.original, l.id);
    if (!byUrl.has(l.url)) byUrl.set(l.url, l.id);
  }
  return text.replace(/https?:\/\/[^\s<>()"]+/g, (url) => {
    const id = byUrl.get(url) ?? byUrl.get(url.replace(/[.,;:!?]+$/, ''));
    return id ? trackedUrl(origin, id) + url.slice(url.replace(/[.,;:!?]+$/, '').length) : url;
  });
}
