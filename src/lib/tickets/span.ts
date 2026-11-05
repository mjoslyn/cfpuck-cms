// When a ticket sells for: from the events attached to it (src/lib/tickets/setup.ts). One event (one date
// of a recurring one, which sells per date) gives its own dates; several share one pool, from the first
// event's start to the last one's end. Safe in the browser (the render code runs in the editor too).
import type { Entry } from '../types';
import { defaultHorizon, expandEntry, localToUtc, recurrenceOf } from '../recurrence';
import { eventTimes } from '../events/model';
import { SITE_TZ } from '../site';

export interface TicketSpan {
  /** The one event (or date) the ticket is for; null with several events, or none. */
  entry: Entry | null;
  occurrence: string;
  /** The first date's timezone and local times ("Y-m-d H:i:s"). */
  tz: string;
  start: string;
  end: string;
  allDay: boolean;
  startUtc: number | null;
  /** When the last date ends (sales close). */
  endUtc: number | null;
}

const tzOf = (e: Entry) => e.fields?.timezone || SITE_TZ;

function utcOf(e: Entry) {
  const tz = tzOf(e);
  const { start, end, allDay } = eventTimes(e);
  const utc = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? Date.parse(localToUtc(s.length === 10 ? `${s} 00:00:00` : s, tz)) : null);
  // An all-day event lasts to the end of its last day.
  const endUtc = allDay && /^\d{4}-\d{2}-\d{2}/.test(end) ? utc(`${end.slice(0, 10)} 23:59:59`) : utc(end);
  return { tz, start, end, allDay, startUtc: utc(start), endUtc };
}

const spanOf = (entry: Entry | null, occurrence: string, first: Entry, last: number | null): TicketSpan => {
  const f = utcOf(first);
  return { entry, occurrence, tz: f.tz, start: f.start, end: f.end, allDay: f.allDay, startUtc: f.startUtc, endUtc: last ?? f.endUtc };
};

/** A recurring event's dates (a year past the usual horizon, so orders for late dates still find theirs). */
const datesOf = (e: Entry) => expandEntry(e, defaultHorizon(new Date(Date.now() + 366 * 86400000)));

/**
 * A ticket's dates from its events (series, as stored). With one recurring event, `occurrence` names the
 * date (required); otherwise it must be ''. Null when it doesn't fit.
 */
export function ticketSpan(events: Entry[], occurrence: string): TicketSpan | null {
  if (events.length === 1) {
    const e = events[0];
    if (recurrenceOf(e)) {
      const occ = occurrence ? datesOf(e).find((o) => o.occurrence === occurrence) : undefined;
      return occ ? spanOf(occ, occurrence, occ, null) : null;
    }
    return occurrence ? null : spanOf(e, '', e, null);
  }
  return occurrence ? null : poolSpan(events);
}

/** One pool for every date of every event: the first starts it, the last end closes it. */
export function poolSpan(events: Entry[]): TicketSpan {
  // Every date of every event: the first starts the span, the last end closes it.
  const dates = events.flatMap((e) => (recurrenceOf(e) ? datesOf(e) : [e])).map((e) => ({ e, ...utcOf(e) }));
  if (!dates.length) return { entry: null, occurrence: '', tz: SITE_TZ, start: '', end: '', allDay: false, startUtc: null, endUtc: null };
  const first = dates.reduce((a, b) => ((b.startUtc ?? Infinity) < (a.startUtc ?? Infinity) ? b : a));
  const ends = dates.map((d) => d.endUtc ?? d.startUtc).filter((n): n is number => n != null);
  return spanOf(null, '', first.e, ends.length ? Math.max(...ends) : null);
}

/** Whether a ticket's sales have closed: its last date has ended. */
export const spanEnded = (s: TicketSpan | null, now = Date.now()) => s?.endUtc != null && s.endUtc < now;

/** Whether a page is one of a ticket's events' own (a date of a recurring one included): #tickets there. */
export const onEventPage = (paths: string[], page: string) => paths.some((p) => page === p || (p !== '/' && page.startsWith(p)));
