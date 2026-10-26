# supapuck-cms: the core (Astro + Puck on Cloudflare)

A CMS for small business and organisation sites: Astro SSR on a Cloudflare Worker, content in D1 and files in R2, a Puck visual editor,
and Compose (pages written with Claude from documents, images and links). The code is split into the
core (everything outside `src/site/`) and a site (`src/site/`). This repository holds the core and an
example site; a real site is a fork that replaces `src/site/` (see Upstream and sites).

## Upstream and sites

This repository is the upstream. Each site is its own repository with this one as its `upstream`
remote. Its history starts from this one, with a commit that swaps the example `src/site/` for its own.

- Core changes are made here, committed and pushed, then merged into each site:
  `git fetch upstream && git merge upstream/main`. They merge cleanly as long as the site only changes
  `src/site/`, its own migrations (`db/migrations/*_site_*.sql`: wrangler reads only that folder),
  `AGENTS.md`, `README.md`, its env and its `wrangler.jsonc` (names and ids of its Worker, database,
  bucket and queue).
- All of a site's code and files are in `src/site/`, laid out like the core so each maps onto its
  counterpart: `render/c/` (blocks, as `src/render/c/`), `lib/` (`lib/content/cards.ts` beside
  `src/lib/content/card-presets.ts`), `pages/api/` (endpoints, listed in `routes.json`), `styles/`
  (`tokens.css`, `theme.css`), `public/` (static files, served at the same paths as `public/` by the
  `site-public` integration in `astro.config.mjs`; a site file wins), `scripts/` (the site's own checks)
  and `migrations/` (content migrations). The entry points stay at the top: `config.ts`, `render.ts`,
  `editor.tsx`, `presets.json`, `routes.json`, `moved-paths.json`.
- This file (`CORE.md`) documents the core and belongs to upstream; sites don't edit it. A site's own
  notes go in its `AGENTS.md`, which imports this file.
- A core fix found while working on a site can be made there and sent upstream: commit it on its own
  (core files only), then `git cherry-pick` it here.
- Never import from `src/site/` in core code except through `src/lib/site` (the CSS imports of the
  site's `styles/tokens.css` and `styles/theme.css` in `src/styles/site.css` aside). New core code must not hard-code a site's types, URLs or names.
- Migrations (core and site, `db/migrations/`) are named with the time they were written
  (`YYYYMMDDHHMMSS_name.sql`) and applied with `npx wrangler d1 migrations apply DB --local` (or
  `--remote`), which applies every one not yet applied, in order. The Postgres migrations from before
  D1 are in the history (commit `68b7327` is the last with `supabase/migrations/`).
- Content changes (renamed props, moved settings) ship as migrations: see Changing stored content.

## Site config

Everything that differs between sites lives in `src/site/`:

- `config.ts` (`defineSite`, types in `src/lib/site/types.ts`): name, organization, admin email,
  default timezone, default mail sender, the Compose brief, content types (labels, URL `base`, `archive` path,
  `record`/`pageless`/`hidden`, taxonomies (`category`, its main one, and `taxonomies`, any others;
  each gets a term picker in an entry's settings, and collections, the event calendar and bulk actions
  offer them; `taxonomiesOf`), `fields` with `compose` hints, `describe`,
  `logoField`, default `card`, `order`) and taxonomies (label, URL `base`, the type a term page `lists`,
  its terms' own `fields`; `category` and `tag` are required; `event`, `venue` and `event_category`
  come with the core's Events feature, extended with `events`, see Events). Core code reads it only through `src/lib/site` (`CONTENT_TYPES`,
  `COMPOSABLE_TYPES`, `LISTABLE_TYPES`, `RECORD_TYPES`, `PAGELESS_TYPES`, `TYPE_BASES`,
  `ARCHIVE_PATHS`, `TAXONOMY_BASES`, `fieldsFor`, `categoryOf`, `termPageType`, `SITE_TZ`): the
  editor's Details, Compose's fields and prompt, permalinks, URL routing (archives, term pages,
  records), collection filters and the admin tabs all follow it.
- `render.ts` (`defineRender`, read through `src/lib/site/render.ts`): `redirect` (the site's old URLs,
  301ed from the catch-all route), `blocks` with label, editor
  category, string renderer, an async `prepare` hook that loads data onto ctx, and optional `types`
  (the entry types a block reads fields from, so the editor offers it only there and in templates);
  `cards` (collection card designs; the first is the default); `archiveQuery` to add search or filters
  to listing pages; `head` (fonts, meta); `pageScripts` for footer scripts.
- `editor.tsx` (`defineEditor`, read through `src/lib/site/editor.ts`): settings `panels` for the
  site's blocks, `settingsFields` and `settingsTitle` for site options under Settings.
- `styles/tokens.css` (design token values, including the role colors the core uses) and `presets.json` (the colors, sizes and spacing the editor
  offers), `styles/theme.css` (the site's styles, imported by `src/styles/site.css`).
- `migrations/index.ts` (`MIGRATIONS`, content migrations run before the core's), `routes.json` (the
  site's own endpoints in `src/site/pages/api/`, added by the `site-routes` integration in
  `astro.config.mjs`), `moved-paths.json` (URL prefixes that moved, 301ed).

Behaviour never keys off content class names: the core uses block settings (entry-image `field` and
`linkField` for a logo or banner field linked to a URL field; an `event-date` block for card dates;
collection `shuffle`, `query.orderBy: 'rand'`, `query.upcoming`, `columns`, `autoplay`). Core blocks
output `c-*` classes; a site's classes in content are only styling hooks for its `theme.css`.
Colors: the core's styles use only role tokens (`--color-text`, `-muted`, `-accent`, `-accent-hover`,
`-dark`, `-on-dark`, `-on-accent` (optional), `-surface`, `-surface-alt`, `-surface-soft`), which the site's `tokens.css` maps
onto its own palette (and re-maps inside dark bands). Content and `presets.json` use the palette names.
Compose's house style comes from the config's `compose`: colors (bands `plain`/`tint`/`soft`/`dark`,
body, on-dark, accent and card; role tokens by default), and shapes and type (`headingFont`, `rule`
between eyebrow and heading, `bodySize`/`bodyWeight`/`bodyLineHeight`, `bandPadding`, `textWidth`,
`wideWidth`, `radius`, `buttonRadius`, `buttonCaps`; the defaults are the original house style).

## Data model

Entries have a `type` (from the site config) and terms a `taxonomy`; custom values live in
`entries.fields` under plain names (the type's `fields`). Events use `start`/`end` (wall-clock in
`timezone`), `all_day`, `cost`, `website`, `venue` (entry id), `featured`, `recurrence`, `schedule`.
Image fields hold media ids. `entries.body_text` is the entry's readable text, filled from its
content by the query layer whenever `content` is written (`src/lib/content/body-text.ts`), for search
and event descriptions. Site-wide values are in `settings` (`site`, `options`). Schema:
`db/migrations/` (D1).

## Components

Content is Puck data (`entries.content`, `templates.content`): items `{ type, props: { id, attrs,
children } }`, rendered by `src/render/c/`: content blocks (`section`, `columns`, `text`, `heading`,
`image`, `buttons`, `list`, `quote`, `cover`, `hero`, `gallery`, `video-gallery`, `embed`, `html`,
`media-text`...), entry fields (`entry-title`, `entry-image`, ...), collections (`collection`,
`collection-items`, `pagination`...), events (`event-date`, `events-calendar`, `event-calendar`,
`event-details`), `form`, and structure (`part`, `pattern`, `reusable`). A site's blocks come from its
`render.ts`. `hero` is a full-bleed image with eyebrow, title, text and two buttons. Galleries hold
image blocks (`gallery`) or embed and video blocks (`video-gallery`) and show them as a grid, masonry
columns or a slider (`display`; a scroll-snap row, buttons and autoplay from
`public/assets/js/gallery-slider.js`); media picked in the panel arrive as `attrs.add` and become
child blocks in `resolveGallery` (`config.tsx`).
Props are clean values: styles as CSS with design tokens (`var(--color-*)`, `var(--space-*)`,
`var(--text-*)`), layouts as `{ type: flow|constrained|row|stack|grid }`.

Patterns (`templates` of type `pattern`) are reusable groups of blocks, inserted from the Patterns tab;
their thumbnails come from `/admin/pattern-preview?slug=`. Any block's settings end with **Save as
pattern** (the block and everything in it): a copy pattern inserts its own blocks, for the page to
change freely; a linked pattern (`root.props.linked`) is placed as a reference whose layout and style
stay the pattern's (editing the pattern changes every page) while each page changes its content:
`{ type: 'pattern', attrs: { slug, linked: true, overrides: { <pattern block id>: { content: ... } } } }`
(`src/lib/content/linked-patterns.ts`; which settings are content: `CONTENT_FIELDS`). In the editor a
linked pattern opens as its blocks (`expandLinked`), locked against moving, removing and adding, each
block's panel showing only its content fields (`src/puck/LinkedPatterns.tsx`); saving stores the
reference and the changed content (`collapseAll`), or an ordinary copy if its blocks no longer match
the pattern; Detach makes the copy on purpose. Globals (the `global` type, placed with the Global
block) share content and style alike.

## Collections and tags

A `collection` lists entries with its settings on the block itself (`src/puck/CollectionPanel.tsx`):
what to show (latest of some types, filtered by category and tags; hand-picked `query.include`; or the
page's own listing), display (grid with desktop/tablet/phone columns, list, slider), card design
(the site's `cards`, `src/lib/content/card-presets.ts`; choosing one replaces the item template via
`resolveCollection` in `config.tsx`; "custom" keeps the blocks), pagination (numbers, previous/next,
load more: `public/assets/js/collection-more.js` fetches the next page URL and appends that
collection's items) and an empty message. Card fields: `entry-title`, `entry-image`, `entry-excerpt`,
`entry-date`, `event-date`, `entry-terms`, `entry-field` (any field as text/link/email/phone/image).
Item, empty and pagination child blocks of older collections still render but aren't in the inserter.
A shuffled collection (`shuffle`) renders part of a pool of up to 48 entries and
`public/assets/js/collection-shuffle.js` picks a new random set on each visit.

Addresses: types without a URL `base` (pages and posts in the example site) all live at `/<slug>/`, so
an address is unique across them (`typesSharingAddresses`, `uniqueSlug`; a typed address another of
those types has is refused on save).

Tags are terms of the `tag` taxonomy on any type: edited in each entry's settings (created on save,
`setEntryTags`), filterable in collections (`query.taxQuery.tag`), listed at `/tag/<slug>/`.

Content > Taxonomies (`src/admin/Terms.astro`, `/api/admin/terms`) manages every taxonomy's terms, a
tab each: terms nested under their parents (tags stay flat), with name, address and template to change,
how many entries use each, its page, Details and Delete. **Details** (`src/admin/TermDetails.tsx`; GET
and PUT `/api/admin/terms`) edits a term's description, featured image (`fields.image`), the taxonomy's
own fields (its `fields` in the site config, under their keys in `terms.fields`) and SEO (`fields.seo`,
as an entry's). `template`, `image` and `seo` are reserved keys. A taxonomy's featured image and SEO
(Settings > Types, `settings.site.taxonomy_meta`) are the defaults for its term pages; `{term}` in its
search title and description is the term's name (`src/lib/page-meta.ts`). On a term page, Featured
image, Title, Excerpt and Field blocks outside a collection show the term: its featured image (else
the taxonomy's), name (linking to its page), description and fields. **Write with Claude** (POST
`/api/admin/meta-compose`, `quickAsk`, `ANTHROPIC_SEO_MODEL`) fills a term's description, search title,
meta description and the taxonomy's fields with a `compose` hint, from its name, its parent, what it
has now, the entries filed under it and optional notes; for a taxonomy (Settings > Types) it writes the
`{term}` title and description patterns. Nothing is saved until the form is. A term can't sit under itself or its children; a
changed address leaves a redirect from the old term page; deleting a term moves its children up.
Terms move by dragging their handle: onto another's top or bottom edge to go beside it, onto its middle
to go under it, or onto Top level; the handle's menu does the same from the keyboard (Move up, Move
down, Move under). Their order among the terms beside them is `terms.sort` (then name), used by the
list, the Filters dropdown and an entry's listed terms (`byTermOrder`).

Term pages: their template is the term's own (Content > Taxonomies, `terms.fields.template`; the terms
under a term share its template, and several ticked terms can be set at once), else
`taxonomy-<taxonomy>-<slug>`, else the taxonomy's (Settings > Types, `settings.site.taxonomy_templates`),
else `taxonomy-<taxonomy>`, `taxonomy`, `archive`, `index` (`templateCandidates`, `termTemplate`). A taxonomy's term pages can be
turned off (Settings > Types, `settings.site.taxonomy_pages_off`, `termPagesOn`): its addresses then
serve a page with that address or Not found, and terms show without links (entry terms, event
categories, search suggestions).

## SEO and social

An entry's SEO settings live in `fields.seo` (`src/lib/seo.ts`; `seo` is a reserved field key): search
title, meta description, share image (media id) and noindex. `src/render/meta.ts` writes the head
tags: description, canonical, robots, Open Graph and Twitter card, falling back to the excerpt, the
featured image and the site's default share image; the home page also gets Organization data with the
social profiles as `sameAs`. Compose includes `seo` in every `build_page` and writes it (marked
`generated`) on each build until someone edits it by hand. The entry settings' SEO section
(`src/puck/SeoForm.tsx`) shows lengths and a search result preview, and Generate asks Claude
(`POST /api/admin/seo`, `ANTHROPIC_SEO_MODEL`, default Haiku 4.5) for the page as it is in the editor.
Term pages (`termSeo`): the search title is the term's, else its taxonomy's (with `{term}` filled in),
also used for the `<title>`; the description the term's SEO description, else its description, else
the taxonomy's; the share image the term's, else its featured image, else the taxonomy's; noindex
from either. A type's listing page has its own featured image and SEO (Settings > Types,
`settings.site.listing_meta`, `listingSeo`): the title (over the calendar's own) and description on
the listing's address only, not on views under it (calendar months and days) or searches in it; the
image and noindex on all of them. A Featured image block on a listing page, outside a collection,
shows its image. Write with Claude (`/api/admin/meta-compose`) writes the title and description from
what it lists.

Settings > Social keeps the site's profiles (`settings.site.social`: network and URL;
`src/lib/social/links.ts`) and the default share image (`share_image`). The `social-links` block
(Layout) shows the profiles as icons (`src/lib/social/icons.ts`, Simple Icons paths, CC0), optionally
with names.

## Types in Settings

Settings > Types sets, per type, the template for its entries and its listing page
(`settings.site.templates`, `src/lib/templates.ts`), and turns listing pages off
(`settings.site.listings_off`; the address then serves a page with that address, if any, or 404; for
events the calendar views go too). An entry's own template (its settings) comes before its type's.
Templates without a Page content block are marked, and choosing one warns that the entry's content
won't show.
A template can have several Page content blocks, each naming a content area (`attrs.area`; `main`, the
default, is the entry's content). Other areas (`sidebar`, `intro`...) are filled in per entry and stored
as slots on its content's root (`root.props["area-<name>"]`, `src/lib/content/areas.ts`); the editor
shows each where the template places it. Saving a template gives a Page content block that repeats an
area the next free name (`area-2`, `area-3`...; `uniqueAreas`), so two never show the same content.

## Content list

The content list has All / Published / Drafts / Trash tabs and bulk actions on the checked rows
(`/api/admin/entries/bulk`): Publish (a placeholder address gets one from the title; untitled entries
are skipped), Move to drafts, Move to trash (not the home page); in the trash, Restore (as drafts) and
Delete permanently. Add a term and Remove a term change the entries' terms at once (the type's
taxonomies, tags and any taxonomy its entries use); a tag also goes into unpublished changes kept aside. **Duplicate** (list rows and the editor header; `src/lib/admin/duplicate.ts`) makes
a draft copy titled "(copy)" with its own address: content with any unpublished changes, fields, tags
and other terms, template, featured image and event dates. Templates, parts and patterns duplicate
from the templates list (`<slug>-copy`).

## Redirects

Settings > Redirects (admins; `/admin/redirects/` forwards there): old address to new (301 or 302), exact or a prefix ending in `*` whose
rest fills a `*` in the target (`src/lib/redirects.ts`, tables `redirects` and `not_found`). Whether a
rule covers an address is decided in one place, `ruleCovers`: an exact rule covers its own path, a
wildcard every path under its prefix. Redirects apply when an address would otherwise be Not found
(`renderRequest`, before the slug guess), so they never hide a live page: the exact rule first, else
the wildcard with the longest prefix (the `wildcard` column; in a like pattern of the query layer, as
in PostgREST's, `*` means `%`). Uses are counted (`redirect_hit`). A rule that would lead back to itself is refused
(`loopReason`: a wildcard whose target is under its own prefix). A published entry whose address
changes gets one automatically (`redirectMovedEntry`, from the entries API).

Addresses still not found are logged (`not_found`, via `not_found_hit`; files, admin and probes are
left out; at most 5,000 addresses, those not seen for 30 days making room for new ones) and listed on the screen with Add redirect. Saving a rule clears the entries it covers (for a
wildcard, every entry under its prefix, which can be many); the API returns the cleared paths, and
reports a failed clear rather than hiding it.

## Sync

Settings > Sync (admins; `src/admin/Sync.tsx`, `/api/admin/sync`, `src/lib/sync.ts`; backups on Settings >
Backups) copies content
between this site and another copy of it (production and a local copy), either way: entries of chosen
types (with their terms and unpublished changes), terms of chosen taxonomies, files (media rows and
every storage object: sizes, the kept original, AVIF/WebP copies), templates, parts and patterns,
forms, settings (`site`, `options`; the site icon's files too) and redirects. A sync runs from the copy
that has the other's address (`SYNC_REMOTE_URL`, `SYNC_REMOTE_NAME`; production can't reach a local
copy). Both copies share a secret (`SYNC_SECRET`, at least 32 characters): the copy running the sync
sends its queries to the other's `/api/sync/remote` and its file calls to `/api/sync/files`
(`src/lib/sync-remote.ts`), signed with it (HMAC-SHA256 of the time and the request, good for five
minutes; an upload's signature covers its bytes). The other copy runs them as the server, on the tables
and folders a sync uses only (`SYNC_TABLES`, `SYNC_FOLDERS`: `media`, `sync-backups`); without the
secret those routes answer Not found. Its writes clear its page cache.

- Rows match by id (entries, terms, media, forms: the copies share ids, and a sync keeps them; D1's
  next id is past the largest, so `sync_reset_ids()` has nothing to do), by kind and slug (templates), by key (settings)
  and by old address (redirects). Derived columns (`updated_at`, `body_text`, a redirect's
  `wildcard`) are neither compared nor written.
- Compare (`plan`) lists each group's new, changed and unchanged rows and its conflicts, which are
  left alone: an id that is another row there, an address taken by another row, a parent or featured
  image that isn't there (unless the sync brings it). Each new or changed row can be unticked, and
  **Show differences** opens a line diff of the row as the target has it and as the sync would write it.
- Syncing (`apply`, in batches the screen sends in turn) needs a warning ticked that names the target
  and counts the rows it overwrites. It never deletes.
- Before the first batch, `backup` checks the target can take the sync (not protected, and
  `sync_reset_ids()` there: a copy without the migrations is refused before anything is written) and,
  unless **Save a backup first** (on by default) is unticked, saves a backup in the target's private
  `sync-backups/` folder of its store: the rows the sync overwrites, whole and as they are, and the keys of the rows
  it adds. If that fails, nothing is synced. A key the sync means to add that now exists on the target
  (a row made there since Compare) stops it: compare again. Each batch then records the rows it really
  added beside the backup (`written/<backup name>`).
- **Snapshots**: everything a sync covers on one copy (entries with their terms and unpublished
  changes, terms, media rows, templates, forms, settings `site` and `options`, redirects), in the same
  folder as `<time>-snapshot-<trigger>.json`. Taken by **Back up now** (`snapshotNow`), before a
  snapshot restore, and on a schedule: the Worker's daily run at 07:00 UTC (`src/worker.ts`, deployed
  site only) calls `scheduledSnapshot`, which takes one if
  they are on and the last is due (daily or weekly).
- **Backups and snapshots hold rows, not stored images.** A file is backed up as its media row; its
  image files in storage are not, and no restore brings them back.
- **Settings > Backups** (`src/admin/Backups.tsx`) has a panel per copy (this site always, the other
  copy when one is set up): what it
  keeps (`settings.site.sync_backups_keep`, default 10, and `sync_snapshots` { enabled, every, keep },
  default 14; 0 keeps all; each copy's own, never synced or restored; older ones are deleted after
  each new one and when a number is lowered), and each backup to download, restore or delete.
- **Restore** (`restore`): a sync's backup undoes that sync on the copy holding it (the rows it
  overwrote go back, the rows it really added are deleted: those recorded as written, so a sync that
  stopped halfway doesn't take later rows with it); a snapshot puts every row it holds back
  (`snapshotPreview` counts them and the rows made since, which are deleted only with **Also delete**).
  Either way the current state is saved first (`before-restore`, never pruning the backup being
  restored), so a restore can be undone the same way, and the copy's own sync settings stay as they
  are. Rows to delete go first, so rows written back can't clash with them; rows are written 100 at a
  time (a failed batch is retried row by row, reporting only the rows that can't go back), and entries'
  terms and unpublished changes in bulk. Deleting a file deletes its media row only: its stored images
  stay. A form with submissions is never deleted (they would be cut loose from it), nor are rows other
  rows came to depend on (`removeAdded`): entries with ticket orders, waitlist places or emails of their
  own, or pages under them; terms entries still use, or with terms under them; files entries still
  feature. The report names them. A restore runs as a job, since it outlasts a request and must not be cut off halfway:
  `restoreBackup` queues it (`queueRestore`, a file under `jobs/` in that folder) and the jobs queue runs
  it once (`runRestore`, `src/worker.ts`; without a queue the request does) and clears the page cache; the screen polls `GET /api/admin/sync?restoreJob=<id>`.
- Mailing's contacts, campaigns, sends and clicks aren't synced or backed up, and a restore leaves
  them alone: a snapshot restore can't subscribe anyone again (see Mailing).
- A site with **Protect this site from syncs** on (`settings.site.sync_protected`, set on its own Sync
  tab) refuses every sync into it; settings syncs keep each copy's own protection.

## Search

`/search/?q=` lists the entries whose title, excerpt or body text (`entries.body_text`) have every
word at the start of a word (`ftsQuery`: each word as an FTS5 prefix, `"tow"*`; punctuation separates
words; case and accents don't matter), from the full-text index (`entries_fts`, an FTS5 table over
title, excerpt and body text kept in step by triggers, migration `*_entries_fts.sql`; listings with a
search, such as the event calendar's `?q=`, use it too). It is ranked by relevance (`Loader.queryRanked`:
`entry_search` gives the best 1,000 matches by BM25, title weighing 10, excerpt 4, text 1; newest
first on ties), in the types chosen under Settings > Search (`searchTypes`,
`settings.site.search_types`; all types with a page by default). It renders the `search` template
(migration 0021, `src/lib/content/search-template.ts`), else `index`; the page is noindex. The
`search-form` block is a GET form to `/search/`. On any page with a `.c-search-form`, the page shell
adds `public/assets/js/search.js`: live results from `GET /api/search?q=&limit=` (JSON, CDN-cached a
minute) under the field, an ARIA combobox (arrows, Enter, Escape closes only the list). `types=`
narrows the types (any with a page of its own) and `taxonomy=` adds that taxonomy's terms in use; a form
sets these as data attributes (`data-types`, `data-taxonomy`, `data-input`, `data-all`), and picking a
term fires a cancelable `c-search:term` on the form.

## Filters, map and navigation

- **Filters** (`collection-filters`, `src/render/c/filters.ts`): a search box with suggestions, a
  taxonomy's terms as a dropdown and chips, the count and Clear, for the page's listing (archive, term
  or search page). Its query-string names are settings (`searchParam`, `termParam`), so a site keeps
  its old links. `prepare` finds Filters blocks before the main query and `applyFilters` applies them
  (terms with their descendants) before the site's `archiveQuery`; `public/assets/js/collection-filters.js`
  refreshes the listing in place and fires `c-filters:change` ({ taxonomy, ids }). Listed entries whose
  `featured` field is set get `is-featured`.
- **Map** (`map`, `src/render/c/map.ts`, `public/assets/js/map.js`, Leaflet): pins for a type's
  published entries with coordinates (field names are settings), linking to each with its address;
  it can follow a Filters block's taxonomy, show featured entries only until filtered, leave out
  entries with a given field on, and take a centre, zoom and height.
- **Navigation** (`navigation`, `src/render/c/navigation.ts`, `public/assets/js/navigation.js`): the
  menu from Settings > Menu (`settings.options.menu_items`, fields in `src/lib/navigation.ts`): links,
  and panels with a sidebar (heading, links, intro, View all) and cards (entries picked, or the latest
  of a type; upcoming for events); a search button opening the search form; a menu button on small
  screens. Top-level links take the colour of where the block sits; the header part is the box panels
  span. **Site title** (`site-title`): the site's icon and name from Settings, with optional text
  before the name.

## Compose with Claude

`/admin/compose/` and the Compose panel in the page editor (docked beside the canvas; pin keeps it
open) run a saved conversation per page (`compose_sessions`): the editor adds documents (PDF, Word,
text, Markdown), images and videos (uploaded to the media library or multi-selected from it), video
links (YouTube/Vimeo) and web links, and asks for a page or changes. A new conversation can create any
type with a page of its own (`COMPOSABLE_TYPES`); Claude is told what the type is (its `describe`) and
fills its fields (those with a `compose` hint in the site config) from the materials in the plan's
`fields` (`src/lib/compose/entry-fields.ts`) when the entry is created, and later with `update_fields`
(just the changed fields). The editor applies updates to its sidebar form (`LivePage.setFields`),
saved with the page. `src/lib/compose/`: `materials.ts` keeps a registry with stable ids (image-1,
doc-1...; PDFs in the store's `compose/` folder, link text fetched once with private addresses refused (`private-address.ts`, a subnet list that also
reads IPv4 addresses written as IPv6; `scripts/checks/private-address.ts`),
images re-encoded to JPEG for Claude); `claude.ts` sends the whole conversation (prompt-cached for an hour: the system prompt and the conversation up to the latest message; the page's current sections and fields follow the cache breakpoint) and
Claude either replies or calls `build_page` with the complete page plan (`spec.ts`); `build.ts` turns
the plan into components in the house style. Blocks built by a conversation carry its id prefix, so
each update replaces only those, in place; hand edits are shown to Claude. With a block selected in
the editor, the panel targets it (or its whole section): Claude answers with `edit_block`;
`src/lib/compose/edit.ts` checks the replacement (known types, kept ids, materials resolved; markup cut
to inline formatting and links, addresses to web/mail/phone/site links and raw HTML never taken from
Claude: `safe-html.ts`, since materials can carry instructions). Claude can
also call `search_site` (`src/lib/compose/site.ts`) to feature the site's own entries. Needs
`ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`, default claude-sonnet-5-5).

A turn runs as a job (`src/lib/compose/job.ts`, table `compose_jobs`) because a build takes 30-90s or
more: `POST /api/admin/compose` reads the materials, queues the turn and puts `{ jobId, token }` on the
jobs queue (`src/lib/jobs.ts`; the Worker's consumer runs it, up to 15 minutes), answering 202; without
a queue it runs after the answer. The runner
claims the job with its token and writes progress and the result or error to the row; the panel polls
`GET /api/admin/compose?job=<id>`; a job silent for 3 minutes or older than 16 is reported as failed.
One turn at a time per conversation (409 otherwise) and two per person (429). Only the latest message
carries its selected block's JSON, and a block over 60,000 characters is refused (400) rather than cut.
Text materials count toward the budget of what is sent in full (`MATERIAL_BUDGET.text`).

## How rendering works

- `src/render/` turns a request into HTML strings: resolve the queried entry/archive and template
  (`page.ts`), `prepare()` all data (queries, media, parts, patterns, site block hooks), render items
  (`engine.ts` and the registry in `blocks/index.ts`, plus the site's blocks), then `texturize` the
  whole output (smart quotes, dashes).
- `src/lib/text/` (texturize, autop, entities), `src/lib/date-format.ts` (PHP-style date formats stored
  in content), `src/lib/media/image.ts` (image markup), `src/lib/permalink.ts`.
- CSS: `src/styles/site.css` (Tailwind, no preflight) imports the site's `tokens.css` and `theme.css`,
  `forms.css` and `events.css`; the page shell links the compiled file. Swiper (sliders)
  and Leaflet (maps) are served from the site, in versioned folders under `public/assets/vendor/`
  (`src/render/vendor.ts`), not a CDN, whose connection would hold up the page; their stylesheets are
  linked only on pages that use them (`ctx.assets`). Scripts are in `public/assets/js/`. A site serves
  its fonts the same way (files in `src/site/public/assets/fonts/`, `@font-face` in its `theme.css`, the
  first faces preloaded from its `render.ts` `head`).
- Pages are cached at the CDN through Astro's route cache (`cache` in `astro.config.mjs`, the Cloudflare
  provider; `src/lib/cache.ts`): fresh for 60s, then served stale for up to a week while they refresh,
  in the Workers cache, tagged `pages` (and each page's path). A successful admin write
  (POST, PUT, PATCH or DELETE under `/api/admin/`) clears that tag from the middleware
  (`cache.invalidate`; a 2xx answer, or the 303 a form post such as a bulk action answers with), so edits show at once; previews (and the email builder's event lookups), Claude drafting, accessibility marks,
  submissions, users, the attendee list and sync requests other than a sync into this copy or a restore don't
  (`changesPages`). A failed purge is logged and the edit shows within the minute. Pages that depend on
  who views them (see Members) aren't cached. Under `astro dev`
  nothing is cached. The first cover or hero image on a page loads at high priority (`optimizeImages`).
  Signed-in editors get an editor bar
  (`public/assets/js/editor-bar.js`, `/api/admin/me`) added in the browser, so cached pages stay shared;
  it asks only when the `site.signed_in` cookie is there (see Accounts).

## Media

Files are kept in the site's store (`src/lib/storage.ts`): one private R2 bucket, the `BUCKET` binding
(under `astro dev` a local bucket in `.wrangler/state`), with the folders `media/`, `compose/` and
`sync-backups/`; a Db carries it as `storage`, answering the calls the code made of Supabase Storage.
Scripts in Node reach the same local bucket through wrangler's platform proxy
(`src/lib/local-bindings.ts`; a script that uses it calls `closeLocalBindings()` before it ends), or the
deployed one over R2's S3 API with `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID` and
`STORAGE_SECRET_ACCESS_KEY` (set, these win in the Worker too: any S3-compatible store). The site serves
the media folder at `/media/<path>` (`src/pages/media/[...path].ts`: ranges and validators for video and
caching, cached a year at the CDN), refusing paths that try to leave it (`unsafeMediaPath`).
`scripts/copy-storage.ts` copies a site's files from another S3-compatible store (Supabase Storage's S3
endpoint, whose buckets are the folders, or another copy's bucket) into the store (resumable).

Uploads (`/api/admin/media`) are processed by `src/lib/media/process.ts` through an image engine
(`src/lib/media/engine.ts`: Cloudflare Images, the Worker's `IMAGES` binding; scripts in Node pass
sharp, `scripts/lib/sharp-engine.ts`; crops are cut as rectangles computed here, `focalRect`, so both cut
the same pixels): images over 2560px get
a `-scaled` copy as the full size, the standard sizes are generated (hard crops centred on the focal
point), and every file gets AVIF and WebP copies next to it. An SVG is stored as uploaded. It can carry script and
`/media/` is the site's own address, so every `/media/` answer carries `Content-Security-Policy:
sandbox` and `X-Content-Type-Options: nosniff` (`MEDIA_HEADERS`): a
file opened on its own can't run script, and images in pages are unaffected. `media.focal_point` ({x, y} in 0..1) is set
in the media library, with optional overrides per crop shape (`media.crop_focals`: square, 16:9, 4:3,
3:4; `src/lib/media/focal.ts`). Changes re-crop the cropped sizes; the point for the nearest shape
becomes `object-position` wherever the image is cropped to a ratio. Each shape can also use another
image instead (`media.crop_images`: { shape: { id, focal } }, set from the crop previews): wherever the image
is cropped to that shape (a block's aspect ratio, or the square thumbnail size), `mediaImage` shows the
other one, with the focal point set for that use (else its own) and its alt text (else this one's). `Loader.loadMedia` loads them with
the image (`crop_media`, one level). In the media library, with a replaced shape chosen, the panel
shows the other image and clicks set the focal point for that use (kept in `crop_images`; the other
image's own focal points are untouched). Images render as `<picture>` with
AVIF/WebP sources; `src/lib/media/modernize.ts` does the same for plain `/media/` images and inline
backgrounds in the final HTML. Existing media: `scripts/media-formats.ts` backfills the copies
(`processed_at` marks done).

Stored images are never deleted or overwritten by the CMS: the library has no delete, a restore that
removes a file's library row leaves its images in storage (backups hold rows, not images, so undoing
the restore finds them again), and an upload takes a name no library row or stored file already starts
with. Re-crops rewrite only the cropped sizes, which can be made again from the original.

## Forms

Form builder at `/admin/forms/` (`src/forms/FormBuilder.tsx`). Forms live in the `forms` table
(`src/lib/forms/types.ts`: fields with ids like `f1`, widths on a 12-column grid, conditional logic,
confirmation; editors read them, the site with its key). The markup comes from
`src/render/forms/form.ts` (styles `src/styles/forms.css`; `public/assets/js/forms.js` runs conditional
logic, US phone formatting and character counters; everything is validated on the server). Place forms
with the `form` block. Fields are white with black text by default and labels take the colour around
them; the Form, Subscribe and Newsletter blocks' **Form style** (`attrs.formStyle`,
`src/render/forms/style.ts`, `src/puck/FormStyle.tsx`) sets the form's background, border and text
(a background or border puts it in a padded box, `has-form-box`; its text colours headings and small
print too, `--heading-color`, `--form-muted`), field background, text, border, placeholder and focus
colours, field height, text size and border width (from fixed lists: `FIELD_SIZES`, `TEXT_SIZES`,
`BORDER_WIDTHS`), checkbox and radio colour, labels, button colours, and field and button corners, as
custom properties `forms.css` reads (`--form-input-bg`, `--form-input-text`, `--form-border`,
`--form-border-width`, `--form-input-pad`, `--form-input-size`, `--form-placeholder`, `--form-focus`,
`--form-check`, `--form-label`, `--form-radius`, `--form-button-radius`, `--button-bg`,
`--button-color`; palette colours, hex values and a few keywords only). Submissions POST back to the page (`src/lib/forms/submit.ts`: validation that
skips fields hidden by conditional logic, honeypot, limits (an answer is cut at 10,000 characters, a
form takes 20 submissions a minute, then answers 429), storage, notifications to the form's addresses or
`FORMS_ADMIN_EMAIL` / the config's `adminEmail`). A notification's email is built in the email builder
(`src/forms/EmailBuilder.tsx`, opened by Edit email): a Puck document (`Notification.design`) of email
blocks (Heading, Text, Button, Image, Form field (one answer, or all as a table), Payment (the
submission's items, total, status, provider, payment id and date; nothing without a payment), Events
(on a site with events: the next upcoming ones, of some categories or featured only, or events picked by
hand, each at its next date, past ones left out; with image, date, venue, excerpt and a link), Section,
Two columns, Divider, Spacer) that `src/lib/forms/email.ts` renders to email-safe HTML (tables, inline styles, a 600px
body, a preheader, columns stacking on phones; text kept to paragraphs, emphasis, links and lists), the
canvas included. Its Plain text tab (`Notification.text`, merge tags allowed) is the text part; empty,
the text is made from the HTML. Its Preview tab renders the email as sent (`renderNotification`, the
code that sends it) for a stored submission or sample answers (`/api/admin/forms/<id>/notification-preview`).
The Events block's events are loaded when an email is sent (`emailEvents`, `src/lib/events/email.ts`, by
block id onto the render's `events`, each query loaded once a minute), since the renderer is synchronous;
the canvas and the ticket emails' preview fetch them from `POST /api/admin/email-events`. A plain text of
one's own doesn't list them. The builder itself knows nothing of forms: its caller passes a kit (`EmailKit`: the data block's
options, merge tags, canvas stand-ins, preview); a notification's is `formEmailKit`
(`src/forms/form-email.ts`), ticket emails have their own.
**Templates** (the builder's Templates panel, `src/forms/EmailTemplates.tsx`; table `email_templates`,
editors only, migration `*_email_templates.sql`; `src/lib/email-templates.ts`): saved designs with their
plain text, per kit (`templates` in `EmailKit`: `mailing` for campaigns and digests, `form`, `ticket`),
to save the email as, save over, start from (Use) or delete. A template can be the default for one kind
of email (`default_for`, unique; `TEMPLATE_DEFAULTS`): new campaigns, digests, forms and form
notifications start from theirs (`defaultTemplate`), and a ticket email nobody designed is sent from
its kind's (`ticket:<kind>`). Not synced or backed up.
Notifications from before the builder send their message as before until opened there. Mail goes out through
Cloudflare Email Service when the Worker has its `EMAIL` binding (`"send_email": [{ "name": "EMAIL" }]` in
`wrangler.jsonc`; the sender's domain onboarded under Email Sending), else over SMTP
(`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_SECURE`, or one `SMTP_URL`); sender `MAIL_FROM`,
default `mailFrom` in the site config (`src/lib/forms/mail.ts`).

Payments: a form's Payment tab (`FormDef.payment`: Stripe or Square, currency, a description with merge
tags, the email field for the receipt; shown, with the Pricing fields, only when a provider has its keys
or the form already takes payment; the provider picker only when both do) and **Product** fields (`type: 'product'`; `priceMode` one price,
a choice of priced options (`choices[].price`, dropdown or radio) or an amount the visitor enters
(`min`/`max`); optional quantity up to `maxQuantity`, posted as `f1[qty]`). Their answers become line
items and a total (`src/lib/forms/payment.ts`; a product hidden by conditional logic isn't charged);
the form shows the total above the button, kept live by `forms.js`, while the server's total is what is
charged. A submission with a total is stored as pending (`form_submissions.payment`, `SubmissionPayment`)
and the visitor goes to the provider's hosted checkout (`src/lib/forms/checkout.ts`, through the shared
payments code; see Payments below). They come
back to the form's page with `?form_payment=<submission id>.<token>` (uncached): once paid, the form's
confirmation; otherwise the form again with their answers and a note. The webhooks (`formsWebhook`)
catch visitors who don't come back.
Neither the return nor a webhook is trusted as to the outcome: the site asks the provider where the
checkout stands, and the update that marks a submission paid is the one that sends its notifications,
so they go once, after payment (`{payment_total}`, `{payment_id}`, `{payment_summary}` merge tags and
the email builder's Payment block; `{all_fields}` adds the total). A total of zero is sent at once
without checkout; under 50 cents is refused. The builder shows which providers are set up
(`/api/admin/forms/payments`). Submissions show each payment's status, items and payment id; the CSV
export adds payment columns.

### Payments

Forms and tickets take payments through the same code, `src/lib/payments/`: `stripe.ts` (Checkout
Sessions) and `square.ts` (payment links, an order each), over their REST APIs with no SDK, behind one
`Provider` interface (`create` a hosted checkout, `check` where it stands, `close` an unpaid one,
`refund`, `refunded`, `webhookEvent` with the signature checked, `parseEvent` turning it into a
`PaymentEvent` both features read: a checkout to look at again, or a payment's refunds; `returnLag`, a
wait before a second look at a checkout the buyer just came back from), `providerStatus()` for the admin
screens (configured, test or sandbox keys, the variables still missing), `pickProvider` (the provider
a payment goes through: the one a form or Settings > Tickets chose if its keys are set, else the one
that has them) and `money.ts` (`CURRENCIES`,
`formatMoney`, `toMinor`, `MIN_CHARGE`; safe in the browser). A checkout's `ref` is the Stripe session
or Square payment link, `order` Square's order (which its payment is on). One webhook per provider
serves both features, `/api/payments/stripe` and `/api/payments/square`
(`src/pages/api/payments/[provider].ts`): it checks the signature and hands the parsed event to
`formsWebhook` and `ticketsWebhook`, each ignoring checkouts that aren't its own and asking the provider
where a checkout stands. Provider-specific code stays in `src/lib/payments/`. Keys are environment
variables, never settings (settings sync between copies): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT`, `SQUARE_WEBHOOK_SIGNATURE_KEY`,
`SQUARE_WEBHOOK_URL` (`.env.example`). The email builder's **Payment** block (`paymentTable` in
`src/lib/forms/email.ts`, offered by a kit's `payment`) shows a payment's items, total, status,
provider, payment id and date in form notifications and ticket emails alike, as does `{payment_summary}`.

## Events

`src/lib/events/model.ts` loads events (occurrences included) as `CalEvent`s;
`src/render/events/calendar.ts` renders the `events-calendar` block, `event-calendar.ts` the month
grid / list block for any page (`public/assets/js/event-calendar.js`) and `single.ts` the
`event-details` block (styles `src/styles/events.css`). URLs: `/events/` (upcoming list),
`/events/past/`, `/events/month/<Y-m>/`, `/events/day/<Y-m-d>/`, with `?q=` search and `?from=<Y-m-d>`.
Feeds (`src/lib/events/ical.ts`): `/events.ics` (same `q`, `month`, `past` filters) and
`/event/<slug>/[<Y-m-d>/]event.ics`; they describe `SITE_TZ` from the runtime's time zone data
(`src/lib/events/timezone.ts`) and are cached at the CDN like pages. The month and day views link no
further than the first and last event (and today); a view outside that range is noindex.

Events is an optional feature, off until an admin turns it on (Settings > Events:
`settings.site.events.enabled`; `eventsOn`, `src/lib/events/on.ts`; migration `*_events_setting.sql`
turned it on for sites that already had events). The core supplies the `event` and `venue` types and the
`event_category` taxonomy (`src/lib/events/types.ts`, added to the config by `withEvents` in
`src/lib/site`). A site extends them with its config's `events` (`EventsConfig`: `event` and `venue`
take any type option plus `fields`, added to the core's or replacing one by key, and `removeFields`;
`category` the taxonomy's options; `extendType`), or lists its own `event`, `venue` or `event_category`
to replace one whole (the calendar views stay under `/events/`). The core reads these field keys: on events `venue`, `cost`,
`website` and `schedule`; on venues `address`, `city`, `state`, `zip`, `country`, `phone` and `website`.

Off, nothing is deleted, but the admin hides events, venues and event categories (Content's tabs,
Taxonomies, Settings > Types and Search; `showsType`, `showsTaxonomy`) and the site shows none:
`resolve` answers Not found for the event listing, calendar views, event pages and occurrences and the
term pages of taxonomies that list events; the feeds, ticket checkout, waitlist and availability
endpoints answer 404; the loader's scope leaves event entries out (`noEvents`: collections, search,
menus); `EVENT_BLOCKS` render nothing (a note in the editor) and load nothing; email Events blocks list
none; and the hourly ticket emails don't run. The editor doesn't offer event and ticket blocks, the
email Events block or the event type in collections and Compose, and the admin hides Tickets and
Settings > Tickets. The checkout's return and the payment webhooks still work for orders already
placed. `npm run seed` adds the event templates, a sample event and venue, and events on the home page
and in the header only while Events is on.

The default time zone (`SITE_TZ`) is set by admins under Settings > Events (`settings.site.timezone`;
the config's `timezone` is the default); an event can choose its own (`fields.timezone`, in its
sidebar). It is a live binding in `src/lib/site`: the middleware and compose jobs
refresh it from the settings (`src/lib/site/timezone.ts`, cached a minute), admin pages pass it to
the browser as `window.__siteTz`. Changing it moves events that were on the old timezone to the new
one with their local times kept (`moveEventsToTimezone`); events with their own timezone stay.

Recurrence (`src/lib/recurrence.ts`): an event's rule is stored in `fields.recurrence` and edited in
the event sidebar. Occurrences are virtual entries (negative ids, own `event_start`/`start`/`end`) at
`/event/<slug>/<Y-m-d>/`; `/event/<slug>/` redirects to the next one. `Loader.query` expands series
only when a recurring event exists (for an upcoming list, only series and events still to start are
loaded). A series is expanded to the horizon (two years ahead); of a long
one the newest 1,100 occurrences are kept. Saving an event rewrites the `start`/`end` fields the views read.

## Tickets

While Events is on, an event sells tickets or takes free registrations when it has ticket types (its
settings, Tickets: `fields.tickets`, `src/puck/TicketsForm.tsx`; read with `ticketsOf`, whose `enabled`
is derived from the types, `src/lib/tickets/config.ts`; there is no switch of its own):
ticket types (name, description, price in cents, capacity, most per order, sales window as local times
in the event's timezone, hidden for past ones), the event's capacity (per date for a recurring event),
most per order, phone (off, optional, required), address (off, for paid orders, always), the event's own
questions (asked once per order) and a waitlist (`off`, `auto`, `manual`). Settings > Tickets
(`settings.site.tickets`, `ticketSettings`, `src/admin/TicketSettings.tsx`): the payment provider (Stripe
or Square, offered only when both have keys in the environment, `providerStatus`; with one, it is used;
with neither, only free tickets, and the payment settings are hidden), currency, how long an unpaid order holds its
tickets (30-120 minutes), and the emails with the reminder's and follow-up's timing.

- Rendering: `src/render/c/tickets.ts`. The Event details block shows the form below the content and a
  Tickets box in its sidebar, unless the page has a `tickets` block for its event. The `tickets` block
  goes on any page or template: it shows the event it names (`attrs.event`, and `attrs.date` for one
  date of a recurring event, else its next; with the event's name and date over the form), else the
  page's own event (`prepareTicketsBlock`); a page can have several. An event that doesn't sell tickets
  (Tickets off, or no ticket types) shows nothing. In the editor the block shows the full form: with no
  event that sells tickets, sample ticket types and a note saying why, when the block is part of what is
  being edited (the page's own content, or a template being edited; a template's block on such an
  event's page shows nothing, as on the site). The form posts the page it is on (`page`): the order and a
  waitlist place keep it (`ticket_orders.page`, `ticket_waitlist.page`), and the buyer is sent back
  there, to the section's anchor (`ticketsAt`: `#tickets` on the event's own page, else
  `#tickets-<event id>`); emails' `{order_link}` goes there too (a waitlist's: the tickets where they
  joined). `prepareTickets` loads what's taken (`ticket_sold`) and, with `?order=<token>`, the buyer's
  order (`ticket_order_status`; both read with the site's key), shown in its event's section.
  `?tickets=<reason>&event=<id>` shows a checkout's outcome in that event's section.
  Pages with either are never cached. `public/assets/js/tickets.js` adds the total, the address only
  for paid orders, and what's left now (`GET /api/tickets/availability`).
- Orders (`ticket_orders`, editors read, the site writes with the service key; `src/lib/tickets/orders.ts`):
  `POST /api/tickets/checkout` checks the order and holds its tickets in `ticket_order_create`, which takes
  counts paid orders and unexpired holds against the capacities in the same statement that inserts the
  order (D1 runs one statement at a time, so two orders can't both take the last tickets).
  A free order is paid at once; a paid one goes to Stripe Checkout or a Square payment link (the shared
  payments code, see Forms > Payments). `/api/tickets/return` checks the payment with the provider and
  shows the order; the webhooks (`ticketsWebhook`) confirm payments, expiries and refunds. A refund
  is counted while pending; the refunded total is the provider's (`refunded`, read again on each refund
  event), so one that fails comes off the order, and a fully refunded order is paid again (`recordRefund`). `markPaid` is idempotent and sends the confirmation
  once. An expired hold that is paid anyway (a Square link used late) is still marked paid.
- Attendee list (`/admin/tickets/`, `/admin/tickets/<id>/[?date=]`; actions `POST /api/admin/tickets`,
  `GET /api/admin/tickets/attendees.csv`): check-in, resend, cancel (unpaid, free or fully refunded),
  refund (admins; part or all, at the provider; all of it frees the tickets), the waitlist with Notify.
  Its writes don't clear the page cache.
- Waitlist (`ticket_waitlist`, one place per email per event and date; `POST /api/tickets/waitlist`):
  shown when every type on sale is sold out. `notifyWaitlist` emails people in order as far as the free
  tickets go, counting those told in the last day as still deciding; `auto` runs it after a cancellation
  or refund and hourly. Buying moves a person to `bought`.
- Emails: confirmation, reminder (hours before), follow-up (hours after, for up to three days),
  waitlist, and the admin's copy of each order (`notify`). Each is a subject, an email builder design
  and an optional plain text (`TicketEmail`), with ticket merge tags (`MERGE_TAGS`) and an Order details
  block (`ORDER_DETAILS`: the summary table, date, venue, code, tickets, total, answers, the buyer's
  contact), and the Payment block (a paid order's payment; nothing for free orders). Sent: the event's own (table `ticket_emails`, its attendee list > Emails,
  `src/admin/TicketEmails.tsx`; kept out of the event's fields so editor saves can't overwrite it), else
  the site's, else the default template for that kind (`ticket:<kind>`, see Forms), else `DEFAULT_EMAILS` (`emailToSend`). `src/lib/tickets/email.ts` renders them with the
  forms' renderer (`renderEmail`); the builder's kit is `src/admin/ticket-email.ts`, its preview a sample
  order rendered in the browser. The Worker runs `sendDueTicketEmails` hourly (`src/worker.ts`,
  deployed site only): reminders, follow-ups, expired holds, auto waitlists. Links use `SITE_URL`, else
  the request's address.
- Orders, waitlists and events' own emails aren't synced or backed up: they stay on the copy where they were made.

## Members

An optional feature, on under Settings > Members (`settings.site.members`, `memberSettings`,
`src/lib/members/config.ts`, `src/admin/MemberSettings.tsx`): levels (id and name), sign-ups (`off`: admins
add members; `approve`: visitors sign up and wait for an admin; `open`: they join at once, at
`signupLevel`) and the message members-only things show to everyone else. Off, nobody counts as a
member (`renderRequest` drops the viewer's membership), and the editor offers no member blocks.

- A member is an auth user with a row in `members` (level, status `pending`/`active`/`suspended`,
  `expires_on`, notes; migration `*_members.sql`); their profile stays role `viewer`, so no admin access.
  `isActive`: active and not past its expiry. Members aren't synced or backed up (accounts are per copy);
  the levels are, with the settings.
- **Members only pages**: an entry's settings (Members) set `fields.access` ({ members, levels }; `access`
  is a reserved field key), applied when it is published. The site's loader (`LoaderScope`, `visibleTo`
  in `src/lib/data.ts`) leaves them out for everyone but members of those levels and editors: lists,
  search, feeds, term counts and email Events blocks. Their address still resolves: `Loader.lockedEntry`
  reads its title, excerpt, featured image, template, SEO and access only (`Entry.locked`), and the page
  renders with its Page content block as a sign-in prompt (`lockedContent`, `src/render/c/members.ts`).
- **Members only block** (`members`, a container): its blocks for members (of `attrs.levels`), editors
  and the editor's canvas; for everyone else `attrs.message` (else the settings' message) and a sign-in
  link, or nothing (`attrs.hide`). The database API is closed to everyone but editors (see Database
  access), so the page's stored content can't be read around it.
- **Personal pages**: what depends on the viewer (a locked entry, a Members only or Member account
  block, tickets with member prices) sets `RenderCtx.personal`. The catch-all route then doesn't cache
  the page (`private, no-store`) and, for a visitor with a sign-in cookie, renders it again as them
  (`asViewer`: `viewerOf` in `src/lib/members/viewer.ts` looks the session up (`sessionUser`,
  `src/lib/auth`) and reads the profile and membership as the server; the second render's loader scope carries them,
  `RenderCtx.viewer`). Pages
  that don't depend on the viewer render once, anonymously, and stay cached and shared. Previews
  render as an editor.
- **Account page** (`ACCOUNT_PATH`, `/account/`): a page with that address, else a built-in one holding
  the **Member account** block (`member-account`): sign in, forgot password and (when sign-ups are on)
  create an account; signed in, the member's name, level, status and expiry, change password and sign out.
  Endpoints in `src/pages/api/members/`: `login` (back to a `next` path on the site; an address not yet
  confirmed is refused and sent a new link), `signup` (an account and a membership, emailing the site's
  admin address), `logout`, `forgot` and `password` (a token's, which signs them in, or the signed-in
  member's); `me` answers the **Member sign-in link** block (`member-link`), whose label
  `public/assets/js/member-link.js` switches in the browser, so pages with it stay cached. Invitations
  and password links (see Editor) land on `/account/?view=password&token=`, where the block shows the
  form. Sign-ups confirm their address first (`AUTH_CONFIRM_EMAIL`, on unless `false`): the link,
  `/account/?confirm=<token>` (a day), confirms it and signs them in (`confirmAddress`; a visitor
  already signed in carries on without an error); with it off they are signed in at once.
- **Members screen** (`/admin/members/`, admins; `POST /api/admin/members`): members by status (waiting
  for approval first), each one's name, level, status, expiry and notes; Approve, Resend invitation (to someone invited who hasn't set a password), Send password link,
  Remove (the membership, and the account unless it edits the site), and Add a member (an existing
  account joins; a new address is invited to set a password on the account page). The Users screen
  leaves members out.
- **Tickets**: a ticket type can have members' prices by level (`memberPrices`, in cents) and be for
  members only (`membersOnly`, of `levels`; none: any level), set in the event's Tickets settings
  (`MemberPricing`, `src/puck/TicketsForm.tsx`). `priceFor` and `mayBuy` (`src/lib/tickets/config.ts`)
  decide; the form shows a member their price ("Member price") and everyone else what members pay and
  a sign-in link, and members-only types as "Members only". The checkout reads the buyer's session and
  charges the same way (`startCheckout`'s `member`; a members-only ticket without a membership goes
  back with `members-only`), and the order records `member_id`.

## Mailing

An optional feature, on under Settings > Mailing Lists (`settings.site.mailing`, `mailingSettings`,
`src/lib/mailing/config.ts`, `src/admin/MailingSettings.tsx`): mailing lists people sign up to, campaigns
and a weekly digest sent through Mailgun from a marketing subdomain, and each email's deliveries, opens
and clicks. The site's other email (form notifications, tickets, confirmations) goes over SMTP as before.
Off, the Mailing Lists screen (`/admin/mailing-lists/`), its blocks and pages are gone (`mailingOn`). Lists,
subscribers and segments are for anyone, members or not. Contacts, campaigns, sends, clicks
and Mailgun's events aren't synced or backed up (they stay on the copy where they were made, so a restore
never subscribes anyone again); the settings are, with the others. Migration `*_mailing.sql`.

- **Settings**: the sender's name and the local part of its address (`fromLocal`, at `MAILGUN_DOMAIN`),
  reply-to, the postal address every email carries (nothing sends without it), the consent wording, the
  lists offered to members (`memberLists`), link tracking and UTM defaults for new campaigns, the
  complaint and bounce rates that pause sending, and **Subscriber fields** (`fields`, `ContactField`:
  label, key from it, type text, number, date or choice with options; `cleanFields` leaves out keys that
  are built-in tags, `RESERVED_FIELD_KEYS`; a saved field keeps its key).
- **Mailgun** (`src/lib/mailing/mailgun.ts`, REST, no SDK; keys in the environment, never settings):
  `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION` (`us`, default, or `eu`),
  `MAILGUN_WEBHOOK_SIGNING_KEY`, `MAILGUN_TEST_MODE` (`o:testmode`; Mailgun accepts and delivers nothing),
  `MAILGUN_API_BASE` (a stand-in server, for tests). Without keys a batch goes, one address at a time,
  to a mail catcher on this machine (an SMTP host of 127.0.0.1 or localhost), else is only logged.
- **Signed links** (`src/lib/mailing/tokens.ts`): a contact's id with an HMAC per purpose (`manage`:
  preferences and unsubscribe; `confirm`; `click`; `seen`), keyed by `MAIL_LINK_SECRET` (else one made
  from `AUTH_SECRET`; changing it breaks links already sent). No tokens are stored.
- **Data**: `mail_lists` (name, description, `public`, sort); `contacts` (email lowercased and unique,
  `first_name` and `last_name` (`name` is the two joined, a generated column; migration
  `*_mailing_name_parts.sql` split the names already kept at their first space), attributes, status `pending`/`subscribed`/`unsubscribed`/`bounced`/`complained`: anything but
  subscribed means no marketing mail; the consent's source, wording, time, address and confirmation);
  `contact_lists` (per list: `pending`, `subscribed`, `unsubscribed`); `mail_suppressions` (SHA-256 of
  addresses erased, bounced or complained, never mailed again without a confirmed sign-up); `campaigns`,
  `campaign_batches`, `campaign_sends`, `campaign_links`, `link_clicks`, `mail_events`, `mailgun_tokens`,
  `digests`, `mail_segments`; contacts' `tags` (lowercased, `cleanTags`) and `attributes` (fields to
  segment by, keys from `fieldKey`). Editors read; admins change lists and contacts; editors write segments; editors write campaigns only as drafts and
  digests only while off (`src/lib/db/policies.ts`), and the send routes check the role too. `mail_audience` (a campaign's
  recipients: subscribed, on any of its lists, not suppressed, optionally only active members of some
  levels or only non-members, matched by address), `mail_still_subscribed`, `mail_claim`,
  `mail_digest_claim` (server only) and `campaign_stats` (editors), in `src/lib/db/functions.ts`.
- **Segments** (`src/lib/mailing/segments.ts`, `src/admin/SegmentEditor.tsx`, `/api/admin/mailing/segments`;
  migration `*_mailing_segments.sql`): saved rules, all or any of them, that pick some of the people on
  a campaign's or digest's lists (`segment_id`; `mail_audience`'s `p_segment`): on a list, tagged, a
  field set, equal to or containing a value, an active member (of some levels; offered while Members is
  on), signed up, opened or clicked (people's, not machines') in the last N days, or signed up from a
  source; each can be turned round. `cleanRules` keeps them to known shapes; the database evaluates
  them (`mail_rule`). The editor shows who matches now (subscribed, on any list) with a count. A segment
  a campaign or digest names can't be deleted, so no audience widens on its own.
- **Tags and fields**: set on a contact's page (the site's fields as inputs of their type, `cf_<key>`;
  other fields as key and value); Add a contact takes first and last name and tags; an import reads
  `first name`/`last name` (or `name`, split), its `tags` column (separated by `;` or `|`) tags each
  person, a column named like one of the site's fields (key or label) fills it, its value checked
  against the field's type (`fieldValue`), and other columns become fields of their own (merged into a
  known contact's); the export has first and last name and a column per field, so it imports back. A
  Subscribe block asks first and last name (`showName`) and any of the site's fields (`attrs.fields`),
  and can tag its sign-ups (`attrs.tags`); fields and tags are added only to a new or unconfirmed
  address, so a form can't change someone subscribed. The segment editor offers the site's fields
  with their options.
- **Signing up** (`src/lib/mailing/contacts.ts`): always confirmed by email (double opt-in, over SMTP,
  at most 3 confirmation emails a day to one address; 30 sign-ups a minute site-wide). The **Subscribe**
  block (`subscribe`, `src/render/c/mailing.ts`; Mailing category in the editor) posts to
  `/api/mail/subscribe`: email, optional name, the public lists it offers (ticked when there are
  several), the consent wording and a honeypot; only public lists and the member lists are taken. The
  confirmation link opens the preferences page, whose button (a GET never confirms: mail scanners
  follow links) posts to `/api/mail/confirm`. Admins add people who agreed elsewhere (Add a contact,
  Import a CSV, Add members to a list), naming how they agreed; those who unsubscribed, bounced,
  complained or were erased are skipped. Admins can **Resend confirmation** (the Subscribers tab or a contact's page, `resendConfirmation`) to anyone with lists still waiting, within the same daily limit, never to a bounced or complained address. Unconfirmed sign-ups are deleted after 30 days.
- **Pages**: `/subscribe/` (a Subscribe block), `/unsubscribe/` and `/email-preferences/` (the **Email
  preferences** block, `mail-preferences`, `view` unsubscribe or preferences): a page with one of these
  addresses takes its place (`MAILING_PAGES` in `src/render/page.ts`). The preferences block shows whose
  subscription the signed link (`?t=`, `?confirm=`) is for, or the signed-in visitor's; it loads through
  a server hook (`src/render/hooks.ts`, registered by `src/lib/mailing/page-data.ts`, which the
  middleware imports) because the render code also runs in the editor's browser bundle. Its pages are
  never cached. `/api/mail/preferences` saves lists (resubscribing an unsubscribed address, never a
  bounced or complained one); `/api/mail/unsubscribe` takes the page's button and mail apps' one-click
  POST (RFC 8058, `List-Unsubscribe=One-Click`), from anywhere: Astro's `security.checkOrigin` is off and
  the middleware does the same check, except for that route.
- **Members**: with Members on, member sign-up offers the member lists (unticked; a confirmed sign-up
  like any), the account page (Member account block) shows the member's lists to change, and campaigns
  and digests can go to only members (of some levels) or only non-members.
- **Campaigns** (`/admin/mailing-lists/`, `src/admin/CampaignEditor.tsx`, `/api/admin/mailing/campaigns`):
  name, subject, sender, lists, members audience, link tracking, UTM, and the email, designed in the
  email builder with the mailing kit (`src/admin/mailing-email.ts`: merge tags `{first_name}`, `{last_name}`, `{name}`, each of the site's fields as `{<key>}`,
  `{email}`, `{site_name}`, `{unsubscribe_url}`, `{preferences_url}`, a fallback after a bar,
  `{first_name|there}`; a Subscriber block; the **Entries** block, the site's latest entries of some
  types and terms, members-only ones left out, `src/lib/mailing/entries.ts`; and Events). Editors save
  and send tests (to themselves and 5 more, marked [Test], links untracked); admins send, schedule (a
  time in the site's time zone), pause, resume, cancel and approve, after a confirmation that counts
  who it goes to now. Writes there don't clear the page cache; lists' do.
- **Rendering** (`src/lib/mailing/render.ts`): the email builder's renderer, each tag a Mailgun
  recipient variable (`%recipient.v1%`, escaped for HTML as `v1_h`, plain in the subject and text;
  values escaped once, by the site), and a footer under the design that it can't remove: why they get
  it, the name and postal address, unsubscribe and preferences links. Images are absolute addresses.
  Nothing goes out without that footer: `footerProblem` checks the HTML and the text for the
  recipient's unsubscribe and preferences links when a campaign is frozen, before each batch, and
  before a test send, and refuses to send without them.
- **Sending** (`src/lib/mailing/send.ts`): a job, which needs `SITE_URL` (outside `astro dev`): its
  links are made without a request (`mailOriginProblem`; sends, schedules, approvals and tests are
  refused without it). `startSending` claims the campaign (`mail_claim`, a
  token) and puts it on the jobs queue (`src/lib/jobs.ts`; in-process without one). A run
  freezes the campaign first (its HTML and text, tracked links, every recipient in `campaign_sends`, in
  batches of up to 1,000), then per batch re-checks who is still subscribed (the rest `dropped`), marks
  it `attempting` and posts it to `/v3/<domain>/messages` with each address's variables, the tags
  `campaign-<id>` and `batch-<id>`, `v:campaign_id`, opens tracked by Mailgun (clicks by the site) and
  `List-Unsubscribe` / `List-Unsubscribe-Post` headers. 429 and 5xx back off (2, 4, 8, 16s), then wait
  for the next run; another 4xx fails the campaign. A request with no answer leaves the batch `unknown`:
  the next run asks Mailgun's events for the batch's tag, resends only if none show after 10 minutes,
  once, and otherwise pauses the campaign. A run stops starting batches after 12 minutes and lets go;
  pausing or cancelling stops it before the next batch.
- **Scheduler**: the Worker's run every 5 minutes (`src/worker.ts`, deployed site) runs `runDue`:
  scheduled campaigns that are due, sends a run let go of, digest issues waiting for approval past their
  time (cancelled, the admins told), and digests due. The nightly run (06:20 UTC) runs `runNightly`:
  Mailgun's bounces, complaints and unsubscribes reconciled with the contacts, then events and clicks
  older than 90 days, webhook tokens older than a day and unconfirmed sign-ups pruned.
- **Weekly digest** (`src/lib/mailing/digest.ts`, `src/admin/DigestEditor.tsx`): a design, lists,
  audience, a weekday and time in the site's time zone, and a mode: `review` (each issue made at its
  time waits `review_hours` for an admin's approval, else is cancelled) or `auto`. Once its time this
  ISO week has passed (by less than a day; `mail_digest_claim` makes each week's issue once) the issue
  is made as a campaign (`digest_id`, `issue_key`), its Entries blocks set to "only new" listing what
  was published since the last issue went out (`since`), and skipped when it has fewer than `min_items`
  entries and events. `{week_of}` is the Monday of its week. Make an issue now and Send me this week's
  issue are on its screen.
- **Webhook** (`POST /api/mailgun/webhook`, `src/lib/mailing/webhook.ts`): the signature (HMAC-SHA256 of
  timestamp and token, within 5 minutes; each token once, `mailgun_tokens`), every event logged once by
  Mailgun's event id (`mail_events`), then: delivered, opened (people's only: `openVerdict` leaves out
  mail scanners and privacy proxies such as Apple's), failed (permanent: bounced, suppressed),
  complained (suppressed, never mailed again), unsubscribed. A bounce or complaint runs the health
  check (`src/lib/mailing/state.ts`): once a campaign has 500 deliveries, a complaint rate or bounce
  rate past the settings' pauses sending site-wide (settings key `mailing`, not synced), every campaign
  that is sending, and digests, and emails the admins; an admin resumes it on the Mailing screen.
- **Link tracking** (`src/lib/mailing/tracking.ts`, `clicks.ts`): each web link becomes
  `/m/c/<link>/<recipient token>`, which records the click and redirects to the link's stored address
  (never one from the request; HEAD too, never cached); one hidden link per email is followed only by
  machines. Links to the site itself get `#mc=<signed click id>`, and `public/assets/js/mail-seen.js`
  (on every page while Mailing is on) reports the visitor's first interaction (`POST /api/mail/seen`),
  which makes the click a person's. A send's clicks are judged together, again with each new click or
  delivery (`judge`): machine for a HEAD request, the hidden link and clicks within 2 minutes of it, a
  scanner's user agent or address range, 3 different links within 5 seconds, or a click within 10
  seconds of delivery with no later sign of a person; human with an interaction; likely human
  otherwise. Each verdict keeps its reasons. Addresses are kept as their /24 or /48 network only.
  A campaign's numbers (`campaign_stats`): delivered, bounce and complaint rates, opens (indicative),
  people who clicked (human and likely human), confirmed, machine clicks, unsubscribes, and each link's;
  Compare with Mailgun's totals reads the campaign tag's stats.
- **Subscribers** (the Subscribers tab: every contact; admins change, editors read): search and
  filters (status, list, tag), a list's subscribers (Lists > View subscribers), a campaign's recipients
  with how each email went (its page, filtered by delivered, opened, clicked, bounced...), each contact's consent, lists,
  notes, sends and clicks with their verdicts, Unsubscribe, **Erase** (deletes the contact, their sends
  and clicks, keeps the hash, adds them to Mailgun's unsubscribes) and Export as CSV (formulas guarded).

## Editor

`/admin/` (a session, see Accounts; `profiles.role`: editor, admin, or viewer = no access). Editors manage content,
templates, media, forms and compose; site settings and users (`/admin/users/`: roles, invitations, Resend invitation for those invited who haven't set a password, signed in by a link or not, `src/lib/admin/invite.ts`; Delete, not your own account: the profile and any membership go, what they made stays with its author left empty) are
for admins, as is the redirects API (`ADMIN_ONLY` in `src/middleware.ts`; settings writes are admin-only in the policies,
`src/lib/db/policies.ts`; the users API checks the role itself too, since making accounts is the server's). Editors are trusted with the
site's markup: the HTML block (and an Embed block's HTML) is put on the page as written, at the admin's
own address, so a script in it runs as whoever views the page, an admin included. `src/puck/Editor.tsx` renders blocks through the same string renderer inside Puck
(`BlockView.tsx` parses HTML to React; slots become the block's inner wrapper element). The left rail
has Blocks (and Patterns), Outline and an accessibility check (`A11yPanel.tsx`). Problems a person has to judge
(warnings, and text over an image, which is always a problem since its contrast can't be measured) can be
marked as checked with a note; the marks live in the document's root props (`a11y`), save on their own as
they are made (`PUT /api/admin/a11y`; not an unsaved edit), and lapse when the text or image they were about changes. Blocks with `types`
are offered only on those entry types. Pages whose template has no `post-content` are edited in layout
mode: the template document itself. In content mode the template around the page's content shows as it
will on the site; for admins, hovering one of its blocks, a template part or a pattern outlines it with a
link to edit that template, part or pattern in a new tab (`markSources`, `SourceLinks`; globals get none).

### Accounts

Accounts are the site's own (`src/lib/auth`, server only), kept by Better Auth in `users`, `sessions`,
`accounts` (a password) and `verifications` (one-time values; migration `*_auth_tables.sql`, which
copied Supabase Auth's users with their ids, passwords and open invitations). Better Auth's routes
aren't mounted: the site's endpoints call it (`signIn`, `signOut`, `sessionUser`, `createUser`,
`setPassword`, `passwordToken`, `setPasswordWithToken`, `confirmToken`, `confirmAddress`) and send its
emails themselves (`src/lib/auth/mail.ts`, over SMTP). The session is a signed cookie,
`site.session_token` (seven days, renewed as it is used); `AUTH_SECRET` signs it and the site's links.
Pages' scripts can't read it, so signing in also sets `site.signed_in=1` (no secret; `redirectWith`, cleared
on signing out), which the editor bar and the member sign-in link check before asking who is signed in.
Every account has a profile, made with it (`databaseHooks`); sign-ins set `users.last_sign_in_at`.
Passwords are scrypt; those carried over from Supabase Auth are bcrypt, checked as such and rehashed
on the next sign-in. Editors and admins sign in at `/admin/login/` (`/api/auth/login`); a password
link (Forgot password, `/api/auth/forgot`) and an opened invitation both lead to
`/admin/set-password/?token=` (a one-time token, an hour; members: the account page), where setting the
password confirms the address, spends any invitation and signs in. Without SMTP a visitor's own request
gets the same answer and the link is only logged; admins are shown the link to pass on.

Invitations (Users and Members; `src/lib/admin/invite.ts`) last `INVITE_DAYS` (7). The account is made
with no password and the link, `/api/auth/invite?t=`, is signed with a key made from `AUTH_SECRET` and
names the account, its expiry, where it leads (set-password or the account page) and the account's
open invitation (`users.invite`, a random value): a new invitation replaces it and setting a password
clears it, so older and used links stop working. Opening it makes the one-time password token.
`awaitingPassword` lists accounts with an open invitation, or invited with no password, for the
screens' "Invited" rows and Resend invitation.

Admin colors and logo (Settings > Admin, `settings.site.admin_theme`, `src/lib/admin-theme.ts`): accent,
text, menu bar and background, and a logo for the menu bar in place of the site name (or beside it,
`logo_name`; a media id, whose URL the settings API makes from the media row), previewed as they are
picked. Admin styles use only the role tokens
`--color-admin-*` (`src/styles/tailwind.css`; Tailwind colors like `text-admin-muted`), never hex
values; `src/layouts/AdminTheme.astro` writes the saved colors and the shades made from them (darker
accent, soft background, the bar's text) on every admin page, and Puck's blue scale is made from the
accent (`src/styles/admin.css`). The admin uses the system font (`--font-admin`).

Saving: **Save draft** keeps changes to a published page aside (table `entry_drafts`, editors only:
like everything else, they're read as the editor, `locals.db`) with the live page
unchanged; unpublished pages save in place as drafts. **Publish** / **Publish changes** makes them live;
the header also offers Discard changes and Unpublish (`PUT /api/admin/entries/:id` with `action`).
**Preview** opens `/admin/preview/<id>/` with the editor's current state (POST) or the saved draft
(GET), rendered like the site with a preview bar and noindex. Templates and layout mode have no drafts:
"Save & apply" changes every page using them. A save says which stored version it is based on (`base`,
the `updated_at` the editor loaded; `templateBase` in layout mode): if someone else saved since, it is
refused with 409 (`isStale`) and the editor asks before saving over their version. Each save and
accessibility mark answers with the new `updated_at`. Tags and terms are linked new-first, then the
others removed (`setLinks`), and a tag two saves create at once is made once.

Record types (`record: true`, such as venues) are data only: `/admin/edit/<id>/` shows a plain form for
them (`src/puck/RecordEditor.tsx`) with the entries that use them. An `entry` field (`EntryField` in
`src/puck/entry-fields.tsx`) picks one: search, clear, or add a new one inline. `POST
/api/admin/entries` creates entries (form post from the list: untitled draft; JSON from pickers:
titled, returns the id).

## Database access

The database is D1 (SQLite; the `DB` binding, schema in `db/migrations/`). The code reads and writes
through the query layer (`src/lib/db`), whose calls are the ones the Supabase client had
(`db.from('entries').select(...).eq(...)`, embedded relations, `or()` strings, `range`, `single`,
`upsert`, `rpc`), so the code kept its shape: `query.ts` builds a query (safe in the browser),
`sqlite.ts` compiles it to one SQLite statement whose rows are JSON built in SQL, typed as PostgREST
answered them: booleans as `true`/`false`, JSON and arrays as values, embeds in jsonb's key order,
times as ISO strings in UTC with milliseconds, text sorted without regard to case, nulls last going up
(checked against PostgREST on the same data by `scripts/checks/d1-parity.ts` while a Postgres copy
exists). Tables and columns are checked against `schema.ts` (generated from the local D1 by
`scripts/db-schema.ts`; run it after a migration that changes tables). Every value is bound, lists and
written rows as one JSON value each (`json_each`), so a statement stays inside D1's 100 bound values.
D1 also takes at most 32 arguments per SQL function and 50-byte LIKE and GLOB patterns (local SQLite
takes more, so local runs don't show these): a row's `json_object` has 16 columns, the rest added by
`json_insert` 15 at a time; `like`/`ilike` patterns of the shapes the code uses (exact, `prefix%`,
`%contains%`, `%suffix`) are compared as strings (`likeSql`), any length.

- Column types are the declared types in the migrations (`BOOLEAN`, `JSON_TEXT`, `ARRAY_TEXT`,
  `TIMESTAMPTZ`, `DATE`, `UUID`, `INTEGER`, `TEXT`, `REAL`); booleans are kept as 1 and 0, JSON as
  text. `*_touch` triggers keep `updated_at` current when a write doesn't set it (the layer sets it);
  generated columns (`contacts.name`, `redirects.wildcard`) are D1's. What Postgres computed in
  triggers the layer fills on write: `entries.body_text` from `content`, `contacts.email_hash` (the
  address as `mail_suppressions` keeps it) from `email`.
- `src/lib/db/d1.ts` (`database()`): in the Worker the binding; in Node scripts the local D1 file
  (`.wrangler/state`, through `node:sqlite`; `D1_LOCAL_FILE` when there are several) or, with
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `D1_DATABASE_ID`, the deployed one through
  Cloudflare's API.
- D1 has no interactive transactions: a statement is atomic, and a role's write is checked before it
  is made (the rows it may reach, read first, and the rule again in the write; the rows it writes). An
  upsert is also an update of the rows it conflicts with: they must pass the update rule (`upsertRule`). The functions that needed a lock do
  their check inside the one statement that writes (`ticket_order_create`, `insertIf`; claims are
  conditional updates).
- The server's functions (`db.rpc`) are in `functions.ts`: counters, ticket holds, mailing claims and
  audiences (a segment's rules as SQL), campaign numbers, search ranking (`entry_search`).
- Full-text search: `textSearch(col, query)` (op `fts`, FTS5's query syntax) matches rows through the
  table's FTS5 index (`schema.ts` `fts`, found by `scripts/db-schema.ts` from a virtual table with
  `content='<table>'`); `col` is `fts` for every indexed column, or one of them. `wrangler d1 export`
  can't export a database with virtual tables: drop `entries_fts` first, or copy with the API.
- A Db reads and writes as a role. The server's (`siteDb()`, `serviceClient()` in
  `src/lib/db/site.ts`) isn't checked: public pages, feeds, search, ticket availability, member
  endpoints, the admin login page's theme. Its `Loader`s take a scope (`PUBLIC_SCOPE`, or
  `{ published, viewer }` from `renderRequest`) that limits entries to published ones and members-only
  ones to who may see them (`visibleTo`: `entry`, `entryById`, `entriesByIds`, `query`, `termCounts`,
  `lockedEntry`). Code that queries entries for visitors without a Loader applies `visibleTo` itself.
  Previews render as the editor with no scope.
- A signed-in person's (`locals.db`, set by the middleware: `sessionDb`) follows the policies in
  `src/lib/db/policies.ts`, the database's row security as it was: editors read every table and write
  content, media, forms, templates, compose and segments; admins also write settings, lists, contacts
  and members; editors save campaigns only as drafts, change digests only while off and change their
  own profile but not its role; anyone else gets nothing. Reads a role may not make return no rows;
  refused inserts, and writes whose rows fail a check, are errors and write nothing.
- The admin screens in the browser (`browserClient`, `src/lib/db/browser.ts`) send their queries
  to `POST /api/admin/db`, which runs them as the signed-in editor; only its writes clear the page
  cache. Of the functions, editors may call `campaign_stats` and `ticket_sold`; the rest are the
  server's.
- New tables get a migration in `db/migrations/`, `scripts/db-schema.ts` run again, and a line in
  `POLICIES` (none: the server's only).

## Hosting

A Cloudflare Worker (`@astrojs/cloudflare`, `wrangler.jsonc`, entry `src/worker.ts`: Astro's `handle`
for requests, `scheduled` for the Cron Triggers, `queue` for the jobs queue), with D1 for the database
(`npx wrangler d1 create`, its id in `wrangler.jsonc`). Migrations: `npx wrangler d1 migrations apply
DB --remote`; SQL: `npx wrangler d1 execute DB --remote --command "..."`. `npm run deploy` builds and
deploys (`wrangler deploy`).

- Each request, scheduled run and job runs in a scope of its own (`src/lib/platform.ts`, `inScope`),
  which carries the work to finish after the answer (`afterAnswer`).
- Bindings: `DB` (D1), `BUCKET` (R2), `IMAGES` (Cloudflare Images), `JOBS` (a queue: Compose turns, campaign
  sending runs and restores, each run once with up to 15 minutes, `src/lib/jobs.ts`),
  `CF_VERSION_METADATA` (the page cache's validators). The Cron Triggers: mailing every 5 minutes and at
  06:20 UTC, snapshots at 07:00 UTC, ticket emails hourly (`SCHEDULES`).
- Variables and secrets reach the code as `process.env` (`nodejs_compat`); secrets are set with
  `npx wrangler secret put`. Code reads them with `env()` (`src/lib/env.ts`), which reads `.env` through
  `import.meta.env` under `astro dev` only: a build would write the build machine's `.env` values into
  the bundle, in place of the Worker's. Mail goes through the `EMAIL` binding (Email Service) when there is one, else
  over SMTP through the Worker's sockets (`worker-mailer`; port 25 is closed to Workers, and so are
  Cloudflare's own addresses, Email Service's SMTP endpoint among them). Link fetching for Compose resolves names over DNS-over-HTTPS (`addressesOf`).
  The visitor's address and country come from `CF-Connecting-IP` and `CF-IPCountry`.
- `astro dev` runs the Worker in workerd with local bindings: D1 and R2 in `.wrangler/state` (which
  scripts use too), a local queue, and Miniflare's Images,
  which resizes but ignores crop rectangles and qualities (crops are centred locally; production cuts
  them exactly). Cron runs can be triggered at `/cdn-cgi/handler/scheduled?cron=<cron>`. Static files'
  headers are in `public/_headers`; the admin answers carry `X-Robots-Tag: noindex` (middleware), as does every answer at an
  address other than `SITE_URL`'s (a workers.dev or preview copy; `offSite`), and every answer at all
  while `SITE_NOINDEX` is `1` or `true` (a demo or preview on its own domain): the Worker's from the
  middleware (`noindexAll`), and static files (served before the Worker) from a `/*` rule the
  `site-noindex` integration adds to the built `_headers` when `wrangler.jsonc`'s `vars` (or the build's
  environment) set it, so set it there, not only in the dashboard. Cached pages keep the header they were
  cached with until they refresh: after changing it, clear the page cache (any admin save does).

Files need an R2 bucket (`npx wrangler r2 bucket create`, its name in `wrangler.jsonc`; Media). Accounts need `AUTH_SECRET` (a long random value; changing it signs everyone out
and breaks links already sent) and links in emails use the request's address (`SITE_URL` for Better
Auth's own). Env: `.env.example`.

## Commands

```
npx wrangler d1 migrations apply DB --local   # the local database's schema (npm run db:migrate)
docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit   # a local mail catcher (SMTP_URL=smtp://127.0.0.1:1025)
npx astro dev --background              # http://localhost:4321 (the Worker, in workerd)
npm run deploy                          # build and deploy the Worker (wrangler deploy)
npx tsx --env-file=.env scripts/create-editor.ts you@example.org 'password' [editor|admin]   # a user
npm run seed                            # starter templates, home page, sample event (skips what exists)
npx tsx --env-file=.env scripts/migrate-content.ts [--dry-run]   # site then core content migrations
npx tsx scripts/checks/formatting.ts    # autop/texturize against scripts/checks/formatting-cases.json
npx tsx scripts/checks/recurrence.ts    # recurrence rules, DST, event date sync
npx tsx scripts/db-schema.ts            # src/lib/db/schema.ts from the local D1, after a migration
npx tsx --env-file=.env scripts/pg-to-d1.ts [--replace | --out data.sql]   # a Postgres copy's data into D1 (moving a site)
npx tsx --env-file=.env scripts/copy-storage.ts [folder...]   # files from another store (moving a site)
npx tsx scripts/checks/mailing.ts       # signed links, mailing emails, link tracking, click verdicts, digest times
npx tsx --env-file=.env scripts/media-formats.ts   # backfill AVIF/WebP for existing media
```

`.github/workflows/check.yml` runs `npm run check`, the three checks above and `scripts/checks/private-address.ts` on every push and pull
request.

`scripts/safety-e2e.ts` (uploads, form limits, shared addresses, stale saves, tags, search, roles, restore as a job) and
`scripts/sync-e2e.ts` (a sync stopped by a row made since Compare; undoing a half-finished sync; needs
a second local copy as `SYNC_REMOTE_URL`, such as the built Worker under `wrangler dev` with its own
`--persist-to` state, see the script) use the running site without a browser and remove what they make.
`scripts/payments-e2e.ts [stripe|square]` builds a form with Product fields and a payment provider in the
browser, submits it, pays (Stripe's checkout with its test card; a Square sandbox payment link opens
Square's testing panel, whose Test Payment pays the order) and reports the confirmation and the stored
payment (that needs the provider's test keys and network access to it).
`scripts/auth-e2e.ts` runs accounts without a browser: admin sign-in, an invitation from its email to a
password, password links (spent once used), a member's sign-in, password link and account page, a
sign-up's confirmation link, and a bcrypt password carried over from Supabase Auth.
`scripts/mailing-e2e.ts` runs Mailing without Mailgun (emails read from the local mail catcher,
`LOCAL_MAIL_URL`): sign-up and confirmation, preferences, unsubscribing (one-click from another site),
a campaign with its variables, footer and tracked links, clicks as a person and a machine, signed and
replayed webhooks, a digest issue, and a member's opt-in.

The e2e scripts (`scripts/*-e2e.ts`, `scripts/checks/compose.ts`) sign in as `LOCAL_ADMIN_EMAIL` /
`LOCAL_ADMIN_PASSWORD` and were written against a site with content (pages, events, venues, members);
on the example site some need that content first.

## Changing stored content

Content changes the core or a site needs (renamed props, moved settings, switched block types) ship as
a content migration or a SQL migration (`db/migrations/`) that edits the JSON. Content migrations are the core's
(`migrateCollectionLayout` in `src/lib/content/collections.ts` is one) and the site's
(`src/site/migrations/`); `scripts/migrate-content.ts` runs the site's first, then the core's.

- Walk the JSON properly (a content migration in TypeScript; SQLite's `json_tree` for small changes):
  the key order of stored blocks varies, so text patterns miss some. A SQL migration that changes an
  entry's `content` must leave `body_text` to a content migration (the layer fills it).
- Keep updated dates: drop the table's `*_touch` trigger before the update and create it again after
  (as `*_init.sql` has it). It fires whenever a write leaves `updated_at` as it was, setting it to
  itself included.
- Name migrations with the time they are written (`YYYYMMDDHHMMSS_name.sql`; a site's
  `YYYYMMDDHHMMSS_site_name.sql`).
- When a migration switches block types or settings, the new code and the database change must land
  together: push the code, wait for the deploy, then `npx wrangler d1 migrations apply DB --remote` at
  once (the pages break in between).

## Checking changes

- Render the affected pages before and after and diff the HTML for unintended changes (ignore
  cache-busting `?v=` values and shuffled collections); look at screenshots (desktop and phone) of
  intended ones. Lazy-loaded images need the page scrolled before a full-page screenshot.
- Browser tests use Playwright from a script inside the project (so imports resolve), signing in as
  `LOCAL_ADMIN_EMAIL` / `LOCAL_ADMIN_PASSWORD` from `.env`; POSTs to Astro need an `Origin` header
  (CSRF check). The editor canvas is `iframe#preview-frame`; blocks that can't be dragged report as
  disabled, so tests click them with `force`.
- Checks that need one site's content live in that site's `src/site/scripts/`.

## Rules

- Check changes against the site's own output (see Checking changes).
- Name code, data, URLs and classes for what they are here, not after another system's names.
- Section and loop markup is followed by autop; keep the whitespace in those templates as it is.
