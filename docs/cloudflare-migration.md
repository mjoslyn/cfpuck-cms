# Moving to Cloudflare

Plan for moving the core off Netlify and Supabase onto Cloudflare Workers, D1, R2, Cloudflare Images
and Better Auth. Nothing here is built yet. Each phase leaves the site working and can ship by itself;
CORE.md, README.md and docs-site change in the same commits as the code.

## Decisions

| Today | Moves to |
|---|---|
| Netlify SSR (`@astrojs/netlify`) | Workers (`@astrojs/cloudflare`), `wrangler.jsonc` |
| Netlify scheduled functions (4) | Cron Triggers on the same Worker (`scheduled` handler) |
| Netlify background functions (compose, restore, mail send) | Workflows (durable steps, no 15-minute cap) |
| Netlify durable cache, tag purge | Cache-Tag header and Cloudflare's purge-by-tag API |
| Edge function `media-guard`, `_redirects` to Storage | `/media/*` served from R2 by the Worker, same headers |
| Supabase Postgres, RLS, 24 SQL functions, 20 triggers | D1 (SQLite); permissions and functions in TypeScript |
| `supabase-js` query builder (117 files) | Kysely (`kysely-d1`), typed schema |
| Supabase Auth | Better Auth (email and password, sessions, reset), our invitations as today |
| Supabase Storage (`media`, `compose`, `sync-backups`) | R2 buckets of the same names |
| `sharp` (sizes, AVIF/WebP, site icon, JPEG for Claude) | Cloudflare Images: transforms by URL and the Images binding |
| `nodemailer` over SMTP | SMTP over `cloudflare:sockets` (worker-mailer), or Cloudflare Email Sending |

## What D1 changes

- **No RLS.** The database API is already closed to all but editors, so every read and write is server
  code. The 63 policies become checks in one place (`src/lib/auth/can.ts`): editor, admin, and the
  special cases (editors save campaigns only as drafts, digests only while off, settings writes and
  users admin only). The 15 browser files using `browserClient` move to `/api/admin/*` endpoints.
- **No interactive transactions.** D1 runs `batch()` atomically and one statement at a time per
  database. `ticket_order_create` (advisory lock, count, insert) becomes one batch with a conditional
  `INSERT ... SELECT ... WHERE <sold + held + qty <= capacity>`, checked by its `changes` count.
  `mail_claim` and `mail_digest_claim` become conditional updates the same way.
- **SQL functions to TypeScript**: `ticket_sold`, `ticket_order_status`, `mail_audience`,
  `mail_still_subscribed`, `mail_rule`, `mail_segment_match`, `campaign_stats`, `not_found_hit`,
  `redirect_hit`, `awaiting_password`. `sync_reset_ids` and the sequence helpers go (SQLite
  `AUTOINCREMENT` follows the highest id). `handle_new_user` becomes a Better Auth hook.
