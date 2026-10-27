---
title: Redirects
description: Redirect rules, automatic redirects and the not-found log.
sidebar:
  order: 10
---

**Settings > Redirects** (admins; `/admin/redirects/` forwards there) maps old addresses to new
(301 or 302), in `src/lib/redirects.ts` and the `redirects` table.

## Rules

- **Exact**: covers its own path.
- **Wildcard**: a prefix ending in `*`, covering every path under it. The rest of the path fills a
  `*` in the target.

Whether a rule covers an address is decided in one place, `ruleCovers`.

Redirects apply only when an address would otherwise be Not found (`renderRequest`, before the slug
guess), so they never hide a live page. The exact rule wins, else the wildcard with the longest
prefix. Uses are counted (`redirect_hit`).

A rule that would lead back to itself is refused (`loopReason`: a wildcard whose target is under its
own prefix).

Saving a rule clears the cached entries it covers (for a wildcard, every entry under its prefix). The
API returns the cleared paths and reports a failed clear rather than hiding it.

## Automatic redirects

- A published entry whose address changes gets one (`redirectMovedEntry`).
- A term whose address changes leaves one from the old term page.

## Not found page

When no redirect or guess covers a missing address, the visitor sees the page chosen as **Not found
page** (Settings > General, `settings.site.not_found_page_id`) while it is published: an ordinary page,
edited like any other and rendered through its own template, answered with 404, `noindex` and no
canonical, with `is-404` on the body. Without one, the `404` template (then `index`) is shown. The
page's own address stays an ordinary page, also `noindex`. Listing pages past their last page show it
too.

## Not found log

Addresses still not found are logged (`not_found`, via `not_found_hit`; files, admin and probes are
left out) and listed on the screen with **Add redirect**.

## Site-level redirects

A site can also redirect in code: `redirect(url)` in its `render.ts` (a previous site's URLs) and
`moved-paths.json` (URL prefixes that moved). See [Blocks and hooks](../../site/extending/).
