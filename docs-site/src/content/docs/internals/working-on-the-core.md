---
title: Working on the core
description: Where things go, adding a block, changing stored content, and checking changes.
sidebar:
  order: 2
---

## Keep the docs current

Update the docs in the same commit as the change:

- `CORE.md`: what the core does and where. Sites read it, so describe the core, never a particular
  site.
- `AGENTS.md`: how to work on the core.
- `README.md`: setting up a new site and taking core updates.
- `docs-site/`: this site.

## Where things go

- Nothing site-specific in core code. Core code reads a site only through `src/lib/site`.
- Sites keep their own blocks, patterns and templates where those are their design; only general
  features belong in the core.
- The example site follows the same layout as every site and must keep working with every change.
- Styles use role tokens only, never a site's palette names.
- Name code, data, URLs and classes for what they are here, not after another system's names.

## Adding a block

1. **Renderer** in `src/render/c/`: a string of HTML with `c-*` classes, added to
   `src/render/blocks/index.ts`.
2. **Data** it needs: a `case` in `walk()` in `src/render/prepare.ts`. Load into `ctx.data`; add page
   scripts to `ctx.scripts` / `ctx.headScripts`, vendor CSS through `ctx.assets`.
3. **Editor**: a panel in `CONTENT_PANELS` and a label in `CONTENT_LABELS` (`src/puck/panels.tsx`),
   its category in `buildConfig` (`src/puck/config.tsx`). Containers go in `CONTENT_CONTAINERS`.
4. **Browser behaviour**: a script in `public/assets/js/` that enhances the server markup.
5. **Styles** in `src/styles/site.css`, and a section in `CORE.md` and these docs.

## Changing stored content

Content changes the core needs (renamed props, moved settings) ship as a core content migration
(`scripts/migrate-content.ts`; `migrateCollectionLayout` in `src/lib/content/collections.ts` is one)
or a SQL migration (`db/migrations/`) that edits the JSON.

- Walk the JSON properly (a content migration in TypeScript). The key order of stored blocks varies,
  so text patterns miss some. The query layer fills `body_text` when content is written, so changes to
  entries' content belong in content migrations.
- Keep updated dates: drop the table's `*_touch` trigger before the update and create it again after
  (as `*_init.sql` has it). It fires whenever a write leaves `updated_at` as it was, setting it to
  itself included.
- Name migrations with the time they are written (`YYYYMMDDHHMMSS_name.sql`).

When a site migration switches block types or settings, the site's code and its database change must
land together: push the code, wait for the deploy, then `npx wrangler d1 migrations apply DB --remote` at once.

## Workflow

1. Change and commit in `cfpuck-cms`. `npm run check` and `npm test` must pass (a fix comes with a
   test in `tests/` that fails without it).
2. Test on the example site and, for anything real content exercises, in a site: merge the core
   change there without committing and test.
3. Push `cfpuck-cms` (it deploys nothing), then in each site `git fetch upstream && git merge upstream/main`
   and commit. The site's owner pushes the site, which deploys it.

## Tests

`npm test` runs the unit tests in `tests/` with [Vitest](https://vitest.dev/). A test imports the code
it tests and calls it; nothing needs a dev server. Each test file gets a fresh database made from
`db/migrations`, so tests that read and write through the query layer (`siteDb()`, or `sessionDb()` to
act as an editor or admin) start from empty tables and see real SQLite.

Every statement a test sends is checked against D1's limits before it runs: 32 arguments per SQL
function, LIKE and GLOB patterns of 50 bytes, 100 bound values, 100 KB of SQL and 2 MB per value.
Local SQLite allows more, so without this a query that works on your machine can fail on the first
deploy. A test that breaks a limit fails with "D1 would refuse this statement" and the reason.

Put a test beside the others of its area (`tests/db-policies.test.ts`, `tests/security.test.ts`...),
and give every fix one that fails without it. CI runs `npm test` on every push.

## Checking changes

- Render the affected pages before and after and diff the HTML (ignore cache-busting `?v=` values and
  shuffled collections). Screenshot intended changes on desktop and phone. Lazy-loaded images need the
  page scrolled before a full-page screenshot.
- Browser tests use Playwright from a script inside the project, signing in as `LOCAL_ADMIN_EMAIL` /
  `LOCAL_ADMIN_PASSWORD`. POSTs to Astro need an `Origin` header (CSRF check). The editor canvas is
  `iframe#preview-frame`; blocks that can't be dragged report as disabled, so tests click them with
  `force`.
- Checks that need one site's content live in that site's `src/site/scripts/`.
