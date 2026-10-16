---
title: Mailing
description: Mailing lists, campaigns and a weekly digest through Mailgun, with confirmed sign-ups, one-click unsubscribe, and clicks told apart into people's and mail scanners'.
sidebar:
  order: 8
---

Mailing is optional: turn it on under **Settings > Mailing**. People sign up to your mailing lists (and
confirm by email), and you send them campaigns and a weekly digest through Mailgun from a marketing
subdomain. Each email's deliveries, opens and clicks are recorded. The site's other email (form
notifications, tickets) goes out over SMTP as before. Mailgun's setup is under
[Hosting](../../start/hosting/#mailing).

## Settings

Under **Settings > Mailing** (admins):

- **Sender**: the name and the address before `@` your Mailgun domain (default `news`), and where
  replies go.
- **Postal address**: every email shows it, as the law requires. Nothing is sent until it's there.
- **Consent wording** under sign-up forms, kept with each sign-up.
- **Lists offered to members** (with [Members](../members/) on).
- **Track links** and **UTM parameters** for new campaigns.
- **Pause sending when** spam complaints or bounces pass a rate (default 0.1% and 2%), checked once a
  campaign has 500 deliveries. Everything stops, digests included, and the admins are emailed, until an
  admin resumes sending on the Mailing screen.

## Lists and signing up

Add lists on the Mailing screen's **Lists** tab. **Public** lists are offered by sign-up forms and on
the email preferences page; the others are for people you add yourself.

Put the **Subscribe** block (Mailing group in the block list) anywhere: email, an optional name, the
public lists to choose from when there are several, the consent wording and a button. The site also has
a page at **/subscribe/**. Every sign-up gets an email with a link to confirm, and nothing is sent until
they do (a sign-up never confirmed is deleted after 30 days).

People manage their subscription from the links at the bottom of every email: **/email-preferences/**
(which lists) and **/unsubscribe/**. Mail apps' own one-click unsubscribe (Gmail, Yahoo, Apple Mail)
works too, at once. A page with one of these addresses takes its place: put the **Email preferences**
block on it.

On the **Contacts** tab admins search and filter contacts, see each one's consent (where, when, the
wording, confirmed when), lists, emails and clicks, and can **Add a contact**, **Import a CSV** (email
and name columns), **Add members to a list**, **Unsubscribe**, **Erase** and **Export as CSV**. Adding
or importing asks how those people agreed to get your email. Anyone who unsubscribed, bounced, marked
an email as spam or was erased is skipped: they have to sign up themselves. Erasing deletes a contact
and keeps only a one-way hash of the address, so they're never mailed again unless they sign up.

## Campaigns

**New campaign** on the Campaigns tab opens its editor:

- name, subject, sender and reply-to (empty: the settings'), the lists, and with Members on, everyone,
  only members (of some levels) or only non-members;
- the email, designed in the email builder: text, images, buttons, sections and columns, the
  **Entries** block (the site's latest posts or other entries, of some categories or tags) and, with
  Events on, the **Events** block. Merge tags: `{first_name}`, `{name}`, `{email}`, `{site_name}`,
  `{unsubscribe_url}`, `{preferences_url}`; a fallback for an empty value after a bar,
  `{first_name|there}`. Every email ends with a footer you can't remove: why they get it, your name and
  postal address, and unsubscribe and preferences links;
- **Send a test**, to you and up to 5 more addresses, marked [Test].

Editors write and test campaigns; admins **Send now** or **Schedule** (in the site's time zone), after a
confirmation that shows how many people it goes to, and can **Pause**, **Resume** and **Cancel**. Whoever
is still subscribed when each batch goes out gets it.

Once it has gone out, the campaign shows its numbers: delivered, bounces, spam complaints, opens,
clicks, unsubscribes, and each link's clicks.

## Clicks: people and machines

Mail security scanners (Microsoft's, Proofpoint, Mimecast, Barracuda...) follow every link in an email
seconds after it arrives, so raw click counts overstate interest. With link tracking on, each link goes
through the site, which records the click and sends the visitor on, and judges each click:

- **machine**: a scanner's address or browser name, a check that doesn't load the page, a hidden link in
  the email that only machines follow (and clicks just around it), three different links within
  seconds, or a click seconds after delivery with no sign of a person after;
- **confirmed person**: they went on to use the page the link led to (links to your own site);
- **likely a person**: the rest.

**Clicked** counts people (confirmed and likely), not machines; **Show machine clicks** adds those to
the links table. Opens leave out scanners and privacy proxies (Apple Mail's opens every email), and are
only indicative. Each contact's page lists their clicks with the verdict and why.

## Weekly digest

**New digest** on the Weekly digests tab makes a digest: a day and time, the lists, a subject
(`{week_of}` is the Monday of the week) and an email. It starts with an Entries block set to **only those
new since the last issue** and, with Events on, an Events block of what's coming up.

Each week at its time the site makes that week's issue, filled in with what's new, as a campaign:

- **Waits for an admin's approval** (default): the admins are emailed; it goes out after the hours you
  choose if an admin approves it, and is cancelled if not.
- **Goes out on its own**.

A week with fewer entries and events than you choose is skipped. **Send me this week's issue** sends a
test of it as it would be now; **Make an issue now** makes one outside its schedule. Editors set up a
digest; an admin turns it on.

## Members

With Members on, see [Members and Mailing](../members/#members-and-mailing).
