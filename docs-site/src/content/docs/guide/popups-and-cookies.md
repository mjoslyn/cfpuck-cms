---
title: Popups and cookie consent
description: "Showing a popup on the site, and asking visitors' consent to cookies."
sidebar:
  order: 10
---

Popups show a message over the site's pages: a newsletter sign-up, a sale, an announcement. One of them
can be the cookie consent banner. Admins set them up under **Settings > Popups**.

## Making a popup

1. Go to **Settings > Popups** and press **Add a popup**.
2. Press **Edit content**. The popup's content opens in the visual editor in a new tab, like any other
   template part. Add a heading, text, a button, a form or anything else, then **Save & apply**.
3. Back in Settings, choose:
   - **Shown as**: a dialog in the middle of the screen, a bar along the bottom or top, or a box in the
     corner.
   - **Shows**: when the page opens, after some seconds, after scrolling part of the page, or when the
     visitor moves to leave (on computers).
   - **How often**: on every page, once a visit, or once and then again after some days.
   - **On**: every page, only some pages, or every page but some. Write one address a line, such as
     `/about/`. End an address with `*` to cover everything under it, such as `/events/*`.
4. Tick the box at the top to turn it on, then press **Save settings**.

Visitors close a popup with its **×**, the Escape key, or by clicking outside a dialog. A link to
`#close-popup` inside its content closes it too (for a "No thanks" link).

## The cookie consent banner

Press **Add a cookie consent banner**. It starts with a heading and a line of text; change them with
**Edit content**. Set the words on its **Accept** and **Reject** buttons, and the address of your privacy
or cookie policy. Turn it on and press **Save settings**.

The banner shows on every page until the visitor chooses, and their choice is remembered for six
months. Add a link to `#cookie-settings` somewhere on the site, such as the footer, so visitors can open
it again and change their mind.

Until a visitor accepts:

- The Stats cookie isn't set (see [Stats](/cfpuck-cms/guide/stats/)).
- Code snippets marked **Only after visitors accept cookies** (Settings > Code snippets) don't run. Tick
  that box for analytics, advertising and other tracking tags.
