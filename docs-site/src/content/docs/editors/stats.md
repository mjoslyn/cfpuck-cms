---
title: Stats
description: "How many people visit the site, which pages they read, which links they follow and which campaigns bring them."
sidebar:
  order: 10
---

**Stats** in the menu bar shows how the site is used. Editors and admins can see it.

## What it shows

- **Page views**: how many times pages were opened.
- **Visitors**: how many different people came. Without the Stats cookie (below), each person is counted
  once a day, so someone who visits on three days counts three times. With it, each person who accepted
  the cookie counts once for the dates shown, and the tile says how many return visits there were.
- **Links clicked**: how many times people followed a link on the site, to another page or another site.
- **Page views a day**: a bar for each day. Point at a bar (or tab to it) to see that day's views,
  visitors and clicks. **Show as a table** lists the same numbers.
- **Pages**: every page, with its views and **Link clicks** (links followed from that page). Click
  **Views** or **Link clicks** at the top of the list to sort by it.
- **Links clicked**: the links followed most, and how many pages they were clicked from.
- **Where visits came from**: other sites that sent people here, such as a search engine. Visits typed
  in, from bookmarks or from apps don't name a site.
- **Campaigns**: visits that came by a link tagged with a campaign (below).

Choose **7 days**, **30 days**, **90 days** or **Year** at the top, or pick your own dates in **From** and
**To** and press **Show**. Ranges over 90 days show a bar a week.

## Tracking a campaign

To see how many visits a newsletter, an ad or a post brings, add `utm_` tags to the link you share:

`https://example.org/sale/?utm_campaign=spring-sale&utm_source=newsletter&utm_medium=email`

- `utm_campaign`: the campaign's name, such as `spring-sale`.
- `utm_source`: where the link is, such as `newsletter`, `facebook` or `poster`.
- `utm_medium`: the kind of link, such as `email`, `social` or `print`.

Each visit by such a link shows under **Campaigns** with its campaign, source and medium. Free tools such
as Google's Campaign URL Builder make these links.

## Downloading the numbers

Each part has **Download CSV**, a file that opens in Excel, Numbers or Google Sheets, for the dates you
are looking at.

## The Stats cookie

An admin can have Stats recognise returning visitors with a cookie (see
[The Stats cookie](/admins/popups-and-cookies/#the-stats-cookie) in the Admin guide). Without it, a
visitor is counted once a day.

## What isn't counted

- You, and anyone else signed in as an editor or admin.
- Search engines and other machines.
- Previews, and addresses that don't exist.

With the Stats cookie off the site sets no cookies for Stats and keeps no visitors' addresses. Numbers
are kept for about 13 months.
