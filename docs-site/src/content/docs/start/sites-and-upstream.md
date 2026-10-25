---
title: Sites and upstream
description: How a site repository relates to supapuck-cms, and how core updates reach it.
sidebar:
  order: 3
---

`supapuck-cms` is the upstream. Each site is its own repository with `supapuck-cms` as its `upstream`
remote. Its history starts from the core's, with a commit that swaps the example `src/site/` for its
own.

## Setting up a site repository

After cloning:

```sh
git remote rename origin upstream
git remote add origin git@github.com:<you>/my-site.git
```

Then make it your site:

- Replace `src/site/` with your own (see [Site configuration](../../site/configuration/)).
- Replace `AGENTS.md` with your site's own notes, keeping its first line, `@CORE.md`, which brings in
  the core's reference. The core's `AGENTS.md` is about working on the core itself.
- `CORE.md` documents the core and belongs to upstream: sites don't edit it.

## What a site may change

Merges stay clean as long as the site only changes:

- `src/site/`
- its own database migrations, `db/migrations/*_site_*.sql` (wrangler reads only that folder)
- `AGENTS.md`, `README.md`
- its env and its local ports in `supabase/config.toml`

## Taking core updates

```sh
git fetch upstream
git merge upstream/main
npx wrangler d1 migrations apply DB --remote       # if there are new migrations
npx tsx --env-file=.env scripts/migrate-content.ts # if stored content needs migrating
```

On a conflict, a site keeps its own `AGENTS.md`, `README.md`, `.env.example` and
`supabase/config.toml`.

### Migrations

Migrations (core and site) are named with the time they were written: `YYYYMMDDHHMMSS_name.sql`.
`wrangler d1 migrations apply` applies every one not yet applied, in order, so a core migration written
earlier than one a site already applied still goes in:

```sh
npx wrangler d1 migrations apply DB --remote   # deployed
npx wrangler d1 migrations apply DB --local    # local
```

## Sending a fix upstream

A core bug found while working on a site can be fixed there: commit the fix on its own, touching core
files only, then `git cherry-pick` it into `supapuck-cms`.

## Rules for core code

- Never import from `src/site/` in core code except through `src/lib/site` (the CSS imports of the
  site's `styles/tokens.css` and `styles/theme.css` in `src/styles/site.css` aside).
- New core code must not hard-code a site's types, URLs, names, palette names or classes. If a site
  needs something general (a filter, a map, a menu), build it as a core feature with settings and move
  the site onto it.
