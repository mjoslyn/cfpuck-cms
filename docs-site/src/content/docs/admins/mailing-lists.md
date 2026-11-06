---
title: Mailing lists
description: "Setting up mailing lists and Mailgun, looking after subscribers, sending and scheduling campaigns, the weekly digest, and what to do when sending stops."
sidebar:
  order: 3
---

Mailing lists let the site send news by email to people who signed up for it. Editors write and test
campaigns and weekly digests (see [Mailing lists](/editors/mailing-lists/) in the Editor guide). Admins
also:

- set the feature up under **Settings**, **Mailing Lists**, and connect Mailgun;
- make the lists;
- add, import, unsubscribe, erase and export subscribers;
- send, schedule, pause, cancel and approve campaigns;
- turn weekly digests on;
- resume sending when it has been paused for the whole site.

Everything except the settings is on the **Mailing Lists** screen: **People** in the top bar, then
**Mailing Lists**.

## Setting it up

1. Click the gear ⚙ for **Settings**, then **Mailing Lists** (under **Features**).
2. Tick **Mailing on**. The rest of the settings appear.
3. Fill in the sender and the postal address (below), and anything else you need.
4. Click **Save settings**. **Mailing Lists** then appears under **People** in the top bar.
5. Connect Mailgun (see [Connecting Mailgun](#connecting-mailgun)).
6. On the **Mailing Lists** screen, make at least one list (see [Lists](#lists)).

Turning mailing lists off hides the screen, its blocks and its pages, but deletes nothing.

### Every setting

At the top, the section says whether Mailgun is set up: **Sending through Mailgun from** your sending
domain, or that **Mailgun isn't set up, so nothing goes out**, with a link to **Settings > Connections**. It
also shows the site's Mailgun webhook address, which the connection sets up for you.

**Sender**

| Setting | What it does |
| --- | --- |
| **From name (empty: the site's name)** | The name emails come from. Each campaign or digest can use its own. |
| **From address, before the @** | The first part of the sender's address; the rest is your Mailgun sending domain. Empty, it is "news". |
| **Replies go to (optional)** | Where replies to campaigns go, such as your office address. Each campaign or digest can use its own. |
| **Postal address (required: every email shows it)** | Your organisation's postal address, shown in every email's footer. The law in many countries requires it, and nothing can be sent until it is filled in. |

**Signing up**

| Setting | What it does |
| --- | --- |
| **Consent wording under sign-up forms** | What people agree to when they sign up. Empty, it is "I agree to receive email from us. I can unsubscribe at any time." Each Subscribe block can have its own. The wording each person agreed to is kept with their record. |
| **Lists offered to members** | Only on sites with members. Lists offered (unticked) when someone creates a member account, and on a member's account page, where they choose their lists. |

The section also links to the site's ready-made pages, `/subscribe/`, `/unsubscribe/` and
`/email-preferences/`.

**Subscriber fields**

Fields every subscriber can have besides first and last name, such as "Town" or "Business type". They are
set on each subscriber, filled in from an import's columns of the same name, asked for by Subscribe
blocks, used in segments, and put in emails as merge tags.

1. Click **Add a field**.
2. Type its name, such as "Town", and choose its type: **Text**, **Number**, **Date** or **Choice**. For a
   choice, type the options separated by commas.
3. Under it, the field's merge tag shows, such as `{town}`. The tag is made from the name and doesn't
   change once saved, so emails using it keep working if you rename the field.
4. Click **Save settings**.

A name must start with a letter, can't repeat another field's, and can't be one of the built-in tags
(such as `email` or `first_name`): the field says so. **Remove** takes a field away; subscribers keep their
values, which then show as other fields on each subscriber's page. A site can have up to 30 fields.

**New campaigns**

- **Track links (each link goes through the site, which tells people's clicks from mail scanners')**:
  ticked on new campaigns and digests unless you untick it here.
- **Add UTM parameters to links to this site**: ticked on new campaigns when this is ticked. (New digests
  start with it ticked.)

Each campaign can change both.

**Pause sending when**

- **Spam complaints pass (% of delivered; default 0.1)**
- **Bounces pass (% of sent; default 2)**

These are checked once a campaign has 500 deliveries (and at least 2 complaints or 10 bounces). Past
either, everything stops, digests included, and the site's admin address is emailed, until an admin
resumes sending (see [When sending is paused](#when-sending-is-paused)). Mail services judge senders by
these numbers, so a campaign that annoys people can harm every later one.

## Connecting Mailgun

Campaigns and digests go out through Mailgun, an email sending service, from a sending domain of your own
(often a subdomain, such as `news.example.org`). The site's other emails (form notifications, tickets,
password links, sign-up confirmations) don't use Mailgun.

Connect it under **Settings**, **Connections**: paste the Mailgun key, type your password and click
**Connect** (see [Connections](/admins/connections/)). The site finds the region, asks which sending domain
to use if you have several, and sets up Mailgun's webhooks, which tell the site about deliveries, opens,
bounces, spam complaints and unsubscribes.

Until Mailgun is connected, nothing is sent, and the Mailing Lists screen, its settings and each campaign
say so.

## Lists

The **Lists** tab shows each list with **View** its number of **subscribers**. Anyone can be on a list,
members or not, and on several lists.

To make a list:

1. Type its **Name**, such as "Newsletter", and a **Description** if you like, such as "News and events,
   once a month". Visitors see both when choosing lists.
2. Leave **Public** ticked for a list people can sign up to themselves, or untick it (see below).
3. Click **Add list**.

To change a list, edit its name, description, order or **Public** in its row and click **Save** in that
row. The number box is its order: lists are shown with the lowest number first, in sign-up forms, on the
preferences page and everywhere else. A new list goes last.

**Public or not**:

- **Public** lists are offered by Subscribe and Newsletter signup blocks, and on the email preferences
  page, where people choose their lists.
- Other lists are only for people you add or import (and, on sites with members, members when the list is
  offered to them). They don't show on the preferences page; **Unsubscribe from all** still takes people
  off them.

**Remove** deletes a list (it asks first): its subscribers leave it, and their other lists stay.

## Subscribers

The **Subscribers** tab lists everyone, newest first, 100 to a page. Search names and email addresses, or
choose a status, list or tag and click **Filter**. The boxes at the top add people.

:::caution
Add only people who agreed to get these emails. Each way of adding people asks how they agreed, and
keeps your answer as their consent.
:::

### Adding someone

1. Open **Add a contact**.
2. Fill in **Email**, and **First name** and **Last name** if you have them.
3. Choose the **List**.
4. Add **Tags (optional, comma separated)**.
5. Under **How they agreed (kept as their consent)**, say how, for example "Asked at the front desk, 12 Oct".
6. Click **Add**.

They are subscribed at once, without a confirmation email, because you vouch for their consent. Someone
already on file is put on the list and gets the tags. Someone who unsubscribed (from everything or from
that list), bounced, marked an email as spam or was erased is not added: the message says they need to sign
up themselves.

### Importing a CSV file

A CSV file is a spreadsheet saved as plain text; any spreadsheet program can save one.

1. Open **Import a CSV**.
2. Choose the **File** (up to 5 MB).
3. Choose **Onto the list**.
4. Under **How these people agreed**, say how, for example "Signed up on the old site's newsletter form".
5. If you like, fill in **Tag everyone imported (optional)**.
6. Click **Import**.

The message says how many were **added**, how many were **already known**, how many were **skipped** and
how many were **not email addresses**.

The file needs a first row naming its columns. The site reads:

| Column | What it does |
| --- | --- |
| `email` (or `e-mail`, `email address`) | The address. Required. |
| `first name` and `last name` (or `first_name`, `firstname`, `last_name`, `lastname`, `surname`) | The name. |
| `name` (or `full name`) | A whole name, split at the first space, when there are no first and last name columns. |
| `tags` (or `tag`) | Tags for that person, separated by `;` or `\|`. |
| A subscriber field's name or tag, such as `Town` or `town` | Fills that field. A value that doesn't fit the field (not a number, not a date, not one of a choice's options) is left out. |
| Any other column | Becomes a field of its own on each person, to use in segments. |

A file without an `email` column is read as addresses in the first column and names in the second. Commas,
semicolons and tabs between columns all work. Columns from the site's own export (`status`, `lists`,
`consent_source` and the dates) are ignored, so an exported file imports back.

Everyone imported is subscribed at once, without a confirmation email. People already on file are put on
the list, gain the file's tags and fields, and get a name if they had none. Anyone who unsubscribed (from
everything or from that list), bounced, marked an email as spam or was erased is skipped: only they can
sign up again.

### Adding members to a list

Only on sites with members. **Add members to a list** puts active members on a list:

1. Tick the levels under **Active members of (none ticked: any level)**.
2. Choose **Onto the list**.
3. Under **How they agreed**, say how, for example "Membership terms include member news".
4. Click **Add members**.

As with an import, members who unsubscribed, bounced or were erased are skipped. Members can also choose
their lists on their account page.

### A subscriber's page

Click an address on the **Subscribers** tab. You can change:

- **First name**.
- **Last name**.
- The subscriber fields.
- **Lists**.
- **Tags (comma separated)**.
- **Other fields**.
- **Notes**.

Then click **Save**.

- Ticking a list adds them to it, but only while they are **Subscribed**: someone waiting for confirmation
  or unsubscribed has to sign up (or confirm) themselves. Unticking a list takes them off it.
- Under **Other fields**, fill in the empty row (a field and a value) to add a field; clear a value to
  remove one.

The **Consent** box shows how they agreed: the **Source**, when they **Agreed**, when they **Confirmed**,
the **Wording** they agreed to, the **From address** (the internet address they signed up from), and when
they were **Added**.
Under it are the actions below. Further down, **Sent to them** and **Clicks** show each campaign and click
(see [the Editor guide](/editors/mailing-lists/#subscribers-and-lists)).

### Resending a confirmation

Someone **Waiting for confirmation** may not have received the email, or lost it. Click **Resend
confirmation** beside their status on the **Subscribers** tab, or in the **Consent** box on their page. It
says **Confirmation email sent again.**

One address gets at most three confirmation emails a day (only one if it was erased before), counting the
ones their own sign-ups sent. Nothing is sent to an address that bounced or marked an email as spam, and the
message says why.

### Unsubscribing someone

On their page, click **Unsubscribe** and confirm. They are taken off every list at once and get no more
email. They can come back by signing up again or through the preferences link in an email they already
have.

### Erasing someone

When someone asks for their details to be deleted, click **Erase** on their page and confirm. Their record,
what was sent to them and their clicks are deleted, and Mailgun's records of their address too. Only a
one-way scrambled copy of the address (a hash) is kept, which can't be turned back into the address, so the
site knows never to email it again unless they sign up themselves. Imports and **Add a contact** skip an
erased address. Their address is also added to Mailgun's unsubscribe list.

### Exporting

**Export all as CSV** downloads every subscriber: their address, name, status, lists, tags, fields, and
their consent and dates. It imports back as it is.

## Sending a campaign

Editors write campaigns and send tests; sending is yours. Before you send:

- Open the campaign and check its **Subject**, **To the lists**, **Segment** and, on sites with members,
  **Members**.
- Use **Send a test** to send it to yourself (and up to 5 others), and read it in your inbox.

In the **Send** box of the campaign:

- **Send now** sends it straight away.
- Or pick a date and time beside **or at** and click **Schedule**. Times are in the site's time zone, shown
  under the box.

Either way a box asks **Send this campaign now?** (or **Schedule this campaign?**), saying who it goes to
and counting how many people that is now. Tick **I've sent a test and checked it. This can't be called back
once it goes.** and click **Send** (or **Schedule**). **Not yet** goes back. Unsaved changes are saved
first.

The count is who would get it at this moment. Whoever is still subscribed when it actually goes out is who
gets it, so people who unsubscribe meanwhile are left out.

It won't send, and says why, when:

- it has no subject (**Give it a subject.**);
- no list is ticked (**Choose at least one list.**);
- the postal address is missing under **Settings**, **Mailing Lists**;
- nobody matches (the **Send** button stays greyed out with 0 people);
- the site's address isn't set on the server: the message asks for `SITE_URL`, which whoever runs the site
  sets, because the links in every email are made from it.

### A scheduled campaign

A **Scheduled** campaign shows the time it goes out. Admins can still change it and **Save**. In the
**Send** box:

- **Back to draft** stops it going out and makes it a draft again (for a weekly digest's issue that no admin
  approved, the button is **Unschedule**, which puts it back to waiting for approval).
- **Send now instead** sends it straight away.
- **Cancel the campaign** stops it for good (it asks first).

### While it sends

When a campaign starts, the site fixes its email and its list of recipients, then sends to them in batches
of up to 1,000. Each batch first leaves out anyone who unsubscribed in the meantime. A large campaign takes
several minutes. Its page refreshes every 15 seconds, and **Sent** shows how many are still to go.

**Pause** stops it before the next batch. Emails already sent stay sent.

### Paused, failed and cancelled

| Status | What to do |
| --- | --- |
| **Paused** | The reason shows beside the status. **Resume now** carries on with the people not sent to yet (a box, **Resume this campaign now?**, asks again with the count); you can also pick a time and **Schedule** it. **Cancel the campaign** stops it for good. |
| **Failed** | The reason shows beside the status, such as Mailgun refusing the email or nobody on the lists being subscribed. Fix what it names, then click **Resume now**: the batches that failed are sent again, to those still subscribed then. |
| **Cancelled** | Nothing more goes. A cancelled campaign that sent nothing can be deleted. |

Sometimes the site can't tell whether Mailgun accepted a batch, for example when the connection dropped
mid-way. It checks with Mailgun before sending that batch again, so nobody gets the email twice. If it
still can't tell, it pauses the campaign with a message such as "Batch 3: whether Mailgun took it is
unclear, so it wasn't sent again. Check Mailgun's logs before resuming." Look in Mailgun's logs for the
emails before you click **Resume now**.

### After it is sent

The campaign shows its numbers, each link's clicks and every recipient (see
[After a campaign is sent](/editors/mailing-lists/#after-a-campaign-is-sent-its-numbers) in the Editor
guide). Admins also have **Compare with Mailgun's totals**, which shows Mailgun's own counts for the
campaign beside the site's.

**Delete** removes drafts, and campaigns that were cancelled, skipped or failed before they started
sending. A campaign that started sending stays, with its numbers.

## The weekly digest

Editors make and design digests while they are off; admins turn them on. Open the digest from the **Weekly
digests** tab.

1. Check its **Subject**, **Goes out on** and **At** (the weekday and time, in the site's time zone; a new
   digest says Thursday at 09:00), its lists, **Segment** and **Members**.
2. Under **Each issue**, choose:
   - **Waits for an admin's approval**: each week's issue is made at its time and waits. Set **Hours it
     waits (made at its time, sent this much later if approved)** (24 to start with, 1 to 168).
   - **Goes out on its own**: each issue is sent as soon as it is made.
3. **Skip a week with fewer than** ... **entries and events**: leave it ticked so a quiet week sends
   nothing. With 1, only a week with nothing at all is skipped.
4. Tick **On: make an issue every week**.
5. Click **Save**.

It won't turn on without at least one list ("Choose at least one list before turning it on.") or the postal
address.

### Each week

Within a few minutes of its time, the site makes that week's issue as a campaign named after the digest
and the week, such as "Weekly digest: week of October 12, 2026", and lists it under **Issues** and on the
**Campaigns** tab. Its Entries blocks that list only new entries show what was published since the last
issue went out.

- **Goes out on its own**: it is sent at once.
- **Waits for an admin's approval**: it shows **Waiting for approval**, and the site's admin address gets
  an email "... is ready for review" with a **Review it** link. Open it, check the email (you can change it
  and **Save**), then click **Approve** and confirm: it goes out at the time shown, its time plus the hours
  it waits. You can also **Send now** instead. If nobody approves it in time, it is cancelled ("Not approved
  before its time.") and the admin address is told it wasn't sent.
- A week with too little in it is **Skipped (nothing new)**, with how many items it had and how many it
  needed. A week when nobody on its lists is subscribed is skipped too.

An issue is made once a week. If you turn a digest on more than a day after this week's time, the first
issue comes next week.

### Its buttons

- **Send me this week's issue**: this week's issue as it would be now, to you, as a test.
- **Make an issue now**: makes an issue straight away, outside the schedule (save first). With approval,
  it waits like any other; otherwise it is sent at once. It asks first.
- **Delete digest**: deletes the digest. Its issues stay as campaigns.

While a digest is on, only admins can change it.

## When sending is paused

If a campaign passes the spam complaint or bounce rate set under **Settings**, **Mailing Lists**, the site
pauses all sending: campaigns that were sending stop with **Paused**, scheduled ones and digests wait, and
the site's admin address gets an email "Mailing paused". The Mailing Lists screen says **Sending is paused:**
with the campaign and the rate.

1. Find out why. Open the campaign named: was it sent to people who hadn't agreed, such as an old
   imported list? Look at its bounces and complaints under **Recipients**.
2. Fix the cause, for example by unsubscribing or erasing the people who shouldn't be on the list.
3. On the Mailing Lists screen, click **Resume sending** and confirm.

Campaigns that were paused stay paused until you open each one and click **Resume now**.

Each night the site also checks Mailgun's own lists of bounced addresses, spam complaints and
unsubscribes, and stops sending to anyone on them. Someone who bounced or marked an email as spam is never
emailed again unless they sign up and confirm themselves.

## Segments

Editors and admins make segments (see [Segments](/editors/mailing-lists/#segments) in the Editor guide).
While a campaign that is scheduled, waiting for approval, sending or paused, or a digest that is on, uses a
segment, only admins can change its rules, so an approved email never goes to more people than intended.
Check **Who matches now** before you change the rules of a segment in use.

## What isn't synced or backed up

Subscribers, lists, segments, campaigns with their numbers, digests and email templates stay on the copy
of the site where they were made: **Settings > Sync** doesn't copy them, and
[backups](/admins/email-log-and-backups/#backups) don't hold them, so restoring a backup never subscribes
anyone again. Settings > Mailing Lists is synced
and backed up with the other settings. Whether sending is paused belongs to each copy.

Mailing list emails aren't kept in the [email log](/admins/email-log-and-backups/#email-log) either:
each campaign's page shows who it went to.
