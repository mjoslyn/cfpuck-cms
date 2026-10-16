---
title: Events
description: Event data, calendars, recurrence, feeds and the site timezone.
sidebar:
  order: 3
---

Events is optional: turn it on under **Settings > Events** (admins). It brings the event and venue
types under Content, event pages, the calendar at `/events/`, event categories, calendar feeds, tickets,
and the event and ticket blocks. The site's config doesn't need to define anything.

## Turning events on and off

Off (the default), nothing is deleted, but events, venues and event categories are hidden from the admin
and the site shows none of them:

- event pages, the calendar and its views, event category pages and the calendar feeds are Not found
- collections, search and menus leave events out, and email Events blocks list none
- event and ticket blocks show nothing, and the editor doesn't offer them
- tickets aren't sold, and reminders, follow-ups and waitlist notices aren't sent; Tickets and Settings >
  Tickets are hidden

Orders already placed still complete: buyers coming back from paying and the payment webhooks work.
Turned back on, everything returns. `npm run seed` adds the event templates, a sample event and events on
the home page only while Events is on (run it again after turning them on).

## Extending the event types

The core supplies the `event` and `venue` types and the `event_category` taxonomy
(`src/lib/events/types.ts`). Extend them with `events` in `src/site/config.ts`; whatever you leave out
stays as the core has it:

```ts
export default defineSite({
  // name, types, taxonomies...
  events: {
    event: {
      // Added to the core's fields; a field with a core field's key takes its place.
      fields: [
        { key: 'ages', label: 'Ages', type: 'text', compose: 'who it is for, e.g. "all ages", "21+"' },
        { key: 'cost', label: 'Price', type: 'text' },
      ],
      removeFields: ['schedule'],   // core fields to leave out
      label: 'Happenings',          // any other option replaces the core's
      singular: 'Happening',
      base: 'happening',            // /happening/<slug>/
    },
    venue: {
      fields: [{ key: 'parking', label: 'Parking', type: 'textarea' }],
    },
    category: { label: 'Kind of event', base: 'events/kind' },
  },
});
```

- `event` and `venue` take any content type option (`label`, `singular`, `base`, `describe`, `card`,
  `taxonomies`, `order`...) plus `fields` and `removeFields`. The type names stay `event` and `venue`.
- `category` takes the taxonomy's options (`label`, `singular`, `base`, `fields`).
- Keep `archive: '/events/'` (the default): the calendar views live under it.
- To replace a type whole instead, list your own `event` or `venue` in `types` (or `event_category` in
  `taxonomies`); the core then uses yours as it is and ignores `events` for it.

The date, time, all-day, time zone, recurrence, featured and Tickets settings are built into the event
sidebar and don't go in `fields`. The core reads these field keys: on events `venue`, `cost`, `website`
and `schedule` (a repeater of days, each with items); on venues `address`, `city`, `state`, `zip`,
`country`, `phone` and `website`.

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

## Time zone

The default time zone is set under **Settings > Events** (`settings.site.timezone`; the config's
`timezone` when empty). An event can choose its own in its sidebar (`fields.timezone`); its times are in
that zone, and visitors see its short name beside them. `SITE_TZ` is a live binding in `src/lib/site`:
the middleware and Compose jobs refresh it from the settings (`src/lib/site/timezone.ts`, cached a
minute), and admin pages pass it to the browser as `window.__siteTz`.

Changing the default moves events that were on the old time zone to the new one with their local times
kept (`moveEventsToTimezone`). Events with their own time zone stay.

## Tickets

An event can sell tickets or take free registrations: see [Tickets](../tickets/).
