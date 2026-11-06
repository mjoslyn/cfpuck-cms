---
title: Popups and cookie consent
description: "Showing a popup on the site, and asking visitors' consent to cookies."
sidebar:
  order: 6
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

Press **Add a cookie consent banner**. It starts with a heading, a line of text with a link to your privacy
policy, and **Accept** and **Reject** buttons. Press **Edit content** to change any of them: the buttons
are ordinary buttons, so you can change their words, size, colours and corners like any other. Accept
links to `#accept-cookies` and Reject to `#reject-cookies`; keep those links so the buttons work. Point
the policy link at your own privacy page. Turn the banner on and press **Save settings**.

The banner shows on every page until the visitor chooses, and their choice is remembered for six
months. Add a link to `#cookie-settings` somewhere on the site, such as the footer, so visitors can open
it again and change their mind.

Until a visitor accepts:

- The Stats cookie isn't set (see [The Stats cookie](#the-stats-cookie) below).
- Code snippets marked **Only after visitors accept cookies** (Settings > Code snippets) don't run. Tick
  that box for analytics, advertising and other tracking tags.

## The Stats cookie

Turn on **Recognise returning visitors with a cookie** under **Settings > Stats**. The site then keeps a
random number in a cookie in each visitor's browser for 13 months, so [Stats](/editors/stats/) can tell a
returning visitor from a new one.

In the EU and UK the law asks visitors' consent before such a cookie is set. With a cookie consent banner
on, only visitors who accept get the cookie; everyone else is still counted, once a day. Without a banner
every visitor gets it, and Settings warns about that.
