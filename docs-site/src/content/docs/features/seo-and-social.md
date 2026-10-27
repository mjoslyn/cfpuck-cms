---
title: SEO and social
description: Per-entry SEO settings, meta tags, generated descriptions and social profiles.
sidebar:
  order: 9
---

## Entry SEO

An entry's SEO settings live in `fields.seo` (`src/lib/seo.ts`; `seo` is a reserved field key):

- search title
- meta description
- share image (a media id)
- **Hide from search engines and AI answer engines** (`noindex`): the robots meta tag says
  `noindex, follow, noai, noimageai`, and `/robots.txt` (`src/pages/robots.txt.ts`) disallows the page
  for the crawlers behind AI answers (`AI_CRAWLERS` in `src/lib/ai-crawlers.ts`: GPTBot, ClaudeBot,
  PerplexityBot, Google-Extended and others), which follow robots.txt rather than the tag. Search
  engines' own crawlers aren't disallowed, since they must fetch the page to see noindex. Term pages
  hidden the same way are listed too. A site's own `public/robots.txt` is served instead of this one.
- leave out of this site's search (`nosearch`; entries only): `entry_search` never matches the entry, so
  `/search/` and the search forms' live results leave it out. Lists, menus and search engines are
  unaffected (noindex is for those).

The entry settings' SEO section (`src/puck/SeoForm.tsx`) shows lengths and a search result preview.
**Generate** asks Claude (`POST /api/admin/seo`, `ANTHROPIC_SEO_MODEL`, default Haiku 4.5) for text
from the page as it is in the editor.

Compose includes `seo` in every `build_page` and writes it, marked `generated`, on each build until
someone edits it by hand.

## Term pages

A term's SEO lives in its own fields (Content > Taxonomies, **Details**), with the same settings as an
entry's. Its taxonomy's defaults are under Settings > Types, where `{term}` in the title and
description becomes the term's name. A term page uses:

- **Search title** (and `<title>`): the term's, else the taxonomy's, else the term's name.
- **Meta description**: the term's SEO description, else its description, else the taxonomy's, else the
  site's tagline.
- **Share image**: the term's, else its featured image, else the taxonomy's featured image, else the
  site's default.
- **noindex**: if either the term or its taxonomy sets it. See
[Taxonomies and tags](../../content/taxonomies/#term-details).

## Listing pages

Each type's listing page (`/directory/`, `/events/`, `/news/`...) has its featured image and SEO under
Settings > Types: the **SEO** button beside its listing template's Edit opens them: a search title, a meta description, noindex and a featured
image, which is its share image and shows in a Featured image block on the page (outside a collection).
**Write with Claude** writes the title and description from what the page lists.

The title and description apply on the listing's own address. Views under it, such as the event
calendar's months and days, and searches in it keep their own titles and descriptions; they get the
image and noindex.

## Meta tags

`src/render/meta.ts` writes the head tags: description, canonical, robots, Open Graph and Twitter
card. They fall back to the excerpt, the featured image and the site's default share image. The home
page also gets Organization structured data, with the social profiles as `sameAs`.

## Social profiles

**Settings > Social** keeps the site's profiles (`settings.site.social`: network and URL;
`src/lib/social/links.ts`) and the default share image (`share_image`).

The `social-links` block shows the profiles as icons (`src/lib/social/icons.ts`, Simple Icons paths,
CC0), optionally with names.
