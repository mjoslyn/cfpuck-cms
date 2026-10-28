---
title: Templates and types
description: Templates per type, content areas, patterns, linked patterns and globals.
sidebar:
  order: 5
---

## Templates per type

**Settings > Types** sets, for each type, the template for its entries and for its listing page
(`settings.site.templates`, `src/lib/templates.ts`). An entry's own template (in its settings) comes
before its type's.

Templates without a **Page content** block are marked, and choosing one warns that the entry's content
won't show. Pages whose template has no Page content are edited in layout mode: the template document
itself.

Each listing page also has its own featured image and SEO there (see
[SEO and social](../../features/seo-and-social/#listing-pages)).

Listing pages can be turned off (`settings.site.listings_off`). The address then serves a page with
that address, if any, or 404. For events, the calendar views go too.

Templates and layout mode have no drafts: **Save & apply** changes every page that uses them.

## Renaming

**Rename** (the templates list and a template's, part's or pattern's editor header;
`src/admin/RenameTemplate.tsx`, POST `/api/admin/templates` with `{ action: 'rename', kind, slug, title,
newSlug }`, `renameTemplate` in `src/lib/admin/rename-template.ts`) changes its name (`templates.title`, up
to 120 characters) and its address (slug; the dialog's Address follows the name until it is edited). The
row keeps its `updated_at`, so an editor open on it isn't asked about a newer version.

A new address is written, with the server's access, wherever the site names the old one: the part or
pattern blocks placing it in entries, their unpublished changes and other templates (`renameInDoc`; a
`header` or `footer` part keeps its role as `attrs.area`, which the part renderer reads before its slug),
or for a template the entries that chose it, their unpublished changes, Settings > Types
(`settings.site.templates`, `taxonomy_templates`) and terms (`fields.template`); and Compose
conversations about it. Those rows keep their `updated_at` too. The old address goes into
`templates.former_slugs`, and `Loader.template` falls back to it when no template has that address: so a
template the hierarchy found by its name (`single-post`, `archive`) still serves those pages, and
revisions, a site's code and copies that haven't synced still find it. A template given a former address
takes it over. The old editor address redirects to the new one; a save to an address that has gone answers
404 rather than saving nothing. Sync carries `former_slugs` with the row.

## Content areas

A template can have several Page content blocks, each naming a content area (`attrs.area`). `main`,
the default, is the entry's content. Other areas (`sidebar`, `intro`...) are filled in per entry and
stored as slots on its content's root (`root.props["area-<name>"]`, `src/lib/content/areas.ts`). The
editor shows each where the template places it.

Saving a template gives a Page content block that repeats an area the next free name (`area-2`,
`area-3`...; `uniqueAreas`), so two never show the same content.

## Patterns

Patterns (`templates` of type `pattern`) are reusable groups of blocks, inserted from the editor's
Patterns tab. Their thumbnails come from `/admin/pattern-preview?slug=`.

Any block's settings end with **Save as pattern** (the block and everything in it).

- **Copy pattern**: inserts its own blocks, which the page changes freely.
- **Linked pattern** (`root.props.linked`): placed as a reference. Layout and style stay the
  pattern's, so editing the pattern changes every page; each page changes only its content.

A linked pattern is stored as:

```json
{
  "type": "pattern",
  "attrs": {
    "slug": "visit-cta",
    "linked": true,
    "overrides": { "<pattern block id>": { "content": "..." } }
  }
}
```

In the editor a linked pattern opens as its blocks (`expandLinked`), locked against moving, removing
and adding, each block's panel showing only its content fields (`CONTENT_FIELDS`,
`src/lib/content/linked-patterns.ts`, `src/puck/LinkedPatterns.tsx`). Saving stores the reference and
the changed content (`collapseAll`), or an ordinary copy if its blocks no longer match the pattern.
**Detach** makes the copy on purpose.

## Globals

Globals (the `global` type, placed with the Global block) share content and style alike: one edit
changes every place it appears.

## Template parts

Parts (`part` block) such as the header and footer are shared regions of templates.
