---
title: Tickets
description: Selling tickets and taking registrations for events, with Stripe or Square, waitlists and ticket emails.
sidebar:
  order: 6
---

With [Events](../events/) on, an event sells tickets (or takes free registrations) when it has
ticket types: add them in its settings, under Tickets. Free tickets need nothing else; paid ones go through Stripe or Square, whichever has its keys set (chosen
under **Settings > Tickets** when both do).

## An event's tickets

In the event's settings, under Tickets (stored in `fields.tickets`, `src/lib/tickets/config.ts`):

- **Ticket types**: name, description, price (empty or 0 is free), how many there are, the most in one
  order, and when they're on sale (empty: now, until the event ends). A type no longer offered stays for
  past orders; to stop selling, mark every type no longer offered or remove them.
- **Capacity**: all types together (empty: no limit; 0: sold out, as for a type's own number). A
  recurring event sells each date separately, with the same capacity
  for each.
- **Waitlist**: off; on, emailing people as tickets free up; or on, notified by hand from the attendee list.
- **Members** (when Members is on): a price per membership level, and members-only types. See
  [Members](../members/).
- **Buyers are asked**: name and email always; phone (optional or required); address (for paid orders,
  or always); and questions of your own (short or long text, a choice, a checkbox, a number).

The ticket form shows below the event's content in the Event details block, with the prices in its
sidebar.

The **Tickets** block puts an event's ticket form on any page or template. Choose the event in its
settings (and, for a recurring event, a date; empty: its next date), and it shows that event's name and
date over the form. With no event chosen it shows the tickets of the event whose page it is on, so an
event template can place it instead of relying on Event details (which then leaves its own form out).
A page can have several. For an event that doesn't sell tickets (no ticket types, or Events off) the
block shows nothing, so a template's Tickets block appears only on events that sell them. In the editor
the block shows the whole form; without an event that sells tickets, with sample ticket types and a note
saying why (a template's block on such an event's page shows nothing there, as on the site).
Buyers come back to the page they ordered on, and their emails link there; people on a waitlist are
sent back to where they joined.

## Buying

1. The form posts to `/api/tickets/checkout`. The server checks the order (what's on sale, quantities,
   the required fields) and holds the tickets in one database call (`ticket_order_create`), which locks
   the event and date so two buyers can't both take the last ticket. One buyer (by address and by email)
   gets at most 5 unpaid orders an hour per event, and can hold at most twice the most per order at once.
2. A free order is confirmed at once. A paid one is held (30 minutes by default) and the buyer goes to
   Stripe Checkout or a Square payment link.
3. Back from paying (`/api/tickets/return`), the payment is checked with the provider and the page the
   order was placed on shows it (`?order=<token>`, never cached). The provider's webhook confirms it too, whichever
   comes first.
4. The confirmation goes to the buyer, with a copy to the site's admin address.

Cancelling at Stripe gives the tickets back at once; an unpaid hold expires on its own (the hourly
function closes Square's payment links, which don't expire).

## The attendee list

**Tickets** in the admin lists the events that sell tickets, with what each has sold. An event's
attendee list (`/admin/tickets/<id>/`):

- orders by status, searchable, with a checkbox to check people in at the door
- each order's details: phone, address, answers, payment, emails sent
- **Resend confirmation**, **Cancel order** (unpaid or free orders; an unpaid one is checked with the
  provider first, and if it was paid after all it's marked paid instead) and **Refund** (admins: all or
  part of a paid order, at Stripe or Square; refunding all of it puts its tickets back on sale; a refund
  the provider refuses isn't recorded)
- the waitlist, with **Notify selected** and **Notify as many as tickets allow**
- the event's own **Emails**
- **Export CSV** and **Print**

Refunds made in the Stripe or Square dashboard are recorded too, through the webhook, and a refund that
fails later comes off the order again. An order paid after it was cancelled or expired is marked paid
with a note in its details, so you can refund it if you need to.

## Emails

Five emails, each designed in the same email builder as form notifications: the **confirmation**, a
**reminder** before the event, a **follow-up** after it, the **waitlist** notice, and the **copy to the
admin** of each order. One nobody has designed (for the event or the site) is sent from the default
template for that email, if one is set (see Email templates in Forms), else the built-in email. Besides
the usual blocks they have:

- merge tags such as `{first_name}`, `{event}`, `{date}`, `{code}`, `{order_link}` (the order, on the
  page it was placed on; in the waitlist email, the tickets where they joined), `{attendee_link}`
- an **Order details** block: the order summary as a table, or one detail (date, venue, code, tickets,
  total, answers, the buyer's contact details)
- the **Payment** block, as in form notifications: the order's tickets, total, provider, payment ID and
  date (nothing for free orders)
- the **Events** block, as in form notifications: upcoming or picked events (in a follow-up, say, what's
  on next)
- a Preview filled in with a sample order

Settings > Tickets holds the site's emails, when the reminder (hours before the event) and follow-up
(hours after it) go out, and whether the admin gets a copy. An event can have its own on its attendee
list's **Emails** tab, and turn the reminder or follow-up off. The Worker's hourly run (`src/worker.ts`)
sends reminders and follow-ups on the deployed site, over the same SMTP settings as form
notifications.

## Setting up payments

Tickets and forms share the payment settings and webhooks: see [Forms](../forms/#setting-up-the-providers).

Orders, waitlists and events' own emails aren't part of sync, backups or snapshots: they stay on the copy where they were made.
