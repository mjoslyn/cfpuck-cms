---
title: Mailing lists
description: "Writing and testing email campaigns, the weekly digest, segments, sign-up forms on your pages, and reading how each email went."
sidebar:
  order: 9
---

Mailing lists let your site send news by email to the people who signed up for it. People join a list
through a sign-up form on your site, and confirm by email before anything is sent to them. You write
**campaigns** (one email, sent once) and can set up a **weekly digest** (an email made each week from
what's new on the site). Afterwards, the site shows how each email went: who it reached, who opened it
and which links people followed.

Editors write and test campaigns and digests. Sending, scheduling and approving them, and looking after
the people on the lists, are for admins (see [Mailing lists](/admins/mailing-lists/) in the Admin guide).

:::note
Mailing lists are a feature an admin turns on under **Settings**, **Mailing Lists**, and the emails go
out through a service called Mailgun, which an admin connects. If you don't see **Mailing Lists** under
**People** in the top bar, the feature is off (see [Turning features on](/admins/features/#mailing-lists)).
:::

## The Mailing Lists screen

Click **People** in the top bar, then **Mailing Lists**. The screen has five tabs:

| Tab | What is in it | What editors can do |
| --- | --- | --- |
| **Campaigns** | Every campaign, newest first. | Make, write, test, copy and delete draft campaigns. |
| **Weekly digests** | The weekly digests and when each goes out. | Make digests and change them while they are off. |
| **Subscribers** | Everyone who signed up or was added, with their status. | Read only. |
| **Lists** | The mailing lists and how many people are on each. | Read only. |
| **Segments** | Saved rules that pick some of the people on a list. | Make, change and delete segments (see below for the limits). |

A coloured line under the title can say:

- **Sending is paused:** with the reason. Nothing goes out, digests included, until an admin resumes it.
- **Add the postal address under Settings > Mailing Lists**: every email must carry the organisation's
  postal address, so nothing can be sent until an admin adds it.
- **Mailgun isn't set up, so nothing is sent**: an admin needs to connect Mailgun first.

## Campaigns

The **Campaigns** tab lists each campaign with its **Lists**, **Status** (with the date it was sent or is
due) and **Recipients** (how many people it went to). A digest's weekly issue shows "digest issue" under
its subject. Click a campaign's name to open it.

A campaign's status is one of:

| Status | What it means |
| --- | --- |
| **Draft** | Being written. Editors can change it. |
| **Waiting for approval** | A weekly digest's issue, waiting for an admin to approve it. |
| **Scheduled** | An admin has set it to go out at a time. |
| **Sending** | Going out now. |
| **Sent** | Gone out, with the date. |
| **Paused** | Stopped part way, by an admin or because sending was paused for the whole site. The reason shows under it. |
| **Cancelled** | Stopped for good. What had gone out stays sent. |
| **Failed** | Something went wrong; the reason shows under it. |
| **Skipped (nothing new)** | A digest issue with too little in it to send. |

### Making a campaign

1. On the **Campaigns** tab, click **New campaign**. The campaign opens, named "New campaign".
2. Fill in its settings (below).
3. Click **Edit the email** to write the email (see [Designing the email](#designing-the-email)).
4. Click **Save** at the top right. Beside it you'll see **Unsaved changes** until you do, and **Saved**
   with the time afterwards. If you try to leave with unsaved changes, your browser asks first.

A new campaign starts with a heading "News from {site_name}", a greeting "Hi {first_name|there}," with
"Write your news here." under it, and a **Read more** button, unless an email template has been chosen
as the default for new campaigns (see [Email templates](#email-templates)). It is set to go to the first
list.

If the tab says **Campaigns go to lists: add a list first.**, there are no lists yet: ask an admin to
make one.

:::tip
To have Claude write the campaign for you, click **Compose** in the top bar, then **Campaign**, and say what
the email is about. See [Having Claude write it](#having-claude-write-it).
:::

### A campaign's settings

| Setting | What it does |
| --- | --- |
| **Name (for you)** | So you can tell campaigns apart. Readers never see it. |
| **Subject** | The subject line people see in their inbox. Tags work here too, such as **{first_name\|there}** or **{site_name}** (see [Merge tags](#merge-tags)). |
| **From name** | The name the email comes from. Empty, it uses the one set under **Settings**, **Mailing Lists**. |
| **Replies go to** | Where replies go. Empty, it uses the one set under **Settings**, **Mailing Lists**. |
| **Email** | **Edit the email** opens the email builder. The box says how many blocks the email has, and whether it has a plain text of its own. |
| **To the lists** | Tick the lists it goes to. Someone on two of them gets it once. |
| **Segment** | **Everyone on those lists**, or a segment, so only the people on those lists who match it get the email. **See who matches** opens the segment. See [Segments](#segments). |
| **Members** | Only on sites with members. **Everyone on those lists**, **Only members** or **Only people who aren't members**. With **Only members**, tick the levels under **Of the levels (none ticked: any)**. Members count when they are active, and are matched by their email address. |
| **Track links (people's clicks told apart from mail scanners')** | Each link in the email goes through your site first, so you can see who followed which link. Ticked unless an admin changed the default. |
| **Add UTM parameters to links to this site** | Adds campaign tags to links to your own site, so the visits they bring show under **Campaigns** in [Stats](/editors/stats/#campaigns) (source "newsletter", medium "email"). Links that already have their own `utm_` tags keep them. |

The **Preview text** shown after the subject in inbox lists is part of the email itself: set it in the email
builder (see below).

### Designing the email

**Edit the email** opens the email builder over the whole screen. It is the same builder as a form's
emails, with **Visual**, **Plain text** and **Preview** tabs and, at the top right, **Templates** and
**Done**. See [Designing the email](/editors/forms/#designing-the-email) in Forms for how it works. Your
changes are kept with the campaign: click **Done**, then **Save**.

With no block selected, the right side shows the email's own settings. The first, **Preview text (after
the subject in the inbox)**, is the short line many mail apps show after the subject. Then the colours,
**Font** and **Width (px)**.

The blocks for mailing emails:

| Block | What it does |
| --- | --- |
| **Heading** | A heading, **Large**, **Medium** or **Small**. Tags are allowed. |
| **Text** | Formatted text with **Insert field value…** for tags. |
| **Button** | A button with a label and a link (a web address, mailto:, a /path on your site, or a tag). |
| **Image** | A picture from the media library, with alt text, width and an optional link. |
| **Subscriber** | The reader's **Name**, **First name**, **Last name** or **Email address** (choose under **Shows**), or one of the site's subscriber fields. |
| **Entries** | Your site's latest posts (or other content), filled in when the email is sent. See below. |
| **Events** | Your next upcoming events, or events you pick (only when your site uses Events). |
| **Section** | A coloured box to group other blocks. |
| **Two columns** | Two blocks side by side. On phones they stack. |
| **Divider** | A thin line. |
| **Spacer** | Empty space of a height you choose. |

#### The Entries block

The **Entries** block lists your site's latest entries, each with its picture, title, short description
and a link. Its settings:

- **Heading (optional)**: "Latest news" to start with.
- **Shows**: under **Of**, tick the kinds of content to list (such as posts); **How many** (1 to 12);
  and, for the kinds that have them, categories or other terms to list only those (**(any of)**).
- **In a digest: only those new since the last issue**: for weekly digests (see below).
- **Show the date**.
- **Image** and **Short description**: **Show** or **Hide**.
- **Link text under each (empty: the title is the link)**: "Read more" to start with.
- **When there are none (empty: the block shows nothing)**: a line to show when there is nothing to list.

The entries are listed when each email is sent, so the email has the latest at that moment. Members-only
entries are always left out. The canvas shows the latest ones now.

#### The Events block

The same as in a form's emails: a **Heading (optional)**, and under **Shows** either **Next upcoming**
(with **How many**, categories and **Featured events only**) or **Picked events**. **Image**, **Venue** and
**Short description** can each be shown or hidden. Past events are left out. It is offered only while your
site uses Events.

### Merge tags

Tags in curly brackets are swapped for each reader's own details when the email is sent. **Insert field
value…** in a Text block and on the **Plain text** tab adds them, and you can type them in a heading, a
button's link or the subject.

| Tag | Becomes |
| --- | --- |
| **First name** `{first_name}` | The reader's first name. |
| **Last name** `{last_name}` | Their last name. |
| **Full name** `{name}` | First and last name together. |
| **Email address** `{email}` | Their email address. |
| **Site name** `{site_name}` | Your site's name. |
| **Unsubscribe link** `{unsubscribe_url}` | The address of their unsubscribe page. |
| **Email preferences link** `{preferences_url}` | The address of their page for choosing lists. |
| Each subscriber field | That field's value, such as `{town}`, when an admin has set up fields under **Settings**, **Mailing Lists**. |
| **Week of (the Monday)** `{week_of}` | Weekly digests only: the Monday of the issue's week, such as "October 12, 2026". |

Not everyone gave their name. To say something else when a detail is empty, add it after a bar:
`{first_name|there}` reads "Hi Sam," for Sam and "Hi there," for someone without a first name. This works
for the name, email and subscriber field tags.

### The footer

Every email ends with a footer added when it is sent, under your design, which you can't remove: "You're
receiving this because you signed up for email from" your site, your organisation's name and postal
address, and **Unsubscribe** and **Email preferences** links for that reader. You don't need to write an
unsubscribe line yourself. The footer doesn't show on the canvas, but it does on the **Preview** tab.

### The Preview tab

**Preview** shows the email exactly as it will be sent to **A sample subscriber**, Sam Sample
(sam@example.com): the subject, the email with its footer at **Desktop** or **Phone** width, and its plain
text on the right. Subscriber fields show their name in square brackets, such as "[Town]". Entries and
Events blocks show what they would list now.

### Email templates

**Templates** in the email builder saves a design to reuse, as for forms (see
[Email templates](/editors/forms/#email-templates)). For mailing emails, **Default for** offers **New
campaigns** and **New weekly digests**: new ones then start from that template.

### Having Claude write it

1. Click **Compose** at the top of the campaign.
2. Under **What is the email about?**, say what to write, for example "The October newsletter: the fall
   festival is on the 18th at Riverside Park, we're looking for volunteers (sign up at /volunteer/). Then
   our latest news and upcoming events."
3. Click **Write**. It says **Writing… this takes up to a minute.**

Claude writes the campaign's name, subject, preview text and email: a heading, a few short sections of
text, each with a button if it needs one, and, when you ask for them, an Entries block of your latest
posts and an Events block of upcoming events. The email keeps its colours and font. It replaces the
email's blocks, but a plain text of your own stays as it is. Claude doesn't write the unsubscribe line or
postal address: the footer has them.

When it's done, the campaign says **Written by Compose: check the email, then Save.** Open the email with
**Edit the email**, check it, change anything you like, then click **Save**. Nothing is saved until you
do. If Claude left something out, a note under **Email** says why, for example a button with no address
to go to. **Cancel** closes the box without writing anything.

You can also start a new campaign this way: **Compose** in the top bar, then **Campaign**. See
[Writing with Claude](/editors/writing-with-claude/#forms-emails-templates-and-patterns). Compose needs
Claude to be connected (see [Connections](/admins/connections/)).

### Sending a test

Always send yourself a test before a campaign goes out.

1. In the **Send a test** box, the test goes to you. To send it to others too, type up to 5 more
   addresses in **Also to (up to 5 addresses)**, separated by commas.
2. Click **Send test**. Unsaved changes are saved first.
3. It says **Test sent to you** (and the addresses given).

A test is the email as it would go now, with "[Test]" at the start of its subject. It isn't counted in the
campaign's numbers, and its links aren't tracked. If you are on the lists, your own details fill in the
tags; otherwise your name from your account does.

If the test can't be sent, the message says why, for example that the postal address is missing.

### Copying and deleting

At the bottom of a campaign, **Duplicate** makes a copy named "(copy)" as a new draft, with the same
email, lists and settings, and opens it. This is the easiest way to start this month's newsletter from last
month's. **Delete** removes a draft (it asks first).

### Sending is for admins

Editors write and test campaigns. An admin sends or schedules them: the campaign shows **An admin
schedules and sends it.** where the admin's **Send** box would be. Once a campaign is scheduled or sending,
only admins can change it; editors can still open it and **See the email**. See
[Sending a campaign](/admins/mailing-lists/#sending-a-campaign) in the Admin guide.

## After a campaign is sent: its numbers

Once a campaign has gone out, its page shows **Numbers**. While it is sending, the page refreshes itself
every 15 seconds.

| Number | What it means |
| --- | --- |
| **Sent** | How many emails went out. Underneath: how many are still to go, or how many people unsubscribed before their turn came. |
| **Delivered** | How many reached the reader's mail server, as a share of those sent. |
| **Clicked** | The share of delivered emails whose reader followed a link, with how many people and how many of them **confirmed** (see below). |
| **Opened** | The share of delivered emails that were opened. Marked **Indicative: mail apps open some for people**. |
| **Bounced** | Emails that couldn't be delivered, as a share of those sent. |
| **Spam complaints** | Readers who marked it as spam. |
| **Unsubscribed** | Readers who unsubscribed from this email. |
| **Machine clicks** | Emails whose links a mail scanner followed. |

### People's clicks and machines' clicks

Many workplaces and email services check every link in an email before the reader sees it. Their
scanners "click" each link, which would make a campaign look far more popular than it is. So the site
tells clicks apart:

- **Machine**: a mail scanner. For example, it followed a hidden link no person can see, clicked several
  links within seconds, clicked straight after the email arrived, or came from a known scanner.
- **Likely a person**: a click with none of those signs.
- **Person (confirmed)**: someone who went on to use the page on your site after clicking. Only links to
  your own site can be confirmed.

**Clicked** counts people and likely people, never machines. Opens leave out mail scanners and privacy
features (such as Apple's, which opens every email in advance), but they still aren't exact: that is why
they are marked as indicative. Clicks are the better measure of who read the email.

### Each link

Under **Links**, each link in the email is listed with how many **People** followed it and how many of
them were **Confirmed**. Tick **Show machine clicks** to add the scanners' clicks, and how often the hidden
link was followed.

### Who it went to

Under **Recipients**, everyone the campaign went to is listed with how their email went: **Delivery**
(**Delivered**, **Bounced**, **Marked as spam**, **Not sent (unsubscribed first)**, **Waiting** or **Sent**),
when they **Opened** it and when they **Clicked** (or **Confirmed**). The buttons above narrow the list:
**Everyone**, **Delivered**, **Opened**, **Clicked**, **Bounced**, **Marked as spam**, **Unsubscribed** and
**Not sent**. Click an address to open that person's page.

Admins also have **Compare with Mailgun's totals**, which shows Mailgun's own counts for the campaign.

## The weekly digest

A weekly digest is an email made on its own every week: what was published on your site since the last
issue went out, and the events coming up. Each week's issue becomes a campaign of its own, listed under
the digest and on the **Campaigns** tab.

### Making a digest

1. On the **Weekly digests** tab, click **New digest**. It opens, named "Weekly digest".
2. Fill in its settings and design its email with **Edit the email**.
3. Click **Save**.

A new digest is off. It starts with the subject "{site_name}: the week of {week_of}" and an email with a
heading, a greeting, an Entries block "New this week" set to list only what's new and, on sites with
events, an Events block "Coming up".

### Its settings

| Setting | What it does |
| --- | --- |
| **Name** | For you; each issue is named after it, such as "Weekly digest: week of October 12, 2026". |
| **Subject** | The subject line. **{week_of}** is the Monday of the issue's week. |
| **Goes out on** and **At** | The weekday and time, in the site's time zone. |
| **From name**, **Replies go to** | As for a campaign. |
| **Email** | **Edit the email** opens the email builder. |
| **To the lists**, **Segment**, **Members** | Who it goes to, as for a campaign. |
| **Each issue** | **Waits for an admin's approval**, or **Goes out on its own**. |
| **Hours it waits (made at its time, sent this much later if approved)** | With approval: how long an issue waits for an admin (1 to 168 hours). |
| **Skip a week with fewer than** ... **entries and events** | Ticked, a week with less than that to show sends nothing. |
| **Track links**, **Add UTM parameters to links to this site** | As for a campaign. |

In the digest's email, an Entries block with **In a digest: only those new since the last issue** ticked
lists what was published since the last issue went out (or, before the first, in the last 7 days).
Events blocks list what's coming up. Both are filled in when each issue is made.

### Trying it out

**Send me this week's issue** sends you this week's issue as it would be now, as a test. Unsaved changes
are saved first (while you may still change the digest).

### What editors can change

Editors make digests and change them while they are **Off**. Only an admin turns a digest on (the editor
sees **An admin turns it on.**). Once it is on, the digest says **This digest is on: only admins change
it.**: editors can see its settings and use **Send me this week's issue**, but can't change anything or
open its email.

Under **Issues**, each week's issue is listed with its status and how many people it went to. Click one
to open it as a campaign, with its numbers once it has gone out.

## Segments

A segment picks some of the people on a campaign's lists: those tagged "farm", those in one town, those
who signed up in the last month, those who haven't opened anything lately. Choose it under **Segment** on a
campaign or digest, and only the people on its lists who match get the email.

The **Segments** tab lists each segment, **Who** it picks in words, and how many people it **Matches
now**.

### Making a segment

1. On the **Segments** tab, click **New segment**.
2. Give it a **Name** and, if you like, a **Description (for you)**.
3. Beside **People who match**, choose **all of these** (every rule must match) or **any of these** (one is
   enough).
4. Click **Add a rule** and set it up (below). Add as many as you need, up to 20. **Remove** takes one
   away.
5. Click **Save**.

Each rule has a kind and, beside it, a choice that turns it round, such as **is tagged** or **isn't
tagged**:

| Rule | Picks people who | Turned round |
| --- | --- | --- |
| **On a list** | **is on** any of the lists ticked. | **isn't on** |
| **Tagged** | **is tagged** with any of the tags typed (separated by commas). | **isn't tagged** |
| **A field** | **has** a subscriber field **equal to** a value, **containing** it, or just **filled in**. Type the field's name; the site suggests the fields in use. Capital letters don't matter. | **doesn't have** |
| **A member** | **is a member** (active), of the levels ticked (none ticked: any level). Only on sites with members. | **isn't a member** |
| **Signed up** | **signed up in the last** so many days. | **signed up more than** so many days ago |
| **Opened an email** | **opened an email in the last** so many days. | **hasn't opened an email in the last** |
| **Clicked a link** | **clicked a link in the last** so many days. | **hasn't clicked a link in the last** |
| **Signed up from** | **signed up from** a page, form or import: the words typed appear in how they signed up, such as the address of the page with the sign-up form (`/newsletter/`) or the note an admin gave an import. | **didn't sign up from** |

Opens and clicks count people, not mail scanners. Tags and fields are set on each contact by an admin,
from an import's columns, or by a sign-up form.

### Who matches now

The box on the right, **Who matches now**, counts the people who match as you change the rules, and lists
the first 100. It counts subscribed people on any list: a campaign narrows it to its own lists.

Under the rules, **Used by** lists the campaigns and digests that use the segment. **Changes apply to what
hasn't gone out yet.**

### What you can't change

- While a campaign that is scheduled, waiting for approval, sending or paused, or a digest that is on, uses
  a segment, only admins can change its rules (you can still change its name and description). This stops
  an email an admin approved from going to more people than they agreed to.
- **Delete segment** works only for a segment no campaign or digest uses, sent campaigns included. Choose
  another segment on those first.

## Subscribers and lists

Editors can read who is on the lists, but only admins change them.

The **Subscribers** tab lists everyone, newest first, 100 to a page, with their **Status**, **Tags** and how
and when they **Agreed**. Search names and email addresses, or narrow the list by status, list and tag,
then click **Filter**. Clicking a tag shows everyone with it.

| Status | What it means |
| --- | --- |
| **Waiting for confirmation** | Signed up, but hasn't clicked the link in the confirmation email yet. Nothing is sent to them. |
| **Subscribed** | Gets the emails for the lists they're on. |
| **Unsubscribed** | Asked to stop. Nothing is sent to them. |
| **Bounced** | Their address doesn't work. Nothing more is sent. |
| **Marked as spam** | They marked an email as spam. Nothing more is ever sent. |

Click an address to open that person's page: their name, fields, lists (with since when), tags and notes;
their **Consent** (how and when they agreed, the wording they agreed to, and when they confirmed); **Sent
to them**, each campaign with its delivery, when they opened it and when they clicked; and **Clicks**, each
click with the link and its verdict (**Person (confirmed)**, **Likely a person** or **Machine**, with the
reasons).

The **Lists** tab shows the lists, each with **View** its number of **subscribers**. Public lists are the
ones sign-up forms offer; the others are for people an admin adds.

## Sign-up forms on your pages

Three blocks in the page editor's **Mailing Lists** group put mailing lists on your site (see also
[Every block](/editors/page-editor/#mailing-lists)). They are offered only while mailing lists are on.

### The Subscribe block

A sign-up form for one or more lists. Its settings:

- **Lists offered (none ticked: every public list)**: only public lists can be offered.
- **Heading**, **Text** and **Button** (the button says "Subscribe" unless you change it).
- **Consent wording**: the line under the form saying what people agree to. Empty, it uses the wording
  set under **Settings**, **Mailing Lists** ("I agree to receive email from us. I can unsubscribe at any
  time." unless an admin changed it). It is kept with each sign-up.
- **Tag sign-ups with (comma separated)**: tags for everyone who signs up here (up to five), so you can
  pick them out with a segment later.
- **Ask for first and last name**: adds **First name** and **Last name** boxes, both optional.
- **Also ask (optional for visitors)**: tick any of the site's subscriber fields to ask for them too.
- **Form style**: the form's colours and shapes, as for the Form block (see
  [Form style](/editors/page-editor/#form-style)).
- **Layout**: **Stacked**, or **In a row** (the fields and button side by side).

With more than one list offered, visitors tick the ones they want under "What would you like to
receive?" (the first is ticked). With one, there is nothing to tick.

### The Newsletter signup block

A compact sign-up for one list, for a coloured band or the footer: a heading, a line of text, then an
email box and a button in a row. Its settings: **List** (empty: the first public list), **Heading** and
**Text** (clear them to leave them out), **Button** ("Sign up"), **Inside the email field** (the faint text
in the empty box), **Consent wording**, **Tag sign-ups with (comma separated)**, **Align** (**Centred** or
**Left**) and **Form style**.

### The Email preferences block

Where people who followed a link from one of the site's emails confirm their sign-up, choose their lists
or unsubscribe. **Shows first**: **Email preferences** or **Unsubscribe**. You only need it if you make
your own page at one of the addresses below.

### The site's own pages

While mailing lists are on, the site has three pages ready made, hidden from search engines:

| Address | What it shows |
| --- | --- |
| `/subscribe/` | A sign-up form for every public list, with a heading "Get our email" and name boxes. |
| `/unsubscribe/` | Unsubscribing, for the person whose link was followed. |
| `/email-preferences/` | Choosing lists, for the person whose link was followed. |

To change one, make a page with that address: yours shows instead. Put a Subscribe block on your
`/subscribe/` page, and an Email preferences block on the other two.

## What visitors go through

1. **Signing up.** A visitor fills in the form and clicks the button. The form says "Thanks! Check your
   email: we've sent a link to confirm your subscription."
2. **Confirming.** They get an email "Confirm your subscription to" your site, naming the lists, with a
   **Confirm my subscription** button. It opens a page asking them to confirm, with a second **Confirm my
   subscription** button. (The second click is there because mail scanners open links on their own: only a
   person pressing the button confirms.) The page then says "Thanks! Your subscription is confirmed." Until
   they confirm, nothing is sent to them, and someone who never confirms is removed after 30 days.
3. **Receiving emails.** Each email ends with the footer and its two links.
4. **Choosing lists.** **Email preferences** in the footer opens a page listing the public lists under
   "Email you receive", ticked where they are subscribed. They change the ticks and click **Save**, or click
   **Unsubscribe from all**.
5. **Unsubscribing.** **Unsubscribe** in the footer opens a page asking "Stop sending email to" their
   address, with **Unsubscribe from all**, and a link to **Choose which emails you get instead**. Many mail
   apps also show an unsubscribe button of their own beside the sender's name: it unsubscribes them from
   everything at once, with no page to visit. Either way it takes effect straight away.

The form gives the same answer whether or not the address was already on file, so nobody can find out who
is subscribed by trying addresses. A sign-up for an address already on file changes nothing about that
person until the link is confirmed. One address gets at most three confirmation emails a day.

On sites with members, members also choose their lists on their account page, under **Email**.

## Common questions

### Why can't I send my campaign?

Sending is for admins. Write it, send yourself a test, then ask an admin to send or schedule it.

### Why can't I change a campaign any more?

Once a campaign is scheduled, waiting for approval or sending, only admins can change it. You can still
open it and look at the email with **See the email**. To reuse it, click **Duplicate**.

### Why does the test show "there" instead of my name?

The test fills the tags in with your details. If the email says `{first_name|there}` and the site has no
first name for you, it shows the fallback, as it will for readers without a name.

### Why is the open rate so different from the click rate?

Opens are only indicative: some mail apps open emails for people, and others block the signal that an
email was opened. Clicks by people are the better measure.

### Someone says they didn't get the confirmation email.

Ask them to check their spam folder. An admin can send it again with **Resend confirmation** (see
[Mailing lists](/admins/mailing-lists/#resending-a-confirmation) in the Admin guide).

### Someone wants to be taken off the list.

They can click **Unsubscribe** at the bottom of any email. Otherwise an admin can unsubscribe them, or
erase them completely.

### Why can't I delete a segment?

A campaign or digest uses it, even one that was sent long ago. The message names them.

## What needs an admin

- Turning mailing lists on, the sender, the postal address and the consent wording: **Settings**,
  **Mailing Lists**; connecting Mailgun: **Settings**, **Connections**.
- Sending, scheduling, pausing, cancelling and approving campaigns.
- Turning a weekly digest on, and changing one that is on.
- Making and changing lists, and adding, importing, unsubscribing, erasing and exporting subscribers.

See [Mailing lists](/admins/mailing-lists/) in the Admin guide.
