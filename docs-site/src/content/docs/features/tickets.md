---
title: Tickets
description: Selling tickets and taking registrations for events, with Stripe or Square, waitlists and ticket emails.
sidebar:
  order: 6
---

An event sells tickets (or takes free registrations) when **Tickets** is on in its settings. Free
tickets need nothing else; paid ones go through Stripe or Square, chosen under **Settings > Tickets**.

## An event's tickets

In the event's settings, under Tickets (stored in `fields.tickets`, `src/lib/tickets/config.ts`):

- **Ticket types**: name, description, price (empty or 0 is free), how many there are, the most in one
  order, and when they're on sale (empty: now, until the event ends). A type no longer offered stays for
  past orders.
- **Capacity**: all types together. A recurring event sells each date separately, with the same capacity
  for each.
- **Waitlist**: off; on, emailing people as tickets free up; or on, notified by hand from the attendee list.
- **Buyers are asked**: name and email always; phone (optional or required); address (for paid orders,
  or always); and questions of your own (short or long text, a choice, a checkbox, a number).

The ticket form shows below the event's content in the Event details block, with the prices in its
sidebar. A template without Event details can place the **Tickets** block instead.

## Buying

1. The form posts to `/api/tickets/checkout`. The server checks the order (what's on sale, quantities,
   the required fields) and holds the tickets in one database call (`ticket_order_create`), which locks
   the event and date so two buyers can't both take the last ticket.
2. A free order is confirmed at once. A paid one is held (30 minutes by default) and the buyer goes to
   Stripe Checkout or a Square payment link.
3. Back from paying (`/api/tickets/return`), the payment is checked with the provider and the event page
   shows the order (`?order=<token>`, never cached). The provider's webhook confirms it too, whichever
   comes first.
4. The confirmation goes to the buyer, with a copy to the site's admin address.

Cancelling at Stripe gives the tickets back at once; an unpaid hold expires on its own (the hourly
function closes Square's payment links, which don't expire).

## The attendee list

**Tickets** in the admin lists the events that sell tickets, with what each has sold. An event's
attendee list (`/admin/tickets/<id>/`):

- orders by status, searchable, with a checkbox to check people in at the door
- each order's details: phone, address, answers, payment, emails sent
- **Resend confirmation**, **Cancel order** (unpaid or free orders) and **Refund** (admins: all or part of a
  paid order, at Stripe or Square; refunding all of it puts its tickets back on sale)
- the waitlist, with **Notify selected** and **Notify as many as tickets allow**
- the event's own **Emails**
- **Export CSV** and **Print**

Refunds made in the Stripe or Square dashboard are recorded too, through the webhook.

## Emails

Five emails, each designed in the same email builder as form notifications: the **confirmation**, a
**reminder** before the event, a **follow-up** after it, the **waitlist** notice, and the **copy to the
admin** of each order. Besides the usual blocks they have:

- merge tags such as `{first_name}`, `{event}`, `{date}`, `{code}`, `{order_link}`, `{attendee_link}`
- an **Order details** block: the order summary as a table, or one detail (date, venue, code, tickets,
  total, answers, the buyer's contact details)
- a Preview filled in with a sample order

Settings > Tickets holds the site's emails, when the reminder (hours before the event) and follow-up
(hours after it) go out, and whether the admin gets a copy. An event can have its own on its attendee
list's **Emails** tab, and turn the reminder or follow-up off. `netlify/functions/ticket-emails.mts`
sends reminders and follow-ups hourly on the deployed site, over the same SMTP settings as form
notifications.

## Setting up payments

Stripe: set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and add a webhook for
`https://<site>/api/tickets/webhook/stripe` with the events `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`checkout.session.expired` and `charge.refunded`.

Square: set `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID` and `SQUARE_WEBHOOK_SIGNATURE_KEY`
(`SQUARE_ENVIRONMENT=sandbox` to test), and subscribe `https://<site>/api/tickets/webhook/square` to
`payment.created`, `payment.updated`, `refund.created` and `refund.updated`.

Orders, waitlists and events' own emails aren't part of sync, backups or snapshots: they stay on the copy where they were made.
