// Recurring events: each occurrence is its own dated event at /event/<slug>/<Y-m-d>/. The rule lives in the event's
// fields (`recurrence`); occurrences are generated on wall-clock dates in the event's timezone.
import type { Entry } from './types';
import { SITE_TZ } from './site';

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Every N days/weeks/months/years. */
  interval?: number;
  /** Weekly: days of the week, 0 = Sunday. Defaults to the first occurrence's weekday. */
  byweekday?: number[];
  /** Monthly: same date each month, or the same weekday position ("2nd Tuesday", "last Friday"). */
  monthlyBy?: 'date' | 'weekday';
  /** Last date an occurrence may start on (Y-m-d). */
  until?: string;
  /** Total number of occurrences, including the first. */
  count?: number;
  /** Dates (Y-m-d) to skip. */
  exclude?: string[];
  /** Extra dates (Y-m-d) to add, at the usual time. */
  include?: string[];
}

export const RECURRENCE_KEY = 'recurrence';
// The newest occurrences up to the horizon are kept: a daily series has two years ahead (the default
// horizon) and about a year behind.
const MAX_OCCURRENCES = 1100;

export function recurrenceOf(e: Pick<Entry, 'type' | 'fields'>): Recurrence | null {
  const r = e.type === 'event' ? e.fields?.[RECURRENCE_KEY] : null;
  return r && typeof r === 'object' && r.freq ? (r as Recurrence) : null;
}

// Calendar math on Y-m-d strings, via UTC dates (no timezone involved).
const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** The nth (1-5, 5 = last) weekday of a month, or null. */
function nthWeekday(y: number, m: number, weekday: number, n: number): Date | null {
  if (n === 5) {
    const last = new Date(Date.UTC(y, m, daysInMonth(y, m)));
    return addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
  }
  const first = new Date(Date.UTC(y, m, 1));
  const d = addDays(first, ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
  return d.getUTCMonth() === m ? d : null;
}

/** Start dates (Y-m-d) of every occurrence, first occurrence included, up to `horizon`. */
export function occurrenceDates(firstDate: string, rule: Recurrence, horizon: string): string[] {
  const interval = Math.max(1, Math.floor(rule.interval ?? 1));
  const last = rule.until && rule.until < horizon ? rule.until : horizon;
  const limit = rule.count ?? Infinity;
  const start = toDate(firstDate);
  const out: string[] = [];
  let made = 0;
  const push = (d: Date | null) => {
    if (!d) return true;
    const s = ymd(d);
    if (s < firstDate) return true;
    if (s > last || made >= limit) return false;
    made++;
    out.push(s);
    if (out.length > MAX_OCCURRENCES) out.shift();
    return true;
  };

  if (rule.freq === 'daily') {
    for (let d = start; push(d); d = addDays(d, interval));
  } else if (rule.freq === 'weekly') {
    const days = [...new Set(rule.byweekday?.length ? rule.byweekday : [start.getUTCDay()])].sort();
    const weekStart = addDays(start, -start.getUTCDay());
    // The series' own date is always its first occurrence, even on a weekday the rule leaves out.
    if (!days.includes(start.getUTCDay())) push(start);
    outer: for (let w = weekStart; ; w = addDays(w, 7 * interval)) {
      for (const wd of days) if (!push(addDays(w, wd))) break outer;
      if (ymd(w) > last) break;
    }
  } else if (rule.freq === 'monthly') {
    const y0 = start.getUTCFullYear(), m0 = start.getUTCMonth(), day = start.getUTCDate();
    const weekday = start.getUTCDay();
    // Position of the weekday in the month; a 5th occurrence means "last".
    const n = Math.min(Math.ceil(day / 7), 5);
    for (let k = 0; ; k += interval) {
      const y = y0 + Math.floor((m0 + k) / 12), m = (m0 + k) % 12;
      if (ymd(new Date(Date.UTC(y, m, 1))) > last) break;
      const d = rule.monthlyBy === 'weekday' ? nthWeekday(y, m, weekday, n) : day <= daysInMonth(y, m) ? new Date(Date.UTC(y, m, day)) : null;
      if (!push(d)) break;
    }
  } else if (rule.freq === 'yearly') {
    const y0 = start.getUTCFullYear(), m = start.getUTCMonth(), day = start.getUTCDate();
    for (let y = y0; ; y += interval) {
      if (`${y}` > last.slice(0, 4)) break;
      if (!push(day <= daysInMonth(y, m) ? new Date(Date.UTC(y, m, day)) : null)) break;
    }
  }

  const exclude = new Set(rule.exclude ?? []);
  const extra = (rule.include ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= firstDate);
  return [...new Set([...out, ...extra])].filter((d) => !exclude.has(d)).sort();
}

// One formatter per timezone: making one is slow, and a series needs four conversions an occurrence.
const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (tz: string) =>
  formatters.get(tz) ?? formatters.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })).get(tz)!;

/** Wall-clock "Y-m-d H:i:s" in `tz` -> UTC ISO string. */
export function localToUtc(local: string, tz: string): string {
  const guess = new Date(`${local.replace(' ', 'T')}Z`);
  const offset = (d: Date) => {
    const p = Object.fromEntries(
      formatterFor(tz)
        .formatToParts(d)
        .map((x) => [x.type, x.value]),
    );
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime()) / 60000;
  };
  // Two passes settle the offset across DST boundaries.
  let t = guess.getTime() - offset(guess) * 60000;
  t = guess.getTime() - offset(new Date(t)) * 60000;
  return new Date(t).toISOString();
}

const shiftLocal = (local: string, ms: number) => new Date(new Date(`${local.replace(' ', 'T')}Z`).getTime() + ms).toISOString().slice(0, 19).replace('T', ' ');

export interface Occurrence extends Entry {
  /** Y-m-d of this occurrence; its permalink is /event/<slug>/<occurrence>/. */
  occurrence: string;
  /** The series' own entry id. */
  series_id: number;
}

/**
 * Occurrences of a recurring event as dated copies of the entry (virtual ids, per-occurrence
 * event_start/event_end and start/end fields). Non-recurring events are returned unchanged.
 */
export function expandEntry(e: Entry, horizon: string): Entry[] {
  const rule = recurrenceOf(e);
  const start = String(e.fields?.start ?? '');
  if (!rule || !/^\d{4}-\d{2}-\d{2}/.test(start)) return [e];
  const end = String(e.fields?.end ?? start);
  const duration = new Date(`${end.replace(' ', 'T')}Z`).getTime() - new Date(`${start.replace(' ', 'T')}Z`).getTime();
  const tz = e.fields?.timezone || SITE_TZ;
  const time = start.slice(10);
  return occurrenceDates(start.slice(0, 10), rule, horizon).map((date, i): Occurrence => {
    const s = `${date}${time}`;
    const en = shiftLocal(s, duration);
    const startUtc = localToUtc(s, tz);
    const endUtc = localToUtc(en, tz);
    return {
      ...e,
      id: -(e.id * 10000 + i + 1),
      occurrence: date,
      series_id: e.id,
      event_start: startUtc,
      event_end: endUtc,
      fields: { ...e.fields, start: s, end: en },
    };
  });
}

/** Default horizon for open-ended series: two years from `now`. */
export const defaultHorizon = (now = new Date()) => `${now.getUTCFullYear() + 2}${now.toISOString().slice(4, 10)}`;
