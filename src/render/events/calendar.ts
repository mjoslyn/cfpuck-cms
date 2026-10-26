// The events calendar: list (upcoming and past), month and day views, with search, date jumping and
// calendar subscription links. Server-rendered; navigation is plain links and GET forms.
//
// URLs: /events/ (upcoming, ?from=Y-m-d), /events/past/, /events/month/[Y-m/], /events/day/Y-m-d/,
// /events/today/; ?q= searches; /page/N/ pages lists. Old calendar URLs redirect (legacyCalendarUrl).
import { site, SITE_TZ } from '../../lib/site';
import { zoneLabel } from '../../lib/events/timezone';
import type { Loader } from '../../lib/data';
import { type CalEvent, addDays, excerptOf, hasEnded, loadCalEvents, matchesSearch, siteNow } from '../../lib/events/model';
import { permalink } from '../../lib/permalink';
import { mediaImage, mediaImgTag } from '../../lib/media/image';
import { entryTitle } from '../c/entry';

export type CalView = 'list' | 'past' | 'month' | 'day';

export interface CalRequest {
  view: CalView;
  page: number;
  /** list: first day to show; month: first of the month; day: the day. "Y-m-d" or "" for today. */
  date: string;
  q: string;
}

const PER_PAGE = 10;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** A real calendar day, "Y-m-d" (not 2026-02-31); anything else shows the default view. */
const isDay = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
/** A real month, "Y-m" (01 to 12). */
const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function parseCalendarUrl(url: URL): CalRequest {
  let path = url.pathname;
  let page = 1;
  const paged = path.match(/^(.*\/)page\/(\d+)\/?$/);
  if (paged) {
    path = paged[1];
    page = Math.max(1, parseInt(paged[2], 10));
  }
  const parts = path.split('/').filter(Boolean).slice(1);
  const q = (url.searchParams.get('q') ?? '').trim();
  const from = url.searchParams.get('from') ?? '';
  if (parts[0] === 'past') return { view: 'past', page, date: '', q };
  if (parts[0] === 'month') {
    const m = isMonth(parts[1] ?? '') ? parts[1] : (url.searchParams.get('month') ?? '').slice(0, 7);
    return { view: 'month', page: 1, date: isMonth(m) ? `${m}-01` : '', q };
  }
  if (parts[0] === 'today') return { view: 'day', page: 1, date: '', q };
  if (parts[0] === 'day') return { view: 'day', page: 1, date: isDay(parts[1] ?? '') ? parts[1] : isDay(from) ? from : '', q };
  return { view: 'list', page, date: isDay(from) ? from : '', q };
}

// Formatting -------------------------------------------------------------------------------

const asDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`);
const fmtDay = (d: string, o: Intl.DateTimeFormatOptions) => asDate(d).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
const fmtTime = (s: string) => {
  const [h, m] = s.slice(11, 16).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

/** "7:00 pm – 9:00 pm", "All day", or a span across days. */
export function whenText(ev: CalEvent, withDate = false): string {
  const day = (d: string) => fmtDay(d, { month: 'short', day: 'numeric' });
  if (ev.multiday) {
    const zone = ev.allDay ? '' : zoneLabel(ev.entry.fields?.timezone, ev.start, SITE_TZ);
    return ev.allDay ? `${day(ev.startDay)} – ${day(ev.endDay)}` : `${day(ev.startDay)} @ ${fmtTime(ev.start)} – ${day(ev.endDay)} @ ${fmtTime(ev.end)}${zone ? ` ${zone}` : ''}`;
  }
  const date = withDate ? `${fmtDay(ev.startDay, { weekday: 'long', month: 'long', day: 'numeric' })} · ` : '';
  if (ev.allDay) return `${date}All day`;
  const zone = zoneLabel(ev.entry.fields?.timezone, ev.start, SITE_TZ);
  return (ev.start === ev.end ? `${date}${fmtTime(ev.start)}` : `${date}${fmtTime(ev.start)} – ${fmtTime(ev.end)}`) + (zone ? ` ${zone}` : '');
}

function venueLine(ev: CalEvent): string {
  const v = ev.venue;
  if (!v) return '';
  const f = v.fields ?? {};
  const address = [f.address, f.city, f.state].filter(Boolean).join(', ');
  return `<p class="c-cal-event__venue"><span class="c-cal-event__venue-name">${entryTitle(v)}</span>${address ? ` <span class="c-cal-event__address">${esc(address)}</span>` : ''}</p>`;
}

// Links -------------------------------------------------------------------------------------

function href(path: string, q: string, extra: Record<string, string> = {}) {
  const sp = new URLSearchParams();
  if (q) sp.set('q', q);
  for (const [k, v] of Object.entries(extra)) if (v) sp.set(k, v);
  const s = sp.toString();
  return `${path}${s ? `?${s}` : ''}`;
}
const monthPath = (m: string) => `/events/month/${m}/`;
const dayPath = (d: string) => `/events/day/${d}/`;
const listPath = (page: number, past = false) => `/events/${past ? 'past/' : ''}${page > 1 ? `page/${page}/` : ''}`;

// Views ---------------------------------------------------------------------------------------

export interface Calendar {
  req: CalRequest;
  today: string;
  heading: string;
  /** For the document title. */
  title: string;
  prev?: { href: string; label: string };
  next?: { href: string; label: string };
  /** A month or day before the first event or after the last: shown, but not for search engines. */
  outside?: boolean;
  todayHref: string;
  todayLabel: string;
  body: string;
  notice?: string;
  events: CalEvent[];
}

export function eventCard(ev: CalEvent, opts: { image?: boolean; date?: boolean; excerpt?: boolean } = {}): string {
  const media = opts.image !== false && ev.media ? mediaImgTag(mediaImage(ev.media, 'medium_large', { alt: '', ratio: 4 / 3 })) : '';
  const url = permalink(ev.entry);
  const cats = ev.categories.length ? `<p class="c-cal-event__cats">${ev.categories.map((c) => esc(c.name)).join(' · ')}</p>` : '';
  const badge = opts.date !== false ? `<div class="c-cal-event__date" aria-hidden="true"><span class="c-cal-event__dow">${fmtDay(ev.startDay, { weekday: 'short' })}</span><span class="c-cal-event__day">${Number(ev.startDay.slice(8, 10))}</span></div>` : '';
  const excerpt = opts.excerpt === false ? '' : excerptOf(ev);
  return (
    `<article class="c-cal-event${ev.featured ? ' is-featured' : ''}">${badge}` +
    `<div class="c-cal-event__body">${ev.featured ? '<p class="c-cal-event__flag">Featured</p>' : ''}${cats}` +
    `<h3 class="c-cal-event__title"><a href="${esc(url)}">${entryTitle(ev.entry)}</a></h3>` +
    `<p class="c-cal-event__when"><time datetime="${ev.start.replace(' ', 'T')}">${whenText(ev)}</time></p>${venueLine(ev)}` +
    (excerpt ? `<p class="c-cal-event__excerpt">${esc(excerpt)}</p>` : '') +
    `</div>${media ? `<a class="c-cal-event__image" href="${esc(url)}" tabindex="-1" aria-hidden="true">${media}</a>` : ''}</article>`
  );
}

/** Events grouped under month headings (h2 on the events page; blocks inside a page use h3). */
export function grouped(events: CalEvent[], card: (ev: CalEvent) => string = (ev) => eventCard(ev), level = 2): string {
  let out = '';
  let month = '';
  for (const ev of events) {
    const m = ev.startDay.slice(0, 7);
    if (m !== month) {
      out += `${month ? '</div>' : ''}<h${level} class="c-cal__group">${fmtDay(`${m}-01`, { month: 'long', year: 'numeric' })}</h${level}><div class="c-cal__items">`;
      month = m;
    }
    out += card(ev);
  }
  return out ? `${out}</div>` : '';
}

function listView(req: CalRequest, all: CalEvent[], now: Date, today: string): Calendar {
  // Whether an event has passed is judged in its own timezone; a date to list from, on its own days.
  const ended = (ev: CalEvent) => hasEnded(ev.entry, ev.end, now);
  if (req.view === 'past') {
    const past = all.filter(ended).reverse();
    const page = past.slice((req.page - 1) * PER_PAGE, req.page * PER_PAGE);
    const more = past.length > req.page * PER_PAGE;
    return {
      req,
      today,
      heading: req.q ? `Past events matching “${esc(req.q)}”` : 'Past events',
      title: 'Past Events',
      prev: more ? { href: href(listPath(req.page + 1, true), req.q), label: 'Older events' } : undefined,
      next: { href: req.page > 1 ? href(listPath(req.page - 1, true), req.q) : href(listPath(1), req.q), label: req.page > 1 ? 'Newer events' : 'Upcoming events' },
      todayHref: href('/events/', req.q),
      todayLabel: 'Upcoming',
      body: grouped(page),
      notice: page.length ? undefined : req.q ? `No past events match “${esc(req.q)}”.` : 'There are no past events.',
      events: page,
    };
  }
  const upcoming = all.filter((ev) => (req.date ? ev.end >= `${req.date} 00:00:00` : !ended(ev)));
  const page = upcoming.slice((req.page - 1) * PER_PAGE, req.page * PER_PAGE);
  const more = upcoming.length > req.page * PER_PAGE;
  const hasPast = all.some(ended);
  const from = req.date ? `Events from ${fmtDay(req.date, { month: 'long', day: 'numeric', year: 'numeric' })}` : 'Upcoming events';
  return {
    req,
    today,
    heading: req.q ? `${from} matching “${esc(req.q)}”` : from,
    title: req.q ? `Search results for “${req.q}”` : 'Events',
    prev: req.page > 1 ? { href: href(listPath(req.page - 1), req.q, { from: req.date }), label: 'Previous events' } : hasPast && !req.date ? { href: href(listPath(1, true), req.q), label: 'Past events' } : undefined,
    next: more ? { href: href(listPath(req.page + 1), req.q, { from: req.date }), label: 'More events' } : undefined,
    todayHref: href('/events/', req.q),
    todayLabel: 'Today',
    body: grouped(page),
    notice: page.length ? undefined : req.q ? `No upcoming events match “${esc(req.q)}”.` : 'There are no upcoming events.',
    events: page,
  };
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * A month as a grid of days with event chips (dots on phones) and, under it, the month's events as an
 * agenda for phones. `first` is the month's first day ("Y-m-01"); day links go to the day view.
 */
export function monthGrid(first: string, all: CalEvent[], today: string, q = ''): { body: string; inMonth: CalEvent[] } {
  const [y, m] = first.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const gridStart = addDays(first, -lead);
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const lastDay = `${first.slice(0, 7)}-${String(daysInMonth).padStart(2, '0')}`;
  const on = (d: string) => all.filter((ev) => ev.startDay <= d && ev.endDay >= d);
  const month = first.slice(0, 7);

  let grid = '';
  for (let i = 0; i < cells; i++) {
    const d = addDays(gridStart, i);
    const events = on(d).sort((a, b) => Number(b.multiday || b.allDay) - Number(a.multiday || a.allDay) || (a.start < b.start ? -1 : 1));
    const cls = ['c-cal-day', d === today ? 'is-today' : '', d.slice(0, 7) !== month ? 'is-outside' : '', d < today ? 'is-past' : '', events.length ? 'has-events' : ''].filter(Boolean).join(' ');
    const shown = events.slice(0, 3);
    const chips = shown
      .map((ev) => {
        const continued = ev.startDay < d;
        const time = ev.allDay || ev.multiday ? '' : `<span class="c-cal-chip__time">${fmtTime(ev.start).replace(':00', '')}</span> `;
        return `<li class="c-cal-chip${ev.multiday || ev.allDay ? ' is-span' : ''}${continued ? ' is-continued' : ''}"><a href="${esc(permalink(ev.entry))}">${time}${entryTitle(ev.entry)}</a></li>`;
      })
      .join('');
    const more = events.length > shown.length ? `<a class="c-cal-day__more" href="${esc(href(dayPath(d), q))}">+${events.length - shown.length} more</a>` : '';
    grid +=
      `<div class="${cls}"><a class="c-cal-day__num" href="${esc(href(dayPath(d), q))}" aria-label="${fmtDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}${events.length ? `, ${events.length} event${events.length > 1 ? 's' : ''}` : ''}">${Number(d.slice(8, 10))}</a>` +
      (chips ? `<ul class="c-cal-day__events">${chips}</ul>` : '') +
      more +
      `${events.length ? '<span class="c-cal-day__dot" aria-hidden="true"></span>' : ''}</div>`;
  }
  // Phones: the month's events as a list under the grid.
  const inMonth = all.filter((ev) => ev.startDay <= lastDay && ev.endDay >= first);
  let agenda = '';
  let lastDate = '';
  for (const ev of inMonth) {
    const d = ev.startDay < first ? first : ev.startDay;
    if (d !== lastDate) {
      agenda += `${lastDate ? '</ul>' : ''}<h3 class="c-cal-agenda__day">${fmtDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}</h3><ul class="c-cal-agenda__items">`;
      lastDate = d;
    }
    agenda += `<li><a href="${esc(permalink(ev.entry))}">${entryTitle(ev.entry)}</a> <span>${whenText(ev)}</span></li>`;
  }
  if (agenda) agenda += '</ul>';
  const label = monthLabel(first);
  return {
    body:
      `<div class="c-cal-month" role="grid" aria-label="${label}"><div class="c-cal-month__head" role="row">${WEEKDAYS.map((w) => `<div role="columnheader">${w}</div>`).join('')}</div>` +
      `<div class="c-cal-month__grid">${grid}</div></div>` +
      `<div class="c-cal-agenda">${agenda || `<p class="c-cal__notice">No events in ${label}.</p>`}</div>`,
    inMonth,
  };
}

export const monthLabel = (first: string) => fmtDay(first, { month: 'long', year: 'numeric' });

/** The days the month and day views link between: the first event's to the last's, and today. Past
 *  them there is nothing to show, and a crawler following "next" would never stop. */
function span(all: CalEvent[], today: string): { lo: string; hi: string } {
  let lo = today, hi = today;
  for (const ev of all) {
    if (ev.startDay < lo) lo = ev.startDay;
    if (ev.endDay > hi) hi = ev.endDay;
  }
  return { lo, hi };
}

function monthView(req: CalRequest, all: CalEvent[], today: string): Calendar {
  const first = req.date || `${today.slice(0, 7)}-01`;
  const [y, m] = first.split('-').map(Number);
  const ym = (yy: number, mm: number) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 7);
  const { body, inMonth } = monthGrid(first, all, today, req.q);
  const label = monthLabel(first);
  const prev = ym(y, m - 1);
  const next = ym(y, m + 1);
  const { lo, hi } = span(all, today);
  return {
    req,
    today,
    heading: req.q ? `${label} · “${esc(req.q)}”` : label,
    title: `Events for ${label}`,
    prev: prev >= lo.slice(0, 7) ? { href: href(monthPath(prev), req.q), label: fmtDay(`${prev}-01`, { month: 'long' }) } : undefined,
    next: next <= hi.slice(0, 7) ? { href: href(monthPath(next), req.q), label: fmtDay(`${next}-01`, { month: 'long' }) } : undefined,
    outside: first.slice(0, 7) < lo.slice(0, 7) || first.slice(0, 7) > hi.slice(0, 7),
    todayHref: href('/events/month/', req.q),
    todayLabel: 'This month',
    body,
    notice: inMonth.length || !req.q ? undefined : `No events in ${label} match “${esc(req.q)}”.`,
    events: inMonth,
  };
}

function dayView(req: CalRequest, all: CalEvent[], today: string): Calendar {
  const day = req.date || today;
  const events = all
    .filter((ev) => ev.startDay <= day && ev.endDay >= day)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || Number(b.multiday && b.startDay < day) - Number(a.multiday && a.startDay < day) || (a.start < b.start ? -1 : 1));
  const label = fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const nextEvent = all.find((ev) => ev.startDay > day);
  const { lo, hi } = span(all, today);
  return {
    req,
    today,
    heading: req.q ? `${label} · “${esc(req.q)}”` : label,
    title: `Events for ${fmtDay(day, { month: 'long', day: 'numeric', year: 'numeric' })}`,
    prev: addDays(day, -1) >= lo ? { href: href(dayPath(addDays(day, -1)), req.q), label: fmtDay(addDays(day, -1), { month: 'short', day: 'numeric' }) } : undefined,
    next: addDays(day, 1) <= hi ? { href: href(dayPath(addDays(day, 1)), req.q), label: fmtDay(addDays(day, 1), { month: 'short', day: 'numeric' }) } : undefined,
    outside: day < lo || day > hi,
    todayHref: href('/events/today/', req.q),
    todayLabel: 'Today',
    body: events.length ? `<div class="c-cal__items">${events.map((ev) => eventCard(ev, { date: false })).join('')}</div>` : '',
    notice: events.length ? undefined : `No events on ${label}.${nextEvent ? ` <a href="${esc(href(dayPath(nextEvent.startDay), req.q))}">Jump to the next event</a>.` : ''}`,
    events,
  };
}

export async function buildCalendar(url: URL, loader: Loader, now = new Date()): Promise<Calendar> {
  const req = parseCalendarUrl(url);
  const all = (await loadCalEvents(loader)).filter((ev) => matchesSearch(ev, req.q));
  const today = siteNow(now).slice(0, 10);
  if (req.view === 'month') return monthView(req, all, today);
  if (req.view === 'day') return dayView(req, all, today);
  return listView(req, all, now, today);
}

/** Subscribe links for the current listing (iCal feed with the same search). */
function subscribe(v: Calendar, origin: string): string {
  const feed = new URL(`${origin}/events.ics`);
  if (v.req.q) feed.searchParams.set('q', v.req.q);
  if (v.req.view === 'month') feed.searchParams.set('month', (v.req.date || v.today).slice(0, 7));
  if (v.req.view === 'past') feed.searchParams.set('past', '1');
  const webcal = feed.toString().replace(/^https?:/, 'webcal:');
  const links: [string, string][] = [
    ['Google Calendar', `https://www.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`],
    ['Apple / iCalendar', webcal],
    ['Outlook 365', `https://outlook.office.com/owa?path=/calendar/action/compose&rru=addsubscription&url=${encodeURIComponent(webcal)}&name=${encodeURIComponent(`${site.name} events`)}`],
    ['Outlook Live', `https://outlook.live.com/owa?path=/calendar/action/compose&rru=addsubscription&url=${encodeURIComponent(webcal)}&name=${encodeURIComponent(`${site.name} events`)}`],
    ['Download .ics file', feed.toString()],
  ];
  return `<details class="c-cal__subscribe"><summary>Subscribe to calendar</summary><ul>${links.map(([l, h]) => `<li><a href="${esc(h)}"${h.startsWith('http') && !h.includes(origin) ? ' target="_blank" rel="noopener"' : ''}>${l}</a></li>`).join('')}</ul></details>`;
}

