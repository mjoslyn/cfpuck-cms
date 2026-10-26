// Events as the calendar sees them: local start/end in the site timezone, all-day and multi-day
// flags, venue, image, categories and searchable text. Recurring series arrive already expanded
// into occurrences (Loader.query).
import type { Loader } from '../data';
import type { Entry, Media, Term } from '../types';

import { SITE_TZ } from '../site';
import { taxonomiesOf } from '../site';

/** The event type's taxonomies (its categories), from the site config. */
const EVENT_TAXONOMIES = taxonomiesOf('event');
export { SITE_TZ };

export interface CalEvent {
  entry: Entry;
  /** Unique per occurrence. */
  key: string;
  /** Local wall-clock "Y-m-d H:i:s". */
  start: string;
  end: string;
  startDay: string;
  /** Last day the event shows on ("Y-m-d"); an end at midnight doesn't count as a day. */
  endDay: string;
  allDay: boolean;
  multiday: boolean;
  featured: boolean;
  venue?: Entry;
  media?: Media;
  categories: Term[];
  /** Plain text of the description, for search and excerpts. */
  text: string;
}

const truthy = (v: unknown) => v === true || v === '1' || v === 'yes';
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Local start/end of an event entry (the fields kept in sync with event_start/end). */
export function eventTimes(e: Entry): { start: string; end: string; allDay: boolean } {
  const f = e.fields ?? {};
  const start = String(f.start ?? '');
  const end = String(f.end ?? start);
  return { start, end, allDay: truthy(f.all_day) || e.event_all_day === true };
}

export const venueIdOf = (e: Entry) => Number(e.fields?.venue) || 0;

const stripHtml = (s: string) =>
  s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[^>]*?>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function toCalEvent(e: Entry, venues: Map<number, Entry>, media: Map<number, Media>, terms: Map<number, Term>, text = ''): CalEvent | null {
  const { start, end, allDay } = eventTimes(e);
  if (!/^\d{4}-\d{2}-\d{2}/.test(start)) return null;
  const startDay = start.slice(0, 10);
  let endDay = end.slice(0, 10);
  if (endDay > startDay && end.slice(11) === '00:00:00') endDay = addDays(endDay, -1);
  return {
    entry: e,
    key: e.occurrence ? `${e.series_id}-${e.occurrence}` : String(e.id),
    start,
    end,
    startDay,
    endDay,
    allDay,
    multiday: startDay !== endDay,
    featured: truthy(e.fields?.featured),
    venue: venues.get(venueIdOf(e)),
    media: e.featured_media_id ? media.get(e.featured_media_id) : undefined,
    categories: (e.term_ids ?? []).map((id) => terms.get(id)!).filter((t) => !!t && EVENT_TAXONOMIES.includes(t.taxonomy)),
    text,
  };
}

/** Every published event (occurrences of recurring ones included), ordered by start. */
export async function loadCalEvents(loader: Loader): Promise<CalEvent[]> {
  const result = await loader.query({ postType: 'event', perPage: 10000, orderBy: 'event_start', order: 'asc' });
  const entries = result.ids.map((id) => loader.entries.get(id)!).filter(Boolean);
  const venueIds = [...new Set(entries.map(venueIdOf).filter(Boolean))];
  const venues = new Map((await loader.entriesByIds(venueIds)).map((v) => [v.id, v]));
  await loader.loadMedia(entries.map((e) => e.featured_media_id!).filter(Boolean));
  await loader.allTerms();
  const { data, error } = await loader.db.from('entries').select('id, body_text').in('id', [...new Set(entries.map((e) => e.series_id ?? e.id))]);
  if (error) throw error;
  const text = new Map((data ?? []).map((r) => [r.id, String(r.body_text ?? '')]));
  return entries
    .map((e) => toCalEvent(e, venues, loader.media, loader.terms, text.get(e.series_id ?? e.id) ?? ''))
    .filter((x): x is CalEvent => !!x)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.key < b.key ? -1 : 1));
}

/** Every word of the search appears in the title, excerpt or description. */
export function matchesSearch(ev: CalEvent, q: string): boolean {
  if (!q.trim()) return true;
  const hay = `${ev.entry.title} ${ev.entry.excerpt} ${ev.text}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** Short description: the excerpt, or the start of the description. */
export function excerptOf(ev: CalEvent, words = 30): string {
  const source = ev.entry.excerpt ? stripHtml(ev.entry.excerpt) : ev.text;
  const list = source.split(' ').filter(Boolean);
  return list.length > words ? `${list.slice(0, words).join(' ')}…` : list.join(' ');
}

// One formatter per timezone: making one is slow, and the calendar asks once per event.
const clocks = new Map<string, Intl.DateTimeFormat>();
const clockFor = (tz: string) =>
  clocks.get(tz) ??
  clocks.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })).get(tz)!;

/** Current wall-clock "Y-m-d H:i:s" in a timezone. */
export function nowIn(tz: string, now = new Date()): string {
  const p = Object.fromEntries(
    clockFor(tz)
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Current wall-clock "Y-m-d H:i:s" in the site timezone. */
export const siteNow = (now = new Date()): string => nowIn(SITE_TZ, now);

/** Whether an event has ended: its local end against the time now in its own timezone (else the site's). */
export const hasEnded = (e: Entry, end: string, now = new Date()): boolean => end < nowIn(e.fields?.timezone || SITE_TZ, now);

export { addDays };

const dayText = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
const timeText = (s: string) => {
  const [h, m] = s.slice(11, 16).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

/** An event's local start and end written out, as emails show them: "Saturday, October 24, 2026" and " at 7:00 pm" (or ""). */
export function eventWhen(start: string, end: string, allDay: boolean): { date: string; time: string } {
  const long = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } as const;
  const valid = /^\d{4}-\d{2}-\d{2}/.test(start);
  const sameDay = start.slice(0, 10) === end.slice(0, 10);
  const date = !valid ? 'Date to be announced' : sameDay ? dayText(start, long) : `${dayText(start, { month: 'long', day: 'numeric' })} – ${dayText(end, long)}`;
  return { date, time: valid && !allDay ? ` at ${timeText(start)}` : '' };
}

/** A venue's name, street and town, as lines. */
export function venueLines(venue?: Entry): string[] {
  if (!venue) return [];
  const f = venue.fields ?? {};
  return [venue.title, f.address, [f.city, [f.state, f.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean);
}
