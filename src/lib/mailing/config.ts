// Mailing (an optional feature, on under Settings > Mailing Lists): mailing lists people sign up to, campaigns
// and weekly digests sent to them through Mailgun, separate from the site's transactional mail (form
// notifications and tickets go over SMTP as before). The settings, the site's addresses for signing up
// and managing a subscription, and the shapes the screens share. Safe in the browser; the tables are in
// db/migrations and the functions in src/lib/db/functions.ts.
import { fieldKey } from './segments';

/** settings.site.mailing. */
export interface MailingSettings {
  enabled?: boolean;
  /** The sender's name ("Example Town"); the address is fromLocal@MAILGUN_DOMAIN, the marketing domain. */
  fromName?: string;
  /** The local part of the sender's address on the marketing domain (default "news"). */
  fromLocal?: string;
  replyTo?: string;
  /** The organisation's postal address, required in every email (CAN-SPAM). */
  address?: string;
  /** What a Subscribe block shows above its button unless it has its own. */
  consentText?: string;
  /** Lists offered at member sign-up (and on the member's account page): ids. */
  memberLists?: number[];
  /** Link tracking on new campaigns (each can change it). */
  trackLinks?: boolean;
  /** UTM parameters on links to the site, on new campaigns. */
  utm?: boolean;
  /** Pause sending when a campaign's complaint rate (%) or bounce rate (%) passes these, once it has 500 delivered. */
  complaintRate?: number;
  bounceRate?: number;
  /** Contacts' own fields (kept in contacts.attributes under their keys). */
  fields?: ContactField[];
}

export type ContactFieldType = 'text' | 'number' | 'date' | 'choice';
export const FIELD_TYPES: [ContactFieldType, string][] = [
  ['text', 'Text'],
  ['number', 'Number'],
  ['date', 'Date'],
  ['choice', 'Choice'],
];

/** A field every contact can have (Settings > Mailing Lists): its key is also its merge tag, {key}. */
export interface ContactField {
  key: string;
  label: string;
  type: ContactFieldType;
  /** A choice field's options. */
  options?: string[];
}

/** Keys a field can't have: the built-in merge tags. */
export const RESERVED_FIELD_KEYS = ['email', 'first_name', 'last_name', 'name', 'site_name', 'unsubscribe_url', 'preferences_url', 'week_of'];

/** Fields as stored: known types, keys that start with a letter and aren't reserved or repeated (at most 30). */
export function cleanFields(v: unknown): ContactField[] {
  const seen = new Set<string>();
  return (Array.isArray(v) ? v : []).flatMap((f: any) => {
    const label = String(f?.label ?? '').trim().slice(0, 60);
    const key = fieldKey(f?.key || label);
    if (!label || !/^[a-z]/.test(key) || RESERVED_FIELD_KEYS.includes(key) || seen.has(key)) return [];
    seen.add(key);
    const type = FIELD_TYPES.some(([t]) => t === f.type) ? (f.type as ContactFieldType) : 'text';
    const options = type === 'choice' ? [...new Set((Array.isArray(f.options) ? f.options : String(f.options ?? '').split(',')).map((o: unknown) => String(o).trim().slice(0, 60)).filter(Boolean))].slice(0, 50) as string[] : undefined;
    return [{ key, label, type, ...(options ? { options } : {}) }];
  }).slice(0, 30);
}

/** A value for a field, as stored ('' when it isn't one: not a number, not a date, not an option). */
export function fieldValue(f: ContactField, v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (f.type === 'number') return Number.isFinite(Number(s)) ? String(Number(s)) : '';
  if (f.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s) ? s : '';
  if (f.type === 'choice') return f.options?.find((o) => o.toLowerCase() === s.toLowerCase()) ?? '';
  return s.slice(0, 500);
}

/** A whole name split at its first space: "Ann Marie Smith" is Ann and Marie Smith. */
export function splitName(full: unknown): { first_name: string; last_name: string } {
  const t = String(full ?? '').trim().replace(/\s+/g, ' ');
  const i = t.indexOf(' ');
  return i < 0 ? { first_name: t.slice(0, 100), last_name: '' } : { first_name: t.slice(0, i).slice(0, 100), last_name: t.slice(i + 1).slice(0, 100) };
}

/** First and last name from what a form or import gives: the two parts, else a whole name split. */
export function nameParts(v: { first_name?: unknown; last_name?: unknown; name?: unknown }): { first_name: string; last_name: string } {
  const first = String(v.first_name ?? '').trim().slice(0, 100);
  const last = String(v.last_name ?? '').trim().slice(0, 100);
  return first || last ? { first_name: first, last_name: last } : splitName(v.name);
}

export const CONSENT_TEXT = 'I agree to receive email from us. I can unsubscribe at any time.';
/** The built-in pages: signing up, unsubscribing and managing a subscription. A page with the address takes its place. */
export const SUBSCRIBE_PATH = '/subscribe/';
export const UNSUBSCRIBE_PATH = '/unsubscribe/';
export const PREFERENCES_PATH = '/email-preferences/';
export const MAILING_PATHS = [SUBSCRIBE_PATH, UNSUBSCRIBE_PATH, PREFERENCES_PATH];

/** Health thresholds (percent) and the deliveries a campaign needs before they apply. */
export const HEALTH = { complaintRate: 0.1, bounceRate: 2, minDelivered: 500, minComplaints: 2, minBounces: 10 };

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pct = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : fallback;
};