- **Triggers kept in SQLite**: `*_touch` (`updated_at`), `entry_body_text` (body text from content,
  via `json_tree`, or computed on save in TypeScript if `json_tree` can't match the current output).
- **Types**: `timestamptz` as ISO text (UTC), `jsonb` as JSON text (`json_extract`, `->>`), `text[]`
  as JSON arrays, `uuid` as text from `crypto.randomUUID()`, generated columns kept (SQLite has them).
- **Search**: the trigram index goes; `Loader.queryRanked` uses an FTS5 table over title, excerpt and
  body text kept by triggers, ranked as today.
- **Limits to design for**: 10 GB per database, 2 MB per row (entries' content, compose sessions and
  sync backups must fit; backups already live in storage), 100 bound parameters per statement (the
  `in()` lists and bulk writes are chunked).

## Phases

Each phase is its own branch and PR, tested on the example site and one real site before the next.

### 1. Data layer on the current Postgres (still Netlify and Supabase)

Swap `supabase-js` queries for Kysely against the existing Postgres (direct connection), so the
largest change is made while everything else stays put and can be compared page by page.

- `src/lib/db/` (new): `db()` for the request, the schema types, and helpers for what PostgREST did
  (embedded selects in 9 places become joins; `count: 'exact'` in 11).
- Convert module by module: `src/lib/data.ts` (Loader), `entries`, `terms`, `media`, `forms`,
  `tickets`, `members`, `mailing`, `sync`, `redirects`, then `src/pages/api/**` and `src/admin/**`.
- The SQL functions listed above move to TypeScript here, written so they run on Postgres and SQLite.
- Permission checks (`can.ts`) replace RLS; browser access moves to endpoints.
- Done when: nothing imports `@supabase/supabase-js` except auth and storage; rendered HTML of the
  example site and a real site is unchanged (Checking changes in CORE.md); e2e scripts pass.

### 2. Auth to Better Auth (still Postgres)

- Better Auth with the Kysely adapter, cookie sessions; tables `user`, `session`, `account`,
  `verification`. `profiles` and `members` keep their user ids.
- Existing users keep their passwords: Supabase stores bcrypt hashes, so Better Auth's `password.verify`
  checks bcrypt for imported accounts and rehashes on sign-in.
- Replace each `auth.*` call: sign in, sign out, reset, set password, sign-up with confirmation,
  `getUser` in the middleware and `viewerOf`. `src/lib/admin/invite.ts` keeps its signed links and
  issues a Better Auth reset token instead of Supabase's `generateLink`.
- Done when: admin login, invitations, password links, member sign-up and account page work; Users and
  Members screens list everyone.

### 3. Storage to R2 (still Netlify)

- R2 buckets `media`, `compose`, `sync-backups`; `src/lib/storage.ts` with `put`, `get`, `list`,
  `remove` over R2 (S3 API from Node now, the binding in phase 4).
- `/media/*` served by the app route from R2 with `MEDIA_HEADERS`; `gen-redirects.mjs` drops the
  Storage rewrite.
- `scripts/copy-storage.ts` copies Supabase Storage to R2 (resumable).

### 4. Hosting to Workers (still Postgres, now via Hyperdrive)

- `@astrojs/cloudflare`, `wrangler.jsonc` (bindings: `DB`/Hyperdrive, `MEDIA`, `COMPOSE`, `BACKUPS`,
  `IMAGES`, Workflows), `nodejs_compat`. Secrets from `wrangler secret`; the 20 `process.env` reads go
  through one `env()` helper.
- Cron Triggers: `*/5 * * * *` mail due, `20 6 * * *` mail nightly, `0 * * * *` ticket emails,
  `0 7 * * *` snapshot. One `scheduled` handler dispatches by cron.
- Workflows: `ComposeTurn`, `RestoreBackup`, `MailSend`, replacing the three background functions and
  the `/.netlify/functions/*` calls (`compose/job.ts`, `mailing/send.ts`, `sync.ts`). Their job tables
  and polling stay.
- Cache: pages carry `Cache-Tag: pages` and `Cache-Control` for the CDN (a Cache Rule caches HTML);
  `cache.invalidate` calls the purge-by-tag API. Check first whether Astro's route cache has a
  Cloudflare provider; if so, use it.
- Images: `src/lib/media/process.ts` stops generating files. Sizes become transform URLs
  (`/cdn-cgi/image/width=,height=,fit=cover,gravity=<x>x<y>,format=auto/...`) from the focal points
  and crop overrides already stored; `modernize.ts` emits one `<img>` (format chosen by the CDN)
  instead of `<picture>` sources. SVGs pass through untouched. Site icon PNGs and Compose's JPEGs use
  the Images binding. `scripts/media-formats.ts` retires.
- Email: SMTP through a socket mailer (same `SMTP_*` variables), or Cloudflare Email Sending if chosen.
- Request info: `CF-Connecting-IP` and `request.cf.country` in `mailing/request.ts`.
- Private addresses: `node:dns` lookups in `compose/materials.ts` become DNS-over-HTTPS; undici's
  pinned dispatcher goes (Workers can't reach private networks, but the check stays).
- Local dev: `astro dev` with the adapter's platform proxy (local D1/R2 via Miniflare) replaces
  `npx supabase start`.
- Remove `netlify/`, `netlify.toml`, `@astrojs/netlify`.

### 5. Database to D1

- One fresh SQLite schema, `db/migrations/0001_init.sql`, from the current Postgres schema (also
  closes the open work item about a fresh starting migration). Site migrations move to
  `db/migrations/*_site_*.sql`; `wrangler d1 migrations apply`.
- Switch Kysely's dialect to `kysely-d1`; fix the queries that differ (JSON operators, `ilike`,
  `on conflict`, date arithmetic, `returning`), ticket and mail claims as batches, FTS5 search.
- `scripts/pg-to-d1.ts`: exports every table from a Postgres copy, converts types and imports into D1
  in batches; reports row counts per table on both sides.
- Hyperdrive and the Postgres dialect are removed.

### 6. Sync, backups, tooling, docs

- Sync: the other copy is reached through a signed endpoint on it (`/api/sync/remote`, HMAC with a
  shared `SYNC_SECRET`) instead of its service key; rows are matched as today. Snapshots and backups
  write to R2. `sync_reset_ids` goes.
- e2e scripts and `scripts/checks/*` run against `wrangler dev`; `create-editor.ts` and `seed.ts` use
  the new layer.
- Docs: CORE.md (Hosting, Database access, Media, Sync, Commands, every RLS reference), README.md
  (new site setup on Cloudflare, taking core updates), AGENTS.md (local setup), docs-site.

## Moving an existing site

1. Merge the core, create D1, R2 buckets, Images, Workflows; set secrets.
2. `scripts/copy-storage.ts` (Supabase Storage to R2), `scripts/pg-to-d1.ts` (data and auth users
   with their bcrypt hashes).
3. Deploy to a `workers.dev` address, compare pages against the live site, sign in, run the e2e
   scripts.
4. Freeze edits, run the two copies again for the latest changes, point DNS at the Worker, move the
   Stripe, Square and Mailgun webhooks.
5. Keep the Supabase project and Netlify site read-only for a few weeks, then delete them.

## To verify before phase 1

- Astro 7 with `@astrojs/cloudflare`: SSR, React islands, the `site-routes` and `site-public`
  integrations, route cache support.
- Better Auth on D1 through Kysely, with bcrypt verification for imported users within Workers' CPU
  limits.
- Cloudflare Images `gravity` with coordinates matches today's focal crops closely enough (compare
  crops for a sample of media).
- `mammoth` (Word materials) under `nodejs_compat`.
- D1 row size against the largest stored entries and compose sessions on a real site.
