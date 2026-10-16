# Code review, 2026-09-30

From the online Claude Code session "Code review"
(https://claude.ai/code/session_01395pk2fejgmrCvLan18Zfg): a review of the redirects commit, then a
full review of cms-core by five parallel reviewers. Findings marked (verified) were checked against the
code by that session; the rest were traced by the reviewers, several reproduced by running the code.

Status: every finding is fixed; each says in which commit.

## Redirects (review of 2a5e93c)

1. **Fixed (25b4e62). Exact rules act like wildcards** (most serious). `src/lib/redirects.ts:51`: `findRedirect`
   loads wildcard rules with `.like('from_path', '%*')`, but PostgREST reads `*` in a like pattern as
   `%`, so every rule loads; each is then prefix-matched with its last character cut. An exact rule
   `/about/` → `/team/` also redirects `/about-us/` and `/about/history/`. Fix: filter in JS with
   `from_path.endsWith('*')`, or escape the star.
2. **Fixed (25b4e62). A wildcard can loop.** `src/pages/api/admin/redirects.ts:12`: the same-address check is
   skipped for wildcards. `/news/*` → `/news/*` loops; `/news/*` → `/news/archive/*` nests forever.
   Fix: refuse a wildcard whose target starts with its own prefix.
3. **Fixed (25b4e62). The Not found delete escapes too little** (line 19): `%` and `_` but not `*` or `\`, so a
   rule like `/a*b/*` can clear log entries it doesn't cover.
4. **Fixed (25b4e62). Delete errors are ignored**: if the not_found delete fails, the API still reports success
   and the screen drops the rows until reload.
5. **Fixed (25b4e62). "Does this rule cover this path?" is written three times** (Redirects.tsx:38, the SQL LIKE,
   findRedirect) and they disagree. Fix: one `ruleCovers(fromPath, path)` in `src/lib/redirects.ts`.
6. **Fixed (25b4e62). Docs**: the API header comment and CORE.md don't mention the bulk clearing of the Not
   found log under a wildcard.

Suggested order: 1, then 2, then 3 to 5 together around `ruleCovers`, then 6.

## Full review

### High

1. **Fixed (ae0142c). Anyone could read unpublished drafts** (verified): the public read rule on
   entries (init.sql:181) covered every column, including `draft`. Drafts moved to `entry_drafts`
   (editors only).
2. **Fixed (ae0142c). Compose could put script into pages** (verified): card links unescaped
   (`build.ts:150`), weak edit_block filter (`edit.ts:313`). Now `src/lib/compose/safe-html.ts`.
3. **Fixed (ae0142c), by allowing it. Editors could change templates** (verified): RLS allowed it and
   only the URL was admin-only. Editors now manage templates on purpose.
4. **Fixed (0929fc0). An event with its own timezone moved on every save** (verified): `wallClock` reads the
   stored time in SITE_TZ and `localToUtc` then treats it as the event's zone
   (`src/lib/admin/save.ts:38,80`). A Los Angeles event on a New York site moved 3 hours per save.
   Also hits events restored from drafts after a site timezone change (`moveEventsToTimezone` doesn't
   update drafts).
5. **Fixed (ae0142c). Event queries stopped at 1,000 rows** (verified): now paged via
   `src/lib/rows.ts`.

### Medium

- **Fixed (b4c3062). New pages published at their placeholder address** (verified), like `/new-page-m1ab2c/`:
  nothing replaces it from the title (only RecordEditor does), and an empty slug is accepted.
- **Fixed (b4c3062). A malformed `%` in a /media/ URL returned a 500** for the whole page (verified;
  `modernize.ts:20`, decodeURIComponent without try).
- **Fixed (70bea0e). Slider collections didn't work without a site Swiper script** (verified): they call
  `new Swiper(...)` but the core loads only Swiper's CSS. (A site loaded the script in
  its pageScripts; the example site doesn't.)
- **Fixed (70bea0e).** All collections on a page shared one `?query-page=`: paging one moves the others
  (`prepare.ts:144`).
- **Fixed (70bea0e).** Uploads could overwrite another image's files: uploading `photo-300x300.jpg` replaces
  `photo.jpg`'s thumbnail and its AVIF/WebP copies (`media/index.ts:19`, upsert).
- **Fixed (70bea0e).** Unpublish marked unsaved edits as saved (`Editor.tsx:358`), so the leave-page warning is
  lost; edits made during a save are also marked saved.
- **Fixed (02f8853).** Opening a page flattened nested lists (`resolveList`, `config.tsx:57`); the next save
  stores them flat.
- **Fixed (02f8853).** Form builder: renaming a choice broke conditional rules without warning; "Edit as list"
  drops custom values; choices whose labels end in a space can't be submitted.
- **Fixed (02f8853).** Long Compose conversations stopped working: every turn re-sends every earlier PDF and image,
  and past the API's limits every later turn fails; there's no way to start a new conversation.
- **Fixed (02f8853).** Two Compose turns could run at once for one conversation (the 409 check is a read before a
  slow step): lost turns or duplicate entries.
- **Fixed (0929fc0).** Event times jump when the editor's browser is in another timezone
  (`entry-fields.tsx:283`).

### Low

- **Fixed (ba40012).** Any signed-up account (new accounts are viewers) could read form notification addresses.
- **Fixed (ba40012).** Anyone could insert form submissions directly with the public key (`with check (true)`).
- **Fixed (8a78ebd).** The CSV export doesn't neutralise formulas (`=`, `+`, `@`).
- **Fixed (ba40012).** `/media/..%5c..` fetched any path on the Supabase host through the site's domain, cached a year.
- **Fixed (8a78ebd).** DNS rebinding gets past the Compose link guard.
- **Fixed (8a78ebd).** A linked PDF is read with no size cap.
- **Fixed (8a78ebd).** Invalid calendar dates (`/events/month/2026-13/`) return a 500.
- **Fixed (8a78ebd).** iCal: `'\;'` escapes nothing, long lines can be cut mid-emoji. (Events with their own zone
  exported under SITE_TZ: fixed in 0929fc0.)
- **Fixed (8a78ebd).** Texturize breaks inline scripts that contain `<`.
- **Fixed (8a78ebd).** Live search can highlight inside `&amp;`, showing broken text.
- **Fixed (8a78ebd).** A changed focal point keeps the same image URLs (cached a year), so visitors keep the old crop;
  saving only the alt text re-crops every size.
- **Fixed (8a78ebd).** Animated WebP is saved as a still image.
- **Fixed (8a78ebd).** `src/lib/paths.ts:4` imports from `src/site/` directly.

### Checked and found sound

The middleware's path checks (encoding and traversal tricks tried), CSRF, the login redirect, search
filter escaping, recurrence limits and DST, Compose's job claim and heartbeat, and cache headers (no
draft content reaches the CDN).
