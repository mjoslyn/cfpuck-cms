// iCalendar feeds: /events.ics (upcoming, or ?past=1, ?month=Y-m, ?q=) and /event/<slug>/event.ics.
import type { Loader } from '../data';
import { permalink } from '../permalink';
import { mediaUrl } from '../media/image';
import { decodeEntities } from '../text/entities';
import { type CalEvent, SITE_TZ, addDays, hasEnded, loadCalEvents, matchesSearch } from './model';
import { vtimezone } from './timezone';

const text = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const wall = (s: string) => s.replace(/[-:]/g, '').replace(' ', 'T');
/** The zone an event's wall-clock times are in: its own, else the site's. */
const zoneOf = (ev: CalEvent) => ev.entry.fields?.timezone || SITE_TZ;
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** Lines longer than 75 octets are folded (RFC 5545), between whole characters (never inside an emoji). */
function fold(line: string) {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 75) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

function vevent(ev: CalEvent, origin: string, host: string): string[] {
  const e = ev.entry;
  const lines = ['BEGIN:VEVENT', `UID:${ev.key}@${host}`, `DTSTAMP:${utc(new Date().toISOString())}`];
  if (ev.allDay) lines.push(`DTSTART;VALUE=DATE:${ev.startDay.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(ev.endDay, 1).replace(/-/g, '')}`);
  else lines.push(`DTSTART;TZID=${zoneOf(ev)}:${wall(ev.start)}`, `DTEND;TZID=${zoneOf(ev)}:${wall(ev.end)}`);
  lines.push(`CREATED:${utc(e.published_at)}`, `LAST-MODIFIED:${utc(e.updated_at)}`, `SUMMARY:${text(e.title)}`);
  if (ev.text) lines.push(`DESCRIPTION:${text(ev.text)}`);
  lines.push(`URL:${origin}${permalink(e)}`);
  if (ev.venue) {
    const f = ev.venue.fields ?? {};
    lines.push(`LOCATION:${text([ev.venue.title, f.address, f.city, f.state, f.zip].filter(Boolean).join(', '))}`);
  }
  if (ev.categories.length) lines.push(`CATEGORIES:${ev.categories.map((c) => text(c.name)).join(',')}`);
  if (ev.media) lines.push(`ATTACH;FMTTYPE=${ev.media.mime_type}:${origin}${mediaUrl(ev.media.path)}`);
  lines.push('END:VEVENT');
  return lines;
}

export function calendarFile(events: CalEvent[], opts: { origin: string; name: string }): string {
  const host = new URL(opts.origin).hostname;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${opts.name}//Events//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${text(opts.name)}`, `X-WR-TIMEZONE:${SITE_TZ}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  // A VTIMEZONE for each zone the timed events use (the site's, and any event's own).
  const zones = new Map<string, number[]>();
  for (const ev of events.filter((x) => !x.allDay)) zones.set(zoneOf(ev), [...(zones.get(zoneOf(ev)) ?? []), Number(ev.startDay.slice(0, 4)), Number(ev.endDay.slice(0, 4))]);
  for (const [tz, years] of zones) lines.push(...vtimezone(tz, years));
  for (const ev of events) lines.push(...vevent(ev, opts.origin, host));
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function icsResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'X-Robots-Tag': 'noindex', 'Cache-Control': 'public, max-age=0, must-revalidate' },
  });
}

/** The feed for a listing: upcoming (default), past, or one month; optionally searched. */
export async function eventsFeed(loader: Loader, params: { q?: string; month?: string; past?: boolean }, origin: string): Promise<Response> {
  const now = new Date();
  let events = (await loadCalEvents(loader)).filter((ev) => matchesSearch(ev, params.q ?? ''));
  if (params.month && /^\d{4}-\d{2}$/.test(params.month)) events = events.filter((ev) => ev.startDay.slice(0, 7) <= params.month! && ev.endDay.slice(0, 7) >= params.month!);
  else if (params.past) events = events.filter((ev) => hasEnded(ev.entry, ev.end, now)).reverse();
  else events = events.filter((ev) => !hasEnded(ev.entry, ev.end, now));
  const site = (await loader.settings()).site?.name ?? 'Events';
  return icsResponse(calendarFile(events, { origin, name: site }), 'events.ics');
}

/** One event (or one occurrence of a recurring event). */
export async function eventFile(loader: Loader, entryId: number, occurrence: string | undefined, origin: string): Promise<Response | null> {
  const ev = (await loadCalEvents(loader)).find((x) => (x.entry.series_id ?? x.entry.id) === entryId && (!occurrence || x.entry.occurrence === occurrence));
  if (!ev) return null;
  const site = (await loader.settings()).site?.name ?? 'Events';
  return icsResponse(calendarFile([ev], { origin, name: site }), `${ev.entry.slug}.ics`);
}
