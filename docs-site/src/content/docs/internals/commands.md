---
title: Commands and checks
description: The scripts for running, seeding, migrating and checking a site.
sidebar:
  order: 3
---

## Running

```sh
npx supabase start                      # local stack (ports in supabase/config.toml)
npx astro dev --background              # http://localhost:4321
```

## Content and users

```sh
npm run seed                            # starter templates, home page, sample event (skips what exists)
npx tsx --env-file=.env scripts/create-editor.ts you@example.org 'password' [editor|admin]
npx tsx --env-file=.env scripts/migrate-content.ts [--dry-run]   # site then core content migrations
npx tsx --env-file=.env scripts/media-formats.ts                 # backfill AVIF/WebP for existing media
npx tsx --env-file=.env scripts/copy-storage.ts                  # Supabase Storage into the site's bucket (moving a site)
npx tsx --env-file=.env scripts/pg-to-d1.ts                      # a Postgres copy's data into D1 (moving a site)
```

## Database

```sh
npx wrangler d1 migrations apply DB --local    # apply migrations locally (--remote: deployed)
npx wrangler d1 execute DB --remote --command "select count(*) from entries"   # run SQL
npx tsx scripts/db-schema.ts                   # src/lib/db/schema.ts from the local D1, after a migration
```

## Checks

```sh
npm run check                                       # typecheck
npx tsx scripts/checks/recurrence.ts                # recurrence rules, DST, event date sync
npx tsx scripts/checks/formatting.ts                # autop/texturize against scripts/checks/formatting-cases.json
npx tsx scripts/checks/mailing.ts                   # mailing emails, signed links, click verdicts, digest times
npx tsx --env-file=.env scripts/mailing-e2e.ts      # mailing through the running site, without Mailgun
npx tsx --env-file=.env scripts/publishing-e2e.ts   # drafts, preview, publish
```

The e2e scripts (`scripts/*-e2e.ts`, `scripts/checks/compose.ts`) sign in as `LOCAL_ADMIN_EMAIL` /
`LOCAL_ADMIN_PASSWORD`. They were written against a site with content (pages, events, venues,
members), so on the example site some need that content first.
