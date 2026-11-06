---
title: Events and tickets
description: "Adding events and venues, repeating events, the calendar, and selling tickets or taking sign-ups, from setting them up to the door."
sidebar:
  order: 8
---

If your site lists events, they appear under **Content**, **Events**, and on your site's calendar at
`/events/`. Places are kept under **Content**, **Venues**. Tickets and sign-ups are under **People**,
**Tickets**.

:::note
If you don't see **Events** under **Content**, events are turned off. Nothing is lost while they are off;
an admin turns them on under **Settings**, **Events** (see [Turning features on](/admins/features/#events)).
While events are off, the site shows no events, calendar or ticket sales.
:::

## Adding an event

1. Click **Content**, then **Events**, then **New Event**.
2. Give it a **Title** in the right-hand panel.
3. Set **Starts** and **Ends**: click each box and pick the date and time.
4. Pick the **Venue** under **Details** (see [Choosing a venue](#choosing-a-venue)).
5. Describe the event on the page itself, as with any page (see [Using the page editor](/editors/page-editor/)).
6. Add a **Featured image**: it is shown at the top of the event's page, on the calendar and in event lists.
7. Click **Publish**.

The event appears on the calendar straight away, and visitors can add it to their own calendars.

Have a flyer or a poster? **Compose** beside **New Event** writes the event's page from it, and fills in
the cost and website for you to check (see [Writing with Claude](/editors/writing-with-claude/)).

The **Events** list is sorted by start date, newest first, and shows when each one **Starts**.

### Every setting of an event

With nothing selected on the page, the right-hand panel shows the event's settings. Besides the ones every
page has (**Title**, **Slug**, **Template**, **Excerpt**, **Featured image**, **Tags** and **SEO**, see
[The page's settings](/editors/page-editor/#the-pages-settings)), an event has:

| Setting | What it does |
| --- | --- |
| **Event category** | Tick the categories the event belongs to. They show as a label on the event's page and on the calendar, and each category has its own page listing its events. New categories are added under **Content**, **Taxonomies**. |
| **Starts** and **Ends** | The date and time the event begins and finishes. An event with no date yet shows "To be announced". |
| **Time zone** | Leave it empty to use the site's time zone. Choose another only for an event held somewhere else: its times are then in that zone, and visitors see the zone's short name beside them. Changing it keeps the clock times you typed (7:00 pm stays 7:00 pm, now in the new zone). |
| **All-day event** | Turn on for an event with no set times. The site then says **All day** instead of a time. |
| **Repeats** | For an event that happens more than once. See [Events that repeat](#events-that-repeat). |
| **Venue** | Where it happens (under **Details**). |
| **Cost** | The price as you want it written, for example "$25, kids free". It is shown in the event's details, unless the event sells tickets, when the ticket prices are shown instead. |
| **Event website** | A link to another website about the event. Click **Find** beside it to link to a page of your own site instead. |
| **Schedule** | A programme, day by day. See [A schedule](#a-schedule). |
| **Featured** | Only when an admin has turned on Featured for events ([see how](/admins/content-types/#featured-content)). Featured events are marked **Featured** on the calendar, and lists can show featured events only. |
| **Sells** (under **Tickets**) | The ticket this event sells. See [Selling tickets or taking sign-ups](#selling-tickets-or-taking-sign-ups). |
| **Members only** (under **Members**) | Only when your site has members. Everyone else sees the title, short description and picture with a sign-in link. |

Your site may have a few extra settings of its own under **Details**, such as who the event is for.

### Choosing a venue

Under **Details**, beside **Venue**:

- **Choose venue** opens a search box. Type part of the name and click the venue in the list.
- **New venue** adds a place that isn't there yet: type its **Name** and, if you like, its **Street
  address**, **City**, **State** and **Postal code**, then click **Add venue**. It is saved at once and
  chosen for this event. (If you searched first and found nothing, click **New venue** with the name you
  typed.)

Once a venue is chosen, **Change** picks another, **Edit** opens the venue in a new tab and **Remove**
leaves the event without one.

### A schedule

For a festival or a conference, fill in **Schedule** under **Details**:

1. Click **Add day** and type the **Day**, for example "Saturday 18th".
2. Under it, click **Add item** for each part of the day, and fill in its **Time**, **Title**,
   **Location** and **Note**.
3. Use **Up**, **Down** and **Remove** to put days and items in order.

The schedule is shown under the event's description, headed **Schedule**.

## Events that repeat

For a weekly class or a monthly meeting, set **Starts** and **Ends** for the first date, then use
**Repeats** in the event's settings:

1. Choose **Daily**, **Weekly**, **Monthly** or **Yearly** (**Does not repeat** turns it off).
2. **Every how many days** (or weeks, months, years): 1 for every time, 2 for every other, and so on.
3. **Weekly**: click the days of the week it is on. The first date's weekday is chosen to begin with.
4. **Monthly**: under **On**, choose the same date each month (for example **Day 14 of the month**) or the
   same weekday (for example **The second Tue**).
5. **Ends**:
   - **Never (shows two years ahead)**: the calendar lists dates up to two years from today.
   - **On a date**: then pick the **Last date**.
   - **After a number of times**: then type the **Number of times**, counting the first.
6. **Skip dates** leaves out particular days (a holiday, say), and **Extra dates** adds one-off dates at
   the usual time. Type each date as YYYY-MM-DD (for example 2026-12-24), one per line.

Under the settings, a line says how many dates there are and lists the first few, so you can check them.

How repeating events work on the site:

- Each date gets its own page, at the event's address followed by the date, for example
  `/event/yoga-in-the-park/2026-11-14/`. The event's own address, `/event/yoga-in-the-park/`, takes
  visitors to the next date.
- The first date is always the one in **Starts**, even if it falls on a weekday you didn't pick.
- Every date shares the same description, venue and settings. To change one date only, skip it and make
  a separate event for it.
- If the event sells tickets, each date sells its own tickets (see
  [One repeating event](#one-repeating-event)).

## Venues

Venues are kept once and reused by every event held there. Find them under **Content**, **Venues**, or
click **Edit** beside an event's venue.

A venue's page has its **Name**, **Status** (**Published** or **Draft**), **Street address**, **City**,
**State**, **Postal code**, **Country**, **Phone** and **Website**. Click **Save** when done. On the right,
**Events at this venue** lists the events held there.

Correct an address or phone number here, and every event at that venue updates. On an event's page the
venue is shown with its address, its phone number (which phones can call with a tap) and a **Get
directions** link to a map. Venues have no page of their own.

To add a venue without an event, click **Content**, **Venues**, then **New Venue**.

## The calendar on your site

The site makes its calendar pages for you:

| Address | What it shows |
| --- | --- |
| `/events/` | Upcoming events, 10 to a page, grouped by month. **More events** and **Previous events** move between pages. |
| `/events/past/` | Past events, newest first. |
| `/events/month/2026-11/` | One month as a calendar grid (up to three events a day, then "+2 more"). On a phone, the month's events are listed under it. |
| `/events/day/2026-11-14/` | One day's events. `/events/today/` shows today. |
| `/events/category/music/` | The events in one category. |

Visitors can switch between **List**, **Month** and **Day**, search with **Search events**, pick a date
(**From**, **Month** or **Date**) and click **Find events**. **Subscribe to calendar** adds the whole
calendar to Google Calendar, Apple Calendar or Outlook, or downloads it as a `.ics` file, and keeps it up
to date. A search or month carries into the subscription too.

Each event's page has **Google Calendar** and **iCal / Outlook** links to add that one event. Once an event
is over, its page says "This event has passed" with a link to upcoming events.

An admin can change the template the calendar uses, or turn the calendar pages off, under **Settings**,
**Types** (see [Menu and settings](/admins/settings/)).

## Event blocks

These blocks are offered in the page editor while events are on. See
[Using the page editor](/editors/page-editor/) for adding and changing blocks in general.

| Block | Where to find it | What it does |
| --- | --- | --- |
| **Events calendar** | Lists and listings | Upcoming events on any page, such as the home page, as a month calendar or a list. Visitors switch between **Calendar** and **List** and move between months without leaving the page, and **All events** links to the full calendar. Settings: **Title** (none if empty), **Shows first** (**Calendar** or **List**), **Events in the list** (6 if empty), **Categories (any of)** and **Tagged with (any of)** to show only some events. |
| **Events page (list, month, day)** | Lists and listings | The full calendar with its search, views and subscribe links. It belongs in the template of the calendar pages at `/events/`; it has no settings. |
| **Event details** | Site | The event's page in one block: its picture, title and categories, the description, and beside it the date and time, venue, tickets or cost, website and category, then the schedule. Used in the event template; offered only on events and in templates. |
| **Event schedule** | Site | The event's **Schedule** on its own, for a template that places it somewhere else. |
| **Event date** | Card fields | An event's date in a card of a **Collection** (a list of events). **Date format (PHP)** sets how it looks: `M j, Y` (the default) gives "Nov 14, 2026", `l j F` gives "Saturday 14 November". An event over several days shows both dates. |
| **Tickets** | Site | The booking form for a ticket. See [The Tickets block](#the-tickets-block). |

A **Collection** block can also list events, as cards (see [Using the page editor](/editors/page-editor/)).

## Selling tickets or taking sign-ups

Tickets work the same way for paid tickets and for free sign-ups. A **ticket** is set up once under
**People**, **Tickets**: its kinds (such as "Adult" and "Child"), prices, how many there are and what
buyers are asked. An event sells the ticket it is attached to. One ticket can be sold at several events
from one pool, like a festival pass.

Free tickets work straight away. Paid tickets need card payments set up for your site by an admin (see
[Turning features on](/admins/features/#tickets) and [Connections](/admins/connections/)).

### Making a ticket

**From the event** (the quickest way):

1. Open the event. In its settings, under **Tickets**, choose **New ticket for this event…** in **Sells**.
2. Change the **New ticket's name** if you like, then press **Make**.
3. The ticket opens in a new tab on **Ticket types and settings**. Set it up (below) and press **Save
   tickets**.

**From the Tickets list**:

1. Click **People**, then **Tickets**.
2. Type a name next to **New ticket**, for example "Summer pass", and press **Make ticket**.
3. Set it up (below), press **Save tickets**, then attach its events (see
   [Attaching events](#attaching-events)).

If another ticket already has that name, a number is added (for example "Christmas Stroll 2").

### Ticket types and settings

A ticket's **Ticket types and settings** tab has its **Name** (for you, and for emails and orders when it
sells at several events; with one event they use the event's name), the events selling it, and the
setup. Nothing is kept until you press **Save tickets**; the line beside it says **Unsaved changes** until
then, and the browser asks before you leave with changes.

**Ticket types.** Press **Add ticket type** for each kind of ticket. The first is called "General
admission" to begin with. Click a type to open it; **Up**, **Down** and **Remove** put types in order or
take one away. Each type has:

| Setting | What it does |
| --- | --- |
| **Name** | What buyers choose, such as "Adult", "Student" or "Free entry". |
| **Description** | A line under the name, such as "With a student ID". |
| **Price (empty or 0: free)** | Type it as 25 or 12.50. An order has to come to at least 0.50 to be paid online; a smaller one is refused, and the box warns you. |
| **How many of this type** | Leave **Unlimited** on, or turn it off and enter the **Number available**. 0 means none left: the type shows as sold out. |
| **Most in one order** | The most of this type one person can buy at once. |
| **On sale from (empty: now)** | When this type goes on sale. |
| **On sale until (empty: until the event ends)** | When its sales close. |
| **No longer offered (kept for past orders)** | Stops selling a type without losing the orders already made for it. |
| **Members** | Only when your site has members: a price for each membership level (empty: the usual price), and **Members only**, with **Levels that may buy it (none ticked: all)**. |

A type's row shows how many are available, "(0 available: sold out)" or "(not offered)". Sales
times are in the event's time zone.

**The whole ticket:**

| Setting | What it does |
| --- | --- |
| **Heading** | The heading over the booking form ("Tickets" if empty). |
| **Capacity: tickets of all types together** | The most tickets of all types together, such as the size of the room. Leave **Unlimited** on, or turn it off and enter the **Number available** (0: every type shows as sold out). For one repeating event, this is for each date. |
| **Most tickets in one order (default 10)** | The most tickets of all types in one order. |
| **Waitlist when sold out** | **Off**; **On: email people as tickets free up** (the site emails the people waiting, in order, as tickets come back on sale); or **On: notify people from the attendee list** (you choose when, see [The waitlist](#the-waitlist)). |

**Buyers are asked** their name and email always, and:

- **Phone**: **Not asked**, **Optional** or **Required**.
- **Address**: **Not asked**, **For paid orders** or **Always**.
- **Questions of your own**: press **Add question** for each one, asked once per order. Each has its
  **Question**, its **Answer** type (**Short text**, **Long text**, **Choose one** with **Choices, one per
  line**, **Checkbox (yes)** or **Number**), an optional **Help text** shown under it, and **Required**.

**Emails**: buyers get the site's ticket emails; **Give this ticket its own** opens the **Emails** tab
(see [The ticket's emails](#the-tickets-emails)).

**Delete ticket**, at the bottom, is there only while a ticket has no orders. Its events stop selling
tickets, and it can't be undone.

### Attaching events

On the ticket's **Ticket types and settings** tab, under **Events selling this ticket**:

- **To attach an event**: choose it in **Choose an event** and press **Attach**. If it already sells
  another ticket, the list says so ("sells ..."), and attaching it here stops it selling the other one;
  orders already made stay with that ticket.
- **To stop an event selling the ticket**: press **Detach** beside it. Its orders stay with the ticket.

Or, from the event: choose the ticket under **Tickets**, **Sells** in the event's settings, or **No
tickets** to stop selling. This is saved at once, without publishing the event. **Manage ticket** opens
the ticket's setup in a new tab.

The booking form then appears on the event's page once the event is published, under its description,
whatever template the event uses. To put it somewhere else on the page, add a **Tickets** block there.

:::note
**Duplicate** makes a copy of an event that sells no tickets. Attach the copy to a ticket if it should.
:::

### One ticket for several events

Attach several events to the same ticket (a festival weekend, or a pass for a series of talks). Tickets
bought at any of them count against the same ticket types and capacity. Sales close when the last of the
events ends.

The ticket's **Orders** tab shows everyone, with **Bought at** and the event each person booked at.
Choose an event in the **Bought at** list at the top to see only its bookings, or **All events** for
everyone.

### One repeating event

A ticket attached to a single repeating event sells each date separately: each date has its own
capacity, orders, waitlist and attendee list. On the ticket's page, choose the date in the list at the
top. The event's page for each date sells tickets for that date.

### The Tickets block

To sell a ticket on any other page (a home page, or a "What's on" page), or in another place on the
event's page:

1. Add a **Tickets** block (under **Site** in **Blocks**).
2. Under **Ticket**, choose the ticket. Each is listed with how many events sell it. Left as **The
   page's event's ticket**, the block shows the ticket of the event whose page it is on (in an event
   template, each event's own).
3. For a ticket of one repeating event, **Date (a ticket for one recurring event; empty: its next)** picks
   the date.
4. **Heading** replaces the heading over the form, if you want another.

**Manage ticket** opens the ticket's setup in a new tab. On another page, the block shows the event's name
and date over the form; for a ticket sold at several events, it lists them under the ticket's name. A page
can have several Tickets blocks.

In the editor, a block whose ticket doesn't sell yet shows sample tickets and a note saying why (for
example, the ticket has no ticket types, or no published event sells it). Visitors see nothing there until
it does.

## What visitors see

The booking form lists each ticket type with its price and a number to choose, then asks for the buyer's
**Name**, **Email** and anything else you set up. Along the way it shows:

- The running total as tickets are chosen.
- "3 left" when ten or fewer of a type remain.
- **On sale** with a date for a type not on sale yet, **Sales ended**, **Sold out** or **Members only**
  beside a type that can't be bought now.
- "Tickets go on sale" with a date when nothing is on sale yet, and "Ticket sales for this event have
  closed." once they are over.
- **Sold out.** when every type is gone, with the waitlist form if there is a waitlist: **Tickets
  wanted** and **Join the waitlist**.
- With members: **Member price** for a signed-in member, or what members pay and a **Sign in** link for
  everyone else.

The button says **Register** when everything chosen is free, and **Continue to payment** when it isn't.

**What happens next:**

1. The tickets are set aside straight away, so nobody else can take them while the buyer finishes.
2. **Free tickets**: the order is confirmed at once. The page says "You're going" with the buyer's
   **order code** to show at the door, and the confirmation email goes out.
3. **Paid tickets**: the buyer goes to a secure payment page (Stripe or Square). Their tickets are held
   while they pay (for the time an admin sets, 30 minutes unless changed). When they come back, the page
   says "Confirming your payment…", then shows the order code; the confirmation email goes out once the
   payment is through. If they never come back, the payment is still picked up and confirmed.
4. If they cancel the payment, or don't pay in time, the tickets go back on sale.

If something stops an order, the form shows why:

| Message | Why |
| --- | --- |
| Sorry, there are not enough tickets left for that order. Please choose fewer. | Someone else took the last ones. |
| Please check your order: choose at least one ticket and fill in the required fields. | Something is missing. |
| You have tickets set aside for this event, or several orders started, that are not paid for yet. ... | One person started too many unpaid orders; they can finish one, or try again in an hour. |
| That order comes to less than the smallest amount we can take online. ... | The total is under 0.50. |
| Online payment is not available right now. Please contact us to buy tickets. | Card payments aren't set up: ask an admin. |
| Your payment was cancelled and nothing was charged. You can try again below. | The buyer cancelled on the payment page. |
| Your order expired before it was paid. Please start again. | The hold ran out. |
| Some of those tickets are for members. Sign in to buy them. | Members-only tickets, and the buyer isn't signed in as a member. |

## Who is coming

Click **People**, then **Tickets**, to see every ticket with its **Events**, tickets **Sold** (and the
capacity), **Orders**, **Takings** and **Waitlist**. Click a ticket's name (or **Attendees**) to see its
orders, or **Ticket types** to change its setup.

At the top of a ticket's page are **Tickets sold**, **Checked in**, **Takings (after refunds)** and
**Waitlist**, and how many of each type are sold. The tabs are **Orders**, **Ticket types and settings**,
**Emails** and, when there is a waitlist, **Waitlist**.

### The Orders tab

Choose which orders to see: **Attendees** (paid and free orders), **Awaiting payment**, **Cancelled and
expired**, **Refunded** or **All orders**. The search box finds an order by **Name, email or code**.

Each row has the buyer, their **Code**, **Tickets**, **Total** and **Status**. Click **Details** to see
their address and answers, when they ordered and paid, the payment, which emails they were sent, and:

| Action | What it does |
| --- | --- |
| **In** (the tick box) | Tick people off at the door. It saves as you tick, and **Checked in** at the top follows. |
| **Email** (their first name) | Writes to them from your own email program. |
| **Resend confirmation** | Sends the confirmation email again, if they lost it. |
| **Cancel order** | For an order awaiting payment or expired, and for free orders. Its tickets go back on sale. A paid order is refunded instead. |
| **Refund** | Admins only: type the amount (all of it to begin with) and press **Refund**. The money goes back to their card. Refunding all of it puts the tickets back on sale; this can't be undone. Editors see "Refunds are made by admins." |

Along the top:

- **Export CSV**: the orders as a spreadsheet, with each buyer's code, details, tickets, total, status,
  check-in and answers.
- **Print**: a paper list for the door.
- The date list (one repeating event) or **Bought at** list (several events).

### The waitlist

When tickets are sold out and the ticket has a waitlist, visitors can join it. The **Waitlist** tab lists
them in order, with how many tickets each **Wants**, when they **Joined** and their status: **Waiting**,
**Notified** (with when) or **Bought tickets**.

- **Notify as many as tickets allow** emails the people waiting, in order, as far as the tickets on sale
  now go.
- **Notify selected** emails the people you tick.
- **Remove** takes someone off the list.

Notified people are told tickets are available; whoever buys first gets them. With **On: email people as
tickets free up**, the site does this itself after a cancellation or refund, and once an hour.

### The ticket's emails

Buyers get the site's ticket emails, which an admin designs under **Settings**, **Tickets**. The **Emails**
tab gives one ticket its own:

| Email | When it goes |
| --- | --- |
| **Confirmation** | To the buyer when an order is paid, or at once for free tickets. |
| **Reminder** | To everyone with a paid order, before the event (when reminders are on under Settings > Tickets). |
| **Follow-up** | To everyone with a paid order, after the event (when follow-ups are on under Settings > Tickets). |
| **Waitlist: tickets available** | To people on the waitlist when tickets free up. |
| **Copy to the admin** | The copy of each order to the site's admin address. |

For each one:

1. Change the **Subject** if you like.
2. Click **Edit email** to design it in the email builder (the same as a form's emails, see
   [Forms](/editors/forms/)). Its **Visual** tab has blocks such as **Heading**, **Text**, **Button**,
   **Image**, **Order details** (the order as a table, or one part of it), **Payment** and **Events**. The
   **Plain text** tab is the text version, and **Preview** shows it with a sample order. **Templates**
   saves or reuses a design.
3. Click **Done**: the design is saved for this ticket. A changed **Subject** is kept with **Save**,
   which shows beside it.

**Insert field value…** adds the buyer's details to the text, such as their **First name**, the **Event
title**, **Event date**, **Venue and address**, **Tickets bought**, **Order code** and **Link to the
order (waitlist: to the tickets)**.

Beside **Edit email**, **Designed here** means this ticket sends its own; **Not changed yet** means it uses
the site's. **Reset to the default** goes back to the site's. For the reminder and follow-up, **Don't send
it for this event** turns them off for this ticket only.

## What needs an admin

- Turning events on, and the site's time zone: **Settings**, **Events**.
- Card payments, the currency, how long unpaid orders hold their tickets, the site's ticket emails and
  when reminders and follow-ups go out: **Settings**, **Tickets** (see
  [Turning features on](/admins/features/#tickets)), with Stripe or Square connected under
  **Settings**, **Connections** (see [Connections](/admins/connections/)).
- Refunds.
- Membership levels for member prices (see [Turning features on](/admins/features/#members)).
