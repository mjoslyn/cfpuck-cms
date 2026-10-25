# Moving to Cloudflare

Plan for moving the core off Netlify and Supabase onto Cloudflare Workers, D1, R2, Cloudflare Images
and Better Auth. All six phases are done (each with what was built); what is left is checking on a first real deploy and moving the first real site. Each phase leaves the site working and can ship by itself;
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
| `supabase-js` query builder (117 files) | Our query layer (`src/lib/db`): the same calls, compiled to SQL per dialect |
| Supabase Auth | Better Auth (email and password, sessions, reset), our invitations as today |
| Supabase Storage (`media`, `compose`, `sync-backups`) | R2 buckets of the same names |
| `sharp` (sizes, AVIF/WebP, site icon, JPEG for Claude) | Cloudflare Images: transforms by URL and the Images binding |
| `nodemailer` over SMTP | SMTP over `cloudflare:sockets` (worker-mailer), or Cloudflare Email Sending |

## What D1 changes

- **No RLS.** The database API is already closed to all but editors, so every read and write is server
  code. The 63 policies became checks in one place (`src/lib/db/policies.ts`, phase 1): editor, admin, and the
  special cases (editors save campaigns only as drafts, digests only while off, settings writes and
  users admin only). The 15 browser files using `browserClient` send their queries to `/api/admin/db`.
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

### 1. Data layer on the current Postgres (still Netlify and Supabase): done

Built as a query layer that keeps the Supabase client's calls (`from`, `select`, `eq`, `or`, embedded
relations, `range`, `single`, `upsert`, `rpc`) rather than Kysely, so the 800 or so call sites kept
their shape and the change could be checked against PostgREST directly. CORE.md, Database access.

