// A single event: hero, description with a details sidebar (date, time, venue, cost, categories, add to
// calendar), and the day-by-day schedule when the event has one.
import type { Env, Renderer } from '../env';
import type { Entry } from '../../lib/types';
import { eventTimes, venueIdOf, siteNow, SITE_TZ } from '../../lib/events/model';
import { mediaImage, mediaImgTag, markImages } from '../../lib/media/image';
import { permalink, termLink, byTermOrder } from '../../lib/permalink';
import { renderItems } from '../engine';
import { entryTitle } from '../c/entry';
import { localToUtc } from '../../lib/recurrence';
import { zoneLabel } from '../../lib/events/timezone';
import { termPagesOn } from '../../lib/templates';
import { taxonomiesOf } from '../../lib/site';
import { ticketPriceSummary, ticketsSection } from '../c/tickets';

/** The event type's taxonomies (its categories), from the site config. */
const EVENT_TAXONOMIES = taxonomiesOf('event');

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const day = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
const time = (s: string) => {
  const [h, m] = s.slice(11, 16).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

function categories(env: Env, e: Entry) {
  return (e.term_ids ?? [])
    .map((id) => env.ctx.loader.terms.get(id)!)
    .filter((t) => !!t && EVENT_TAXONOMIES.includes(t.taxonomy))
    .sort(byTermOrder);
}

function venueOf(env: Env, e: Entry): Entry | undefined {
  const id = venueIdOf(e);
  const v = id ? env.ctx.loader.entries.get(id) : undefined;
  return v?.type === 'venue' ? v : undefined;
}

function address(v: Entry): string[] {
  const f = v.fields ?? {};
  const cityLine = [f.city, [f.state, f.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [f.address, cityLine, f.country && f.country !== 'United States' ? f.country : ''].filter(Boolean);
}

/** Google Calendar and .ics links for the event. */
function addToCalendar(e: Entry, origin: string): string {
  const { start, end, allDay } = eventTimes(e);
  const stamp = (s: string) => localToUtc(s, e.fields?.timezone || SITE_TZ).replace(/[-:]|\.\d+/g, '');
  const dates = allDay ? `${start.slice(0, 10).replace(/-/g, '')}/${new Date(Date.parse(`${end.slice(0, 10)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10).replace(/-/g, '')}` : `${stamp(start)}/${stamp(end)}`;
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${dates}&details=${encodeURIComponent(`${origin}${permalink(e)}`)}`;
  const ics = `${permalink(e)}event.ics`;
  return `<div class="c-event__add"><a href="${esc(google)}" target="_blank" rel="noopener">Google Calendar</a><a href="${esc(ics)}">iCal / Outlook</a></div>`;
}

function details(env: Env, e: Entry): string {
  const { start, end, allDay } = eventTimes(e);
  const box = (title: string, body: string) => `<section class="c-event__box"><h2 class="c-event__label">${title}</h2>${body}</section>`;
  let out: string;
  // A new event (e.g. a draft from Compose) may have no date yet.
  if (!start || Number.isNaN(Date.parse(start.slice(0, 10)))) out = box('Date &amp; Time', '<p class="c-event__dates">To be announced</p>');
  else {
    const sameDay = start.slice(0, 10) === end.slice(0, 10) || (allDay && end.slice(0, 10) === start.slice(0, 10));
    const long = (s: string) => day(s, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const dates = sameDay ? long(start) : `${day(start, { weekday: 'long', month: 'long', day: 'numeric' })} – ${long(end)}`;
    const zone = allDay ? '' : zoneLabel(e.fields?.timezone, start, SITE_TZ);
    const hours = (allDay ? 'All day' : sameDay ? (start === end ? time(start) : `${time(start)} – ${time(end)}`) : `${time(start)} ${day(start, { month: 'short', day: 'numeric' })} – ${time(end)} ${day(end, { month: 'short', day: 'numeric' })}`) + (zone ? ` ${zone}` : '');
    out = box('Date &amp; Time', `<p class="c-event__dates">${dates}</p><p class="c-event__hours">${hours}</p>${addToCalendar(e, env.ctx.queried.url.origin)}`);
  }
  const venue = venueOf(env, e);
  const cost = e.fields?.cost;
  const website = e.fields?.website;
  const cats = categories(env, e);
  if (venue) {
    const lines = address(venue);
    const map = lines.length ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue.title, ...lines].join(', '))}` : '';
    const phone = venue.fields?.phone;
    out += box(
      'Location',
      `<p class="c-event__venue">${entryTitle(venue)}</p>${lines.length ? `<p class="c-event__address">${lines.map(esc).join('<br />')}</p>` : ''}` +
        (phone ? `<p class="c-event__address"><a href="tel:${esc(String(phone).replace(/[^0-9+]/g, ''))}">${esc(phone)}</a></p>` : '') +
        (map ? `<p class="c-event__map"><a href="${esc(map)}" target="_blank" rel="noopener">Get directions</a></p>` : ''),
    );
  }
  // Tickets sold here: their prices and a link to the form below the content.
  const tickets = ticketPriceSummary(env);
  if (tickets) out += box('Tickets', `<p>${esc(tickets)}</p><p class="c-event__map"><a href="#tickets">Get tickets</a></p>`);
  else if (cost) out += box('Cost', `<p>${esc(cost)}</p>`);
  if (website) out += box('Website', `<p><a href="${esc(website)}" target="_blank" rel="noopener">${esc(String(website).replace(/^https?:\/\/(www\.)?|\/$/g, ''))}</a></p>`);
  if (cats.length) out += box('Category', `<p>${cats.map((t) => (termPagesOn(env.ctx.settings.site, t.taxonomy) ? `<a href="${termLink(t)}" rel="tag">${esc(t.name)}</a>` : esc(t.name))).join(', ')}</p>`);
  return out;
}

/** The event's day-by-day schedule (schedule field). */
export function schedule(e: Entry): string {
  const days = e.fields?.schedule;
  if (!Array.isArray(days) || !days.length) return '';
  const body = days
    .map((d: any) => {
      const items: any[] = Array.isArray(d.items) ? d.items : [];
      return (
        `<div class="c-schedule__day"><h3 class="c-schedule__label">${esc(d.day_label ?? '')}</h3>` +
        (items.length
          ? `<ol class="c-schedule__items">${items
              .map((it) => {
                const where = [it.location, it.note].filter(Boolean).join(' — ');
                return `<li class="c-schedule__item"><span class="c-schedule__time">${esc(it.time ?? '')}</span><div><p class="c-schedule__title">${esc(it.title ?? '')}</p>${where ? `<p class="c-schedule__where">${esc(where)}</p>` : ''}</div></li>`;
              })
              .join('')}</ol>`
          : '') +
        `</div>`
      );
    })
    .join('');
  return `<section class="c-schedule"><div class="c-schedule__inner"><hr class="c-separator is-accent" /><h2 class="c-schedule__heading">Schedule</h2>${body}</div></section>`;
}

export const eventDetails: Renderer = (_b, env) => {
  const e = env.ctx.queried.entry;
  if (!e) return '';
  const title = entryTitle(e);
  const media = e.featured_media_id ? env.ctx.loader.media.get(e.featured_media_id) : undefined;
  const hero = media ? mediaImgTag(mediaImage(media, 'full', { className: 'c-event__hero-image', alt: '' }), { loading: 'eager' }) : '';
  const cats = categories(env, e);
  const content = env.contentSlot ?? markImages(renderItems(env.ctx.docs.get(`content:${e.id}`), { ...env, post: e, parentLayout: null, imgCtx: 'noloop' }), 'noloop');
  const { end } = eventTimes(e);
  const past = end && end < siteNow();
  return (
    `<article class="c-event">` +
    `<header class="c-event__hero${hero ? ' has-image' : ''}">${hero}<div class="c-event__hero-inner">` +
    (cats.length ? `<p class="c-event__badge">${cats.map((t) => esc(t.name)).join(', ')}</p>` : '') +
    `<h1 class="c-event__title">${title}</h1></div></header>` +
    `<div class="c-event__main">` +
    (past ? `<p class="c-event__passed">This event has passed. <a href="/events/">See upcoming events</a>.</p>` : '') +
    `<div class="c-event__content">${content}${env.ctx.data.get('tickets-block') ? '' : ticketsSection(env)}</div><aside class="c-event__details">${details(env, e)}</aside></div>` +
    schedule(e) +
    `<nav class="c-event__back"><a href="/events/">← All events</a></nav>` +
    `</article>`
  );
};

/** Schedule block: the schedule of the event being shown. */
export const eventSchedule: Renderer = (_b, env) => {
  const e = env.post ?? env.ctx.queried.entry;
  return e ? schedule(e) : '';
};
