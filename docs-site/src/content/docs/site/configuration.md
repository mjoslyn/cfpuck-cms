---
title: Site configuration
description: config.ts, the file that declares a site's identity, content types, fields and taxonomies.
sidebar:
  order: 1
---

Everything that differs between sites lives in `src/site/`. Its entry point is `config.ts`, which
calls `defineSite` (types in `src/lib/site/types.ts`).

| File | What it holds |
| --- | --- |
| `config.ts` | Name, organization, timezone, mail sender, admin email, the Compose brief, content types and taxonomies |
| `render.ts` | The site's own blocks, card designs, listing filters, `<head>` markup, footer scripts, old-URL redirects ([Blocks and hooks](../extending/)) |
| `editor.tsx` | Settings panels for the site's blocks, site-wide options ([Blocks and hooks](../extending/)) |
| `styles/tokens.css`, `styles/theme.css`, `presets.json` | Design tokens, styles, the editor's choices ([Styling](../styling/)) |
| `lib/content/cards.ts` | Card designs for collections |
| `migrations/` | Content migrations for the site's own data changes |
| `pages/api/`, `routes.json` | The site's own endpoints |
| `public/` | Static files, served at the same paths as the core's `public/`; a site file wins |
| `scripts/` | Checks that need this site's content |
| `moved-paths.json` | URL prefixes that moved, answered with a 301 |

Inside `src/site/`, files sit where their core counterparts do (`render/c/`, `lib/`, `pages/api/`,
`styles/`, `public/`, `scripts/`), so each maps onto the core.

After you change `config.ts`, run `npm run check`.

## Identity

```ts
export default defineSite({
  name: 'Example Town',
  organization: 'Example Town Chamber of Commerce',
  timezone: 'America/New_York',
  mailFrom: 'Example Town <noreply@example.org>',
  adminEmail: 'info@example.org',
  brief: 'The Example Town Chamber of Commerce site: things to do, events and news for visitors and the businesses that serve them.',
  types: [ /* ... */ ],
  taxonomies: [ /* ... */ ],
});
```

| Option | Meaning |
| --- | --- |
| `name` | The site's name as visitors see it |
| `organization` | Who runs it: admin sign-in, mail sender name |
| `timezone` | IANA timezone for event times. The default; admins can change it under Settings |
| `mailFrom` | Default From for outgoing mail, overridden by `MAIL_FROM` |
| `adminEmail` | Where form notifications go when a form doesn't say (`FORMS_ADMIN_EMAIL` overrides it) |
| `brief` | What Compose knows about the site: who it is for, what it covers, its voice |
| `compose` | Compose's house style, when it differs from the defaults ([Styling](../styling/#compose-house-style)) |

## Content types

`page`, `post` and `global` are required. Events (the `event` and `venue` types and the
`event_category` taxonomy) come with the core and are turned on under Settings > Events; define them
here only to change them ([Events](../../features/events/#changing-the-event-types)).

```ts
{
  type: 'event',
  label: 'Events',
  singular: 'Event',
  base: 'event',
  archive: '/events/',
  category: 'event_category',
  describe: 'an event on the calendar (/events/)',
  card: 'event',
  fields: [
    { key: 'venue', label: 'Venue', type: 'entry', entryType: 'venue' },
    { key: 'cost', label: 'Cost', type: 'text', compose: 'price as written, e.g. "$25, kids free"' },
  ],
}
```

| Option | Meaning |
| --- | --- |
| `type` | Stored in `entries.type` |
| `label`, `singular` | Plural and singular names |
| `base` | URL segment for single entries: `base: 'directory'` serves `/directory/<slug>/`. Without it, entries live at the root |
| `archive` | The type's listing page (`/directory/`) |
| `record` | Data only, with no page; edited with a plain form (venues) |
| `pageless` | No public page (globals) |
| `hidden` | Left out of the admin's type tabs |
| `category` | The type's main taxonomy: card labels, and the first offered to filter by |
| `taxonomies` | Its other taxonomies. Each gets a term picker in an entry's settings; collections, filters and bulk actions offer them. Tags apply to every type |
| `fields` | The type's own fields, shown in the editor's Details |
| `describe` | For Compose: what an entry of this type is |
| `logoField` | An image field used as the entry's logo, before the featured image |
| `card` | The default card design for listings of this type (default `image`) |
| `order` | Default listing order: `date` (newest first, default) or `title` |

## Fields

Field values are stored in `entries.fields` under their `key`.

| `type` | Holds |
| --- | --- |
| `text`, `url`, `email`, `textarea`, `html`, `number`, `bool` | A plain value |
| `image` | A media id |
| `select` | One of `options` (`[value, label]` pairs) |
| `repeater` | A list of items, each with its own `fields`. `itemLabel` names the field shown as an item's title, `itemName` what one item is called ("Add day") |
| `entry` | One entry of `entryType`, by id. `create` lists the fields asked for when adding one inline |
| `entries` | Several entries of the given `types` |

A field with a `compose` hint may be filled by Compose from an editor's materials; the text tells
Claude what it holds (`"phone number"`, `"logo (image id)"`). Fields without one are left to the
editor.

`seo` is a reserved key ([SEO and social](../../features/seo-and-social/)).

## Taxonomies

```ts
taxonomies: [
  { name: 'category', label: 'Category', base: 'category' },
  { name: 'tag', label: 'Tag', base: 'tag' },
  { name: 'event_category', label: 'Event category', base: 'events/category' },
],
```

`category` and `tag` are required.

| Option | Meaning |
| --- | --- |
| `name` | Stored in `terms.taxonomy` |
| `label`, `singular` | Names; `singular` defaults to the label |
| `base` | URL base for term pages: `directory/category` serves `/directory/category/<slug>/` |
| `lists` | The type a term page lists. Default: the one type with this taxonomy as its `category`, else every type |
| `fields` | Its terms' own fields, edited in each term's Details and shown by the Field block on term pages. `template`, `image` and `seo` are reserved |

## How the core reads it

Core code reads the config only through `src/lib/site`: `CONTENT_TYPES`, `COMPOSABLE_TYPES`,
`LISTABLE_TYPES`, `RECORD_TYPES`, `PAGELESS_TYPES`, `TYPE_BASES`, `ARCHIVE_PATHS`, `TAXONOMY_BASES`,
`fieldsFor`, `categoryOf`, `taxonomiesOf`, `termPageType`, `SITE_TZ`. The editor's Details, Compose's
fields and prompt, permalinks, URL routing (archives, term pages, records), collection filters and the
admin tabs all follow it.
