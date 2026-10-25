---
title: Data model
description: Entries, terms, fields and settings in D1.
sidebar:
  order: 1
---

The schema is in `db/migrations/` (D1).

## Entries

Every piece of content is a row in `entries` with a `type` from the site config (`page`, `post`,
`event`, a site's own types). Custom values live in `entries.fields` under plain names: the type's
`fields`.

- **Content** is Puck data in `entries.content` (see [Blocks](../blocks/)).
- **Body text**: `entries.body_text` is the entry's readable text, filled from its content by the
  query layer whenever the content is written. Search and event descriptions use it.
- **Unpublished changes** to a published entry are kept aside in `entry_drafts` (editors only: the
  published rows of `entries` are public).
- **Image fields** hold media ids.

### Events

Events use `start` and `end` (wall-clock times in `timezone`), `all_day`, `cost`, `website`, `venue`
(an entry id), `featured`, `recurrence` and `schedule`. See [Events](../../features/events/).

## Terms

Terms have a `taxonomy` (from the config), an optional parent, and a `sort` order among their
siblings. A term's own template is in `terms.fields.template`. See
[Taxonomies](../taxonomies/).

## Templates

`templates` holds templates, template parts (header, footer), patterns and their content, also Puck
data. See [Templates and types](../templates/).

## Settings

Site-wide values are in `settings`:

- `site`: timezone, templates per type, listings and term pages turned off, search types, social
  profiles, share image, taxonomy templates.
- `options`: the menu (`menu_items`) and the site's own `settingsFields`.

Settings writes are admin-only in the query layer's policies (`src/lib/db/policies.ts`).

## Other tables

| Table | Holds |
| --- | --- |
| `media` | Uploads, focal points, crop focals |
| `forms` | Form definitions and notification settings |
| `redirects`, `not_found` | Redirect rules and the addresses not found |
| `compose_sessions`, `compose_jobs` | Compose conversations and their running turns |
| `profiles` | Users' roles: `editor`, `admin`, `viewer` |
