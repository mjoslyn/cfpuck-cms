---
title: Events
description: Event data, calendars, recurrence, feeds and the site timezone.
sidebar:
  order: 3
---

Defining `event` and `venue` types in the config turns on the calendar.

## Data

Events use `start` and `end` (wall-clock times in `timezone`), `all_day`, `cost`, `website`, `venue`
(an entry id), `featured`, `recurrence` and `schedule`. `src/lib/events/model.ts` loads events,
occurrences included, as `CalEvent`s.

## Pages and blocks

| URL | Shows |
| --- | --- |
| `/events/` | Upcoming events |
| `/events/past/` | Past events |
| `/events/month/<Y-m>/` | A month |
| `/events/day/<Y-m-d>/` | A day |

All take `?q=` (search) and `?from=<Y-m-d>`.

| Block | Renders |
| --- | --- |
| `events-calendar` | The calendar pages above (`src/render/events/calendar.ts`) |
| `event-calendar` | A month grid or list for any page (`event-calendar.ts`, `public/assets/js/event-calendar.js`) |
| `event-details` | An event's date, venue and details (`single.ts`) |
| `event-schedule` | The `schedule` field |
| `event-date` | An event's date, for cards |

Styles are in `src/styles/events.css`.

## Feeds

`src/lib/events/ical.ts`:

- `/events.ics`, with the same `q`, `month` and `past` filters
- `/event/<slug>/[<Y-m-d>/]event.ics`

Feeds describe the site timezone from the runtime's time zone data (`src/lib/events/timezone.ts`).

## Recurrence

An event's rule is stored in `fields.recurrence` and edited in the event sidebar
(`src/lib/recurrence.ts`).

- Occurrences are virtual entries (negative ids, their own `event_start`, `start` and `end`) at
  `/event/<slug>/<Y-m-d>/`.
- `/event/<slug>/` redirects to the next occurrence.
- A series is expanded up to two years ahead; of a long one, the newest 1,100 occurrences are kept
  (for a daily event, about a year back).
- `Loader.query` expands series only when a recurring event exists.
- The month and day views link no further than the first and last event; the feeds are cached like pages.
- Saving an event rewrites the `start` and `end` fields the views read.

## Site timezone

`SITE_TZ` is set by admins under Settings (`settings.site.timezone`); the config's `timezone` is the
default. It is a live binding in `src/lib/site`: the middleware and Compose jobs refresh it from the
settings (`src/lib/site/timezone.ts`, cached a minute), and admin pages pass it to the browser as
`window.__siteTz`.

Changing it moves events that were on the old timezone to the new one with their local times kept
(`moveEventsToTimezone`). Events with their own timezone stay.