export function renderCalendar(v: Calendar, origin: string): string {
  const { req } = v;
  const views: [CalView, string, string][] = [
    ['list', 'List', href('/events/', req.q)],
    ['month', 'Month', href(req.date && req.view !== 'past' ? monthPath(req.date.slice(0, 7)) : '/events/month/', req.q)],
    ['day', 'Day', href(req.date && req.view !== 'past' ? dayPath(req.date) : '/events/today/', req.q)],
  ];
  const current = req.view === 'past' ? 'list' : req.view;
  const dateInput =
    req.view === 'month'
      ? `<label class="c-cal__field"><span>Month</span><input type="month" name="month" value="${(req.date || v.today).slice(0, 7)}" /></label>`
      : req.view === 'day'
        ? `<label class="c-cal__field"><span>Date</span><input type="date" name="from" value="${req.date || v.today}" /></label>`
        : `<label class="c-cal__field"><span>From</span><input type="date" name="from" value="${req.date}" /></label>`;
  const action = req.view === 'month' ? '/events/month/' : req.view === 'day' ? '/events/day/' : req.view === 'past' ? '/events/past/' : '/events/';
  const arrow = (link: Calendar['prev'], dir: 'prev' | 'next') =>
    link ? `<a class="c-cal__arrow is-${dir}" href="${esc(link.href)}" aria-label="${dir === 'prev' ? 'Previous' : 'Next'}: ${esc(link.label)}"><span aria-hidden="true">${dir === 'prev' ? '‹' : '›'}</span></a>` : `<span class="c-cal__arrow is-${dir} is-disabled" aria-hidden="true">${dir === 'prev' ? '‹' : '›'}</span>`;
  const pager =
    req.view === 'list' || req.view === 'past'
      ? `<nav class="c-cal__pager" aria-label="More events">${v.prev ? `<a class="is-prev" href="${esc(v.prev.href)}">‹ ${esc(v.prev.label)}</a>` : '<span></span>'}${v.next ? `<a class="is-next" href="${esc(v.next.href)}">${esc(v.next.label)} ›</a>` : '<span></span>'}</nav>`
      : '';
  return (
    `<div class="c-cal is-${req.view}">` +
    `<form class="c-cal__bar" method="get" action="${action}" role="search">` +
    `<label class="c-cal__field is-search"><span>Search events</span><input type="search" name="q" value="${esc(req.q)}" placeholder="Search events" /></label>` +
    `${dateInput}<button type="submit" class="c-button__link c-cal__find">Find events</button></form>` +
    `<div class="c-cal__nav"><div class="c-cal__arrows">${arrow(v.prev, 'prev')}${arrow(v.next, 'next')}</div>` +
    `<a class="c-cal__today" href="${esc(v.todayHref)}">${v.todayLabel}</a>` +
    `<h1 class="c-cal__heading">${v.heading}</h1>` +
    `<nav class="c-cal__views" aria-label="Calendar view">${views.map(([k, l, h]) => `<a href="${esc(h)}"${k === current ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav></div>` +
    (v.notice ? `<p class="c-cal__notice">${v.notice}</p>` : '') +
    v.body +
    pager +
    `<div class="c-cal__footer">${subscribe(v, origin)}</div>` +
    `</div>`
  );
}
