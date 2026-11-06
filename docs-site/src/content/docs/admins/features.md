---
title: Turning features on
description: "Events, tickets, members, mailing lists and the accessibility check before publishing."
sidebar:
  order: 2
---

Some parts of the site are only there when you need them. Each is turned on in **Settings**, under
**Features**, where it is marked **On** or **Off**. Turning one off hides it but deletes nothing: turn it
on again and everything is still there.

## Events

**Settings > Events**: tick the box to turn events on, and set the site's time zone. Editors then find
**Events** and **Venues** under **Content**, and the site shows its calendar at `/events/`. See
[Events and tickets](/editors/events-and-tickets/) in the Editor guide.

Changing the time zone moves events that use it to the new one, keeping their local times.

## Tickets

**Settings > Tickets**, once events are on: the currency, how long an unpaid order holds its tickets,
and the emails buyers get (confirmation, reminder and follow-up, with when they go out). Free tickets
and sign-ups work as they are. For paid tickets, connect Stripe or Square first (see
[Connections](/admins/connections/)); with both connected, choose which one takes the payments.

## Members

**Settings > Members**: turn members on, name the membership levels, and choose how people join: only
added by an admin, signing up and waiting for an admin to approve them, or signing up and joining at
once. Members are then listed under **People**, **Members** (see [People and access](/admins/people/#members)).

## Mailing lists

**Settings > Mailing Lists**: turn mailing lists on, and fill in the sender's name and address and the
postal address every email must carry. Sending needs Mailgun connected (see
[Connections](/admins/connections/)). **Mailing Lists** then appears under **People**. See
[Mailing lists](/admins/mailing-lists/) for every setting, the lists, subscribers and sending.

## Checking accessibility before publishing

**Settings > Accessibility**: tick **Check accessibility before publishing** and save. Publishing a page
then runs the accessibility check first, and waits if anything is left to fix (see
[Accessibility](/editors/accessibility/#when-publishing-waits-for-the-check)).
