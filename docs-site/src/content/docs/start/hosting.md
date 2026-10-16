---
title: Hosting
description: Put a site on Netlify with a hosted Supabase project.
sidebar:
  order: 2
---

A site runs on Netlify (Astro SSR) with a hosted Supabase project for the database, auth and storage.

## 1. Supabase

Create a project at supabase.com, then link it and apply the migrations:

```sh
npx supabase link --project-ref <project-ref>
npx supabase db push --linked
```

Under **Authentication > URL Configuration**:

- set the **Site URL** to your domain;
- add `https://<your-domain>/admin/set-password/` to the **Redirect URLs**. Invitation and
  password-reset links land on that page;
- using [Members](../../features/members/), also add `https://<your-domain>/account/**`, where
  members' sign-up, invitation and password links land.

Invitations to editors and members are sent by the site over its SMTP settings, and their links last
7 days. Password links (and invitations on a site without SMTP) come from Supabase Auth and last as
long as **Authentication > Providers > Email > Email OTP Expiration** (an hour by default, which
Supabase recommends keeping). Set up SMTP so invitations get the longer links.

:::note
Hosted projects don't grant the API roles access to new tables the way the local stack does.
Migration 0019 grants them and sets default privileges; row-level security does the rest.
:::

:::caution[The database API is for editors only]
The anon key is public (the browser needs it to sign in), so the database's API is closed to everyone
but editors (migration `*_closed_api.sql`): anonymous requests and signed-in accounts that aren't
editors, such as members, get nothing from it. The site reads on the server with the service_role key
and shows visitors only published, permitted content. Keep `SUPABASE_SERVICE_ROLE_KEY` out of anything
the browser loads (only `PUBLIC_` variables reach it).
:::

## 2. Seed and create an admin

Point a copy of `.env` at the hosted project (its URL, anon key and service_role key, from
**Project Settings > API**) and run the same commands as locally:

```sh
npx tsx --env-file=.env.production scripts/seed.ts
npx tsx --env-file=.env.production scripts/create-editor.ts you@example.org 'a-password' admin
```

To move local media to the hosted storage bucket, use `scripts/copy-storage.ts` (resumable).

## 3. Netlify

- Create a site from your repository. The build settings are in `netlify.toml`.
- Set the same environment variables as `.env`: the Supabase URL and keys, plus the optional Compose,
  SMTP and payment ones.
- Add your domain.

Netlify deploys the site's functions with it:

| Function | What it does |
| --- | --- |
| `compose-background.mts` | Runs Compose jobs (up to 15 minutes) |
| `restore-background.mts` | Runs backup restores |
| `scheduled-snapshot.mts` | Takes scheduled snapshots, daily at 07:00 UTC |
| `ticket-emails.mts` | Hourly: ticket reminders and follow-ups, expired holds, automatic waitlists |
| `mail-send-background.mts` | Mailing: one sending run of a campaign (up to 15 minutes) |
| `mail-due.mts` | Mailing, every 5 minutes: scheduled campaigns, weekly digest issues, issues not approved in time |
| `mail-nightly.mts` | Mailing, nightly: Mailgun's bounces, complaints and unsubscribes; pruning |

## Payments

To take payments on forms or tickets, set one provider's keys and add its webhook. One endpoint per
provider serves both:

- **Stripe**: `https://<your-domain>/api/payments/stripe`, with the `checkout.session.*`,
  `charge.refunded` and `charge.refund.updated` events; its signing secret is
  `STRIPE_WEBHOOK_SECRET`.
- **Square**: `https://<your-domain>/api/payments/square`, with `payment.created`,
  `payment.updated`, `refund.created` and `refund.updated`; its signature key is
  `SQUARE_WEBHOOK_SIGNATURE_KEY`, and `SQUARE_WEBHOOK_URL` must be that exact address (the
  signature covers it).

Free tickets need no provider. See [Tickets](../../features/tickets/) and
[Forms](../../features/forms/).

## Mailing

To send [Mailing](../../features/mailing/) campaigns and digests, set up Mailgun:

- Add a **sending domain for marketing**, a subdomain such as `news.<your-domain>`, separate from
  the domain the site's other mail uses, so its reputation stays its own.
- Add the DNS records Mailgun gives for it: SPF, DKIM and the tracking CNAME (such as
  `email.news.<your-domain>`), and publish a DMARC record (`p=none` at first, `quarantine` once the
  reports are clean).
- Turn on **open tracking** for that domain. Leave click and unsubscribe tracking off: the site tracks
  clicks itself and handles unsubscribing, with its own one-click `List-Unsubscribe` header.
- Add a **webhook** to `https://<your-domain>/api/mailgun/webhook` for delivered, opened, permanent
  failure, temporary failure, spam complaint and unsubscribed events, and set its signing key as
  `MAILGUN_WEBHOOK_SIGNING_KEY`.
- Set `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION` (`eu` for EU accounts) and
  `MAIL_LINK_SECRET`. `MAILGUN_TEST_MODE=true` makes Mailgun accept emails and deliver none.
- Before the first real campaign, send tests to Gmail, Outlook and Yahoo addresses, and check that
  Gmail shows its Unsubscribe link next to the sender.

A shared IP is enough to start; a dedicated one is worth it only past roughly 50,000 emails a month,
with a warmup plan.

## 4. Invite editors

Admins invite editors from `/admin/users/`. See [Editor and roles](../../features/editor/).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | The Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side access |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` or `SMTP_URL` | Outgoing mail |
| `MAIL_FROM` | Sender, overriding the config's `mailFrom` |
| `FORMS_ADMIN_EMAIL` | Where form notifications go when a form doesn't say |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe payments |
| `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_URL` | Square payments |
| `TICKETS_NOTIFY_EMAIL` | Where the copy of each ticket order goes (default `FORMS_ADMIN_EMAIL`, then `adminEmail`) |
| `SITE_URL` | The site's address for links in ticket emails (default Netlify's `URL`) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Compose (`ANTHROPIC_MODEL` overrides the default model, `claude-sonnet-5-5`) |
| `ANTHROPIC_SEO_MODEL` | SEO text generation (default Haiku 4.5) |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `MAILGUN_TEST_MODE` | Mailing through Mailgun |
| `MAIL_LINK_SECRET` | The key for signed links in mailing emails (default: one made from the service key) |
| `LOCAL_ADMIN_EMAIL`, `LOCAL_ADMIN_PASSWORD` | The admin the e2e scripts sign in as |