/** The mailing settings as stored, cleaned up. */
export function mailingSettings(site: Record<string, any> | null | undefined): MailingSettings {
  const m = site?.mailing ?? {};
  return {
    enabled: m.enabled === true,
    fromName: str(m.fromName, 100) || undefined,
    fromLocal: /^[a-z0-9._+-]{1,64}$/i.test(str(m.fromLocal, 64)) ? str(m.fromLocal, 64).toLowerCase() : undefined,
    replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(m.replyTo, 254)) ? str(m.replyTo, 254) : undefined,
    address: str(m.address, 500) || undefined,
    consentText: str(m.consentText, 1000) || undefined,
    memberLists: Array.isArray(m.memberLists) ? [...new Set(m.memberLists.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))] as number[] : [],
    trackLinks: m.trackLinks !== false,
    utm: m.utm === true,
    complaintRate: pct(m.complaintRate, HEALTH.complaintRate),
    bounceRate: pct(m.bounceRate, HEALTH.bounceRate),
    fields: cleanFields(m.fields),
  };
}

/** What the settings API stores (undefined: nothing set). */
export function mailingSettingsFrom(v: unknown): MailingSettings | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const s = mailingSettings({ mailing: v });
  const set = Object.fromEntries(Object.entries(s).filter(([k, x]) => x !== undefined && !(Array.isArray(x) && !x.length) && !(k === 'trackLinks' && x === true) && !(k === 'utm' && x === false) && !(k === 'complaintRate' && x === HEALTH.complaintRate) && !(k === 'bounceRate' && x === HEALTH.bounceRate) && !(k === 'enabled' && x === false)));
  return Object.keys(set).length ? (set as MailingSettings) : undefined;
}

/** Whether mailing is on. */
export const mailingOn = (site: Record<string, any> | null | undefined) => site?.mailing?.enabled === true;

/** A mailing list (table mail_lists). */
export interface MailList {
  id: number;
  name: string;
  description: string;
  public: boolean;
  sort: number;
}

export type ContactStatus = 'pending' | 'subscribed' | 'unsubscribed' | 'bounced' | 'complained';
export const CONTACT_STATUS: Record<ContactStatus, string> = {
  pending: 'Waiting for confirmation',
  subscribed: 'Subscribed',
  unsubscribed: 'Unsubscribed',
  bounced: 'Bounced',
  complained: 'Marked as spam',
};

/** A contact (table contacts). */
export interface Contact {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  /** First and last joined (made by the database). */
  name: string;
  attributes: Record<string, unknown>;
  status: ContactStatus;
  /** Lowercased, for segments (src/lib/mailing/segments.ts). */
  tags: string[];
  consent_source: string;
  consent_text: string;
  consent_at: string | null;
  consent_ip: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  notes: string;
  created_at: string;
}

/** Who a campaign or digest goes to besides its lists: everyone, only members (of some levels), or only non-members. */
export interface Audience {
  members?: 'any' | 'members' | 'non-members';
  levels?: string[];
}

export function audienceOf(v: unknown): Required<Audience> {
  const a = (v ?? {}) as Audience;
  return {
    members: a.members === 'members' || a.members === 'non-members' ? a.members : 'any',
    levels: Array.isArray(a.levels) ? a.levels.filter((l): l is string => typeof l === 'string' && !!l) : [],
  };
}

export type CampaignStatus = 'draft' | 'review' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'cancelled' | 'failed' | 'skipped';
export const CAMPAIGN_STATUS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  review: 'Waiting for approval',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  paused: 'Paused',
  cancelled: 'Cancelled',
  failed: 'Failed',
  skipped: 'Skipped (nothing new)',
};

/** A campaign (table campaigns). */
export interface Campaign {
  id: number;
  name: string;
  subject: string;
  from_name: string;
  reply_to: string;
  design: any;
  text: string;
  list_ids: number[];
  audience: Audience;
  /** Only the people on its lists who match this segment (none: everyone on them). */
  segment_id: number | null;
  status: CampaignStatus;
  scheduled_at: string | null;
  started_at: string | null;
  sent_at: string | null;
  digest_id: number | null;
  issue_key: string | null;
  since: string | null;
  track_links: boolean;
  utm: boolean;
  html: string | null;
  text_rendered: string | null;
  vars: any;
  recipients: number;
  error: string;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A weekly digest (table digests). */
export interface Digest {
  id: number;
  name: string;
  list_ids: number[];
  audience: Audience;
  segment_id: number | null;
  weekday: number;
  send_time: string;
  subject: string;
  from_name: string;
  reply_to: string;
  design: any;
  text: string;
  mode: 'auto' | 'review';
  review_hours: number;
  skip_when_empty: boolean;
  min_items: number;
  track_links: boolean;
  utm: boolean;
  enabled: boolean;
  last_run_key: string | null;
  last_run_at: string | null;
  updated_at: string;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Campaign numbers (campaign_stats in the database). */
export interface CampaignStats {
  recipients: number;
  queued: number;
  dropped: number;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  opened: number;
  clicked: number;
  confirmed: number;
  machine: number;
}

/** A rate as a percentage with one decimal ("1.5%"), or an en dash with nothing to divide by. */
export const rate = (n: number, of: number) => (of > 0 ? `${(Math.round((n / of) * 1000) / 10).toLocaleString('en-US')}%` : '–');

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase().slice(0, 254) : '');
