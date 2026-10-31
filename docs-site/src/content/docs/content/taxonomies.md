---
title: Taxonomies and tags
description: Terms, tags, term pages and their templates.
sidebar:
  order: 4
---

Taxonomies are declared in the site config. `category` and `tag` are required; a site adds its own
(`event_category`, `member_category`...). A type's `category` is its main taxonomy and `taxonomies`
lists any others. Each gets a term picker in an entry's settings, and collections, the event
calendar and bulk actions offer them.

## Taxonomies made in the admin

Admins can also make taxonomies, each for any number of types, and add types to the config's own
(**Content > Taxonomies**: **Add a taxonomy**, and each tab's settings; `/api/admin/taxonomies`). They
are kept in the site settings:

- `settings.site.taxonomies`: those made, each `{ name, label, singular?, base?, flat?, types }`. The
  name comes from the label when it is made and stays. Without a `base` its terms have no pages; a base
  can't be one of the site's own routes or another type's or taxonomy's (`baseProblem`).
- `settings.site.taxonomy_types`: types added to a config taxonomy (`{ category: ['page'] }`). The
  types the config gives it can't be taken away; tags are on every type already.

`applyTypeSettings` (`src/lib/site`) joins them to the config's: the made ones to `site.taxonomies`
and `TAXONOMY_BASES` (changed in place), every one's types to `taxonomiesOf` and `typesOfTaxonomy`. The
server applies it with the timezone, at most once a minute per instance (`refreshSiteTimezone`), and
admin pages hand it to the browser as `window.__siteTypes`. Deleting a made taxonomy deletes its
terms, which entries lose. A taxonomy on more than one type has term pages listing all of them.

## Tags

Tags are terms of the `tag` taxonomy, on any type. They are edited in each entry's settings (created
on save, `setEntryTags`), filterable in collections (`query.taxQuery.tag`) and listed at
`/tag/<slug>/`.

## Managing terms

**Content > Taxonomies** (`src/admin/Terms.astro`, `/api/admin/terms`) has a tab per taxonomy, with
the types it is used on: terms nested under their parents (tags, and made taxonomies set flat, stay flat), with name, address and template to change, how
many entries use each, a link to its page, and Delete.

- A term can't sit under itself or its children.
- A changed address leaves a redirect from the old term page.
- Deleting a term moves its children up.

### Ordering

Terms move by dragging their handle: onto another term's top or bottom edge to go beside it, onto its
middle to go under it, or onto **Top level**. The handle's menu does the same from the keyboard
(Move up, Move down, Move under). The order among siblings is `terms.sort` (then name), used by the
list, the Filters dropdown and an entry's listed terms (`byTermOrder`).

## Term details

Each term's **Details** button opens:

- **Description**: shown by the Excerpt block on its page, and the meta description when SEO has none.
- **Featured image**: shown by the Featured image block on its page and when it is shared.
- **Fields**: the taxonomy's own fields, declared in the site config like a type's:

  ```ts
  { name: 'member_category', label: 'Member category', base: 'directory/category',
    fields: [{ key: 'tagline', label: 'Tagline', type: 'text' }] }
  ```

  They are stored in `terms.fields` under their keys (`template`, `image` and `seo` are reserved) and
  shown by the Field block on its page.
- **SEO**: search title, meta description, share image and noindex, as an entry's.

### Compose

At the top of a term's Details, **Compose** (with optional notes) fills in its description,
search title and meta description, and the taxonomy's fields that have a `compose` hint (as a type's
fields do for Compose). It works from the term's name, the term above it, its current description and
the entries filed under it. Nothing is saved until you click Save. A taxonomy's **Featured image and
SEO** panel has the same button, which writes its `{term}` title and description patterns.

### Taxonomy defaults

Under **Settings > Types**, each taxonomy with term pages has an **SEO** button beside its template's Edit, opening its featured image and SEO: an image, a
search title, a meta description and noindex that its term pages use when a term has none of its own
(for the meta description, a term's own description comes first too).
In the title and description, `{term}` is replaced by the term's name, so `Example Town {term}
businesses` gives each category page its own title.

### On the term page

In a term page's template, the Featured image, Title, Excerpt and Field blocks outside a collection
show the term: its featured image (else the taxonomy's), its name (linking to its page), its description
and its fields. Inside a collection they show each listed entry, as anywhere else.

## Term pages

A taxonomy's `base` sets where its term pages live: `base: 'events/category'` serves
`/events/category/<slug>/`. A term page lists the taxonomy's `lists` type.

### Template

The first that exists (`templateCandidates`, `termTemplate`):

1. The term's own template (Content > Taxonomies, `terms.fields.template`). Terms under a term share
   its template, and several ticked terms can be set at once.
2. `taxonomy-<taxonomy>-<slug>`
3. The taxonomy's template (Settings > Types, `settings.site.taxonomy_templates`)
4. `taxonomy-<taxonomy>`, `taxonomy`, `archive`, `index`

### Turning them off

A taxonomy's term pages can be turned off under Settings > Types (`settings.site.taxonomy_pages_off`,
`termPagesOn`). Its addresses then serve a page with that address or Not found, and its terms show
without links in entry terms, event categories and search suggestions.