- `src/lib/db/query.ts` builds a query (safe in the browser); `sql.ts` compiles it to one Postgres
  statement answering PostgREST's JSON; `schema.ts` (generated, `scripts/db-schema.ts`) checks names
  and gives the foreign keys for embeds; `policies.ts` is the row security as code; `functions.ts`
  the SQL functions as TypeScript (queries through the layer where they could be; counters, the
  ticket hold's advisory lock, mailing audiences and campaign numbers as bound SQL).
- The admin's browser queries go through `POST /api/admin/db`, run as the signed-in editor.
- Checked: `scripts/checks/db-parity.ts` (reads, writes, functions, and editor, admin and viewer
  sessions, against PostgREST: identical); every page of the example site, public and admin, renders
  the same HTML; the e2e scripts pass as before (mailing, all 64 checks).
- Still Postgres-specific, for phase 5: `json_agg`/`jsonb` output, `json_populate_record(set)` writes,
  `ilike`, `@>`, the advisory lock, `encode(digest(...))` for suppressions, `&&` on tags, `strpos`,
  `awaiting_password` (Supabase Auth's users) and `sync_reset_ids` (sequences). The database's own
  SQL functions and policies stay until then: Sync's other copy still calls them over its API.

### 2. Auth to Better Auth (still Postgres): done

Built as planned, with Better Auth's own routes left unmounted: the site's endpoints call it and send
its emails (password links and confirmations are the site's now, over SMTP, not Supabase's). Its
Postgres adapter takes the same pool as the query layer; ids are made in code, so D1 needs nothing
more than its adapter. `scripts/auth-e2e.ts` covers sign-in, invitations, password links, members,
confirmation and carried-over bcrypt passwords. CORE.md, Accounts.

- Better Auth with the Kysely adapter, cookie sessions; tables `user`, `session`, `account`,
  `verification`. `profiles` and `members` keep their user ids.
- Existing users keep their passwords: Supabase stores bcrypt hashes, so Better Auth's `password.verify`
  checks bcrypt for imported accounts and rehashes on sign-in.
- Replace each `auth.*` call: sign in, sign out, reset, set password, sign-up with confirmation,
  `getUser` in the middleware and `viewerOf`. `src/lib/admin/invite.ts` keeps its signed links and
  issues a Better Auth reset token instead of Supabase's `generateLink`.
- Done when: admin login, invitations, password links, member sign-up and account page work; Users and
  Members screens list everyone.

### 3. Storage to R2 (still Netlify): done

One private bucket per site with `media/`, `compose/` and `sync-backups/` folders, over the S3 API
(aws4fetch: fetch and WebCrypto, so the same code runs on Workers), behind the calls the code made of
Supabase Storage. `/media/` is the site's route (ranges, a year's caching), which also replaced the
edge function. Sync reaches the other copy's store with `SYNC_REMOTE_STORAGE_*`. CORE.md, Media.

- R2 buckets `media`, `compose`, `sync-backups`; `src/lib/storage.ts` with `put`, `get`, `list`,
  `remove` over R2 (S3 API from Node now, the binding in phase 4).
- `/media/*` served by the app route from R2 with `MEDIA_HEADERS`; `gen-redirects.mjs` drops the
  Storage rewrite.
- `scripts/copy-storage.ts` copies Supabase Storage to R2 (resumable).

### 4. Hosting to Workers (still Postgres, now via Hyperdrive): done

As built (CORE.md, Hosting), with three changes from the plan:

- **A queue, not Workflows**, for the three background jobs: each was one 15-minute run with a claim
  token, which is what a Queue consumer gives (`max_retries: 0`, `limits.cpu_ms`); Workflows' steps
  would have meant reshaping the jobs for nothing.
- **The Images binding at upload, not transform URLs**: the same sizes and AVIF/WebP files are made
  and stored as before, so pages, stored media and Sync are unchanged and nothing is billed per view.
  Crops are rectangles computed in `engine.ts` (`trim`, then resize), so the result doesn't depend on
  the engine's idea of gravity. Scripts in Node use sharp with the same rectangles.
- **R2 stays on the S3 API** (phase 3's code runs in the Worker as is); the R2 binding can replace it
  later without changing callers.

Checked under `astro dev` (workerd, local Hyperdrive, queue and Images): every page answers; auth (30),
roles, safety (28, restore through the queue), publishing, revisions, mailing (64, sending through the
queue), forms, events and venue pass; media matches phase 3 except the focal crop, because Miniflare's
local Images ignores `trim` (the same geometry through sharp gives the old result). Cron runs fire at
`/cdn-cgi/handler/scheduled`. `wrangler deploy --dry-run` bundles (8.5 MB, 2 MB gzipped).

To check on the first real deploy: Images' `trim` (production only), `cache.purge` by tag, SMTP over
the Worker's sockets with the site's provider.

### 5. Database to D1: done

- One SQLite schema, `db/migrations/20261025180000_init.sql`, written from the Postgres schema by
  `scripts/pg-to-d1-schema.ts` (37 tables, keys, checks, defaults, indexes, `*_touch` triggers,
  generated columns; declared types `BOOLEAN`, `JSON_TEXT`, `ARRAY_TEXT`, `TIMESTAMPTZ`, `DATE`, `UUID`
  carry what the layer needs). `*_contacts_email_hash.sql` adds the address hash the audience query
  needs (SQLite has no digest function). Site migrations go in `db/migrations/*_site_*.sql`;
  `wrangler d1 migrations apply`. `scripts/db-schema.ts` now reads the local D1.
- `src/lib/db/sqlite.ts`: the compiler and executor (rows as `json_object`, embeds as
  `json_group_array`, booleans and JSON typed in SQL; `GLOB` for case-sensitive `like`; `NULLS
  FIRST/LAST` and `COLLATE NOCASE` to sort as Postgres did; lists and rows as one JSON parameter).
  Policies are checked before writes (no transactions to roll back). `body_text` is computed in
  TypeScript on write (`src/lib/content/body-text.ts`, identical to the trigger's output on every entry).
- Functions in SQLite: `ticket_order_create` is one `INSERT ... SELECT ... WHERE <capacity>`
  (`insertIf`); claims stay conditional updates; `mail_audience` reads `contacts.email_hash`;
  `sync_reset_ids` does nothing.
- Better Auth uses its D1 dialect (`lazyD1()`, a handle that finds the binding when a statement runs).
- `scripts/pg-to-d1.ts` copies a Postgres copy's data into D1 (local, remote through the API, or a SQL
  file for `wrangler d1 execute`; long values split under D1's statement limit).
- Hyperdrive, `src/lib/db/sql.ts` and `pg` at runtime are gone (`pg` stays for the two scripts).
- FTS5 came after: `*_entries_fts.sql` and `textSearch` (CORE.md, Search).
- Checked: `scripts/checks/d1-parity.ts` (removed in phase 6 with Supabase; in commit `68b7327`; PostgREST on Postgres against the layer on D1, same data:
  reads, writes, functions, editor, admin and viewer; one difference: Postgres refuses invalid JSON in
  a `cs` filter, D1 doesn't), HTML of every page type identical before and after, auth (30), safety
  (28) and mailing (64) e2e, roles, publishing, revisions, forms, events, venue and media e2e as before,
  and the built Worker under `wrangler dev`.

### 6. Sync, files, tooling, docs: done

- Sync reaches the other copy through signed routes on it: `/api/sync/remote` (queries, on the tables a
  sync uses) and `/api/sync/files` (file calls, on `media` and `sync-backups`; an upload's signature
  covers its bytes), HMAC-SHA256 with the shared `SYNC_SECRET` over the time and the request, good for
  five minutes (`src/lib/sync-remote.ts`). No service key and no store keys for the other copy: one
  secret. A remote write clears that copy's page cache.
- Files on the R2 binding (`BUCKET`; `src/lib/storage.ts` keeps the S3 client for scripts and other
  stores). `astro dev` uses a local bucket; scripts reach it through wrangler's platform proxy
  (`src/lib/local-bindings.ts`), so local work needs no Docker. `scripts/copy-storage.ts` reads any
  S3-compatible source (Supabase Storage's S3 endpoint for a moving site).
- Supabase is gone: `@supabase/supabase-js`, the `supabase` CLI, `supabase/` (its migrations are in the
  history), the `PUBLIC_SUPABASE_*` and `SUPABASE_SERVICE_ROLE_KEY` variables. Mailing's link key
  falls back to `AUTH_SECRET`. Local mail: any catcher (Mailpit).
- Checked with the Supabase stack stopped: auth (30), safety (28) and mailing (64) e2e; roles,
  publishing, revisions, forms, events, venue and media e2e; sync e2e between `astro dev` and the built
  Worker under `wrangler dev` with its own state, and a full sync of every group (files included) into
  an empty copy, whose pages then matched the source's; `/media/` from R2 answers 200, 304, 206 and 404.

## Moving an existing site

1. Bring the Postgres database up to date with the core first: merge the core up to commit `68b7327`
   (the last with `supabase/migrations/`) and `npx supabase db push --linked`. Then merge the rest,
   create D1, an R2 bucket, a queue, Images; set secrets. A site that never set `MAIL_LINK_SECRET` sets
   it to `mail-links:<its old Supabase service_role key>`, so mailing links already sent keep working.
2. `scripts/copy-storage.ts` (Supabase Storage's S3 endpoint to R2, with `STORAGE_*` set to the R2
   bucket's S3 API), `scripts/pg-to-d1.ts` (the data, accounts included: migration `*_auth_tables.sql`
   already moved them out of Supabase Auth). A site with tables
   of its own (`*_site_*.sql` in `supabase/migrations/`) writes their D1 migration first
   (`scripts/pg-to-d1-schema.ts` prints every table). Check the largest rows (entries' content,
   compose sessions) against D1's 2 MB.
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
