---
title: Members
description: Member accounts and levels, members-only pages and blocks, and member ticket prices.
sidebar:
  order: 7
---

Members is optional: turn it on under **Settings > Members**. Members have an account on the site and a
membership level. With it you can make pages for members only, show parts of a page to members only,
and give members their own ticket prices or tickets of their own.

## Settings

Under **Settings > Members**:

- **Levels**: the kinds of membership (Individual, Business, Patron...). Pages, blocks and ticket prices
  can be for some levels; none chosen means any level.
- **Sign-ups**: *Admins add members* (no sign-up form), *Sign up, then approved* (visitors create an
  account and wait for an admin) or *Sign up and join* (they're members at once), and the level sign-ups
  get. The site's admin address is emailed about each sign-up.
- **Message** for visitors who can't see something (default "This is for members.").

Members sign in, sign up and reset their password at **/account/**. Make a page with that address to
design it yourself, with the **Member account** block on it. The links in members' emails go there:
invitations and password links (an hour, once) open the form to set a password, and a new account's
confirmation link (a day) confirms the address and signs them in. New accounts confirm their address
before they can sign in unless `AUTH_CONFIRM_EMAIL=false`. The site sends these emails over its SMTP
settings.

## Managing members

**Members** in the admin (admins only) lists everyone with a membership, with tabs by status (waiting
for approval, active, expired, suspended) and a search. For each: name, level, status, expiry date
(empty: never) and notes, saved with **Save**; **Approve** for sign-ups; **Resend invitation** (invited, no password set yet); **Send password link**; and
**Remove**, which ends the membership and deletes the account unless the person also edits the site.
**Add a member** makes an existing account a member, or invites a new address to set a password.

A membership counts while it is active and not past its expiry date.

## Members-only pages

In a page's settings (the editor's sidebar), **Members** > **Members only**, and optionally the levels.
It applies when the page is published. Everyone else sees the page's title, excerpt and featured image
with a sign-in link in place of its content, and it's left out of lists, search and emails for them.
Its content is never sent to anyone else: the site checks who is looking before it reads it, and only
editors can query the site's data, so it can't be read any other way.

## Members only block

The **Members only** block (the Members group in the block list) holds other blocks. Members of its
levels (and editors) see them; everyone else sees a message and a sign-in link, or nothing. The rest of
the page stays public.

Its contents are as safe as a members-only page's: only editors can query the site's data, so the
page's stored content can't be read around the block.

The **Member sign-in link** block is a "Sign in" link to the account page that reads "My account" for
signed-in visitors, for a header or menu.

## Member ticket prices

In an event's ticket types (its settings, Tickets), each type can have a **price per level** (empty: the
regular price) and be **Members only** (optionally for some levels). Signed-in members see and pay their
price; everyone else sees the regular price, what members pay and a sign-in link, and members-only types
marked as such. The checkout charges by the buyer's membership, whatever the form showed, and the order
records the member.

## Pages and caching

Pages are normally cached and shared by every visitor. A page whose content depends on who is looking
(a members-only page, a Members only or Member account block, tickets with member prices) isn't cached,
and is rendered for each signed-in visitor as they may see it. Other pages stay cached.

Members aren't synced between copies of the site or kept in backups; the levels and settings are.

## Members and Mailing

With [Mailing](../mailing/) on, choose **Lists offered to members** under Settings > Mailing Lists. Member
sign-up then offers them (unticked; ticking it sends a confirmation email like any sign-up), and the
account page shows the member's lists to change. Campaigns and digests can go to **only members** (of
some levels) or **only people who aren't members**, matched by email address, and **Add members to a
list** on the Mailing Lists screen's Subscribers tab puts active members on a list when they agreed to it.
