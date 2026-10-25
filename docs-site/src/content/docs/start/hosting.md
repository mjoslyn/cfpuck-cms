---
title: Hosting
description: Put a site on a Cloudflare Worker with a hosted Supabase project.
sidebar:
  order: 2
---

A site runs as a Cloudflare Worker (Astro SSR) with a hosted Supabase project for the database and a
Cloudflare R2 bucket for its files. Accounts are the site's own, in its database.

## 1. R2

Create a private bucket for the site (**R2 > Create bucket**) and an API token with Object Read & Write
on it (**R2 > Manage API tokens**). Set `STORAGE_ENDPOINT` to
`https://<account-id>.r2.cloudflarestorage.com`, `STORAGE_BUCKET` to the bucket's name,
`STORAGE_REGION` to `auto`, and `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` to the token's
access key and secret. The site serves the media library from it at `/media/`.

## 2. Supabase

Create a project at supabase.com, then link it and apply the migrations:

```sh
npx supabase link --project-ref <project-ref>
npx supabase db push --linked
```

Accounts are the site's own (in its database, not Supabase Auth), so nothing needs setting under
Supabase's Authentication. Invitations (7 days), password links (an hour) and members' confirmation
links (a day) are sent by the site over its SMTP settings; without SMTP, admins are shown invitation
and password links to pass on themselves.

:::note
Hosted projects don't grant the API roles access to new tables the way the local stack does.
Migration 0019 grants them and sets default privileges; row-level security does the rest.
:::

:::caution[The database API is for editors only]
The anon key is public (the browser needs it to sign in), so the database's API is closed to everyone
but editors (migration `*_closed_api.sql`); the site doesn't use it for data. The site reads and
writes on the server over `DATABASE_URL` and shows visitors only published, permitted content; the
admin screens' queries go through the site, which checks each person's role. Keep
`SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` out of anything the browser loads (only `PUBLIC_`
variables reach it).
:::

## 3. Seed and create an admin

Point a copy of `.env` at the hosted project (its URL, anon key and service_role key, from
**Project Settings > API**, and `DATABASE_URL`, its transaction pooler's connection string from
**Connect > Transaction pooler**) and run the same commands as locally:

```sh
npx tsx --env-file=.env.production scripts/seed.ts
npx tsx --env-file=.env.production scripts/create-editor.ts you@example.org 'a-password' admin
```

A site moving from Supabase Storage copies its files into the bucket with `scripts/copy-storage.ts`
(resumable).

## 4. The Worker

Give the Worker and its queue names of the site's own in `wrangler.jsonc`, then:

```sh
npx wrangler login
npx wrangler hyperdrive create <site>-db --connection-string="<the project's direct connection string>"
npx wrangler queues create <site>-jobs
```

Put the Hyperdrive id in `wrangler.jsonc`, and turn on Cloudflare Images for the account. Set the
secrets with `npx wrangler secret put <NAME>` (`AUTH_SECRET`, `STORAGE_SECRET_ACCESS_KEY`, `SMTP_PASS`,
and the optional Compose, payment and Mailgun keys) and the other settings as `vars` in
`wrangler.jsonc`. Deploy with `npm run deploy`, then add your domain under the Worker's **Domains &
Routes**. SMTP goes through the Worker's sockets: use port 587 or 465 (25 is closed to Workers).

The Worker does the background work itself (`src/worker.ts`):

| What | When |
| --- | --- |
| Compose turns, backup restores, a campaign's sending run | The jobs queue (up to 15 minutes each) |
| Ticket reminders and follow-ups, expired holds, automatic waitlists | Hourly |
| Scheduled snapshots | Daily at 07:00 UTC |
| Mailing: scheduled campaigns, weekly digest issues, issues not approved in time | Every 5 minutes |
| Mailing: Mailgun's bounces, complaints and unsubscribes; pruning | Nightly at 06:20 UTC |

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

## 5. Invite editors

Admins invite editors from `/admin/users/`. See [Editor and roles](../../features/editor/).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | The Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Sync with another copy over its database API |
| `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | The site's files (R2) |
| `AUTH_SECRET` | Signs sessions and the site's links: a long random value (`openssl rand -hex 32`) |
| `AUTH_CONFIRM_EMAIL` | `false` lets member sign-ups in without confirming their address |
| `DATABASE_URL` | The database, through the project's transaction pooler (port 6543) |
| `DATABASE_POOL_MAX` | Database connections per server instance (default 5) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` or `SMTP_URL` | Outgoing mail |
| `MAIL_FROM` | Sender, overriding the config's `mailFrom` |
| `FORMS_ADMIN_EMAIL` | Where form notifications go when a form doesn't say |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe payments |
| `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_URL` | Square payments |
| `TICKETS_NOTIFY_EMAIL` | Where the copy of each ticket order goes (default `FORMS_ADMIN_EMAIL`, then `adminEmail`) |
| `SITE_URL` | The site's address for links in emails (default the request's address) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Compose (`ANTHROPIC_MODEL` overrides the default model, `claude-sonnet-5-5`) |
| `ANTHROPIC_SEO_MODEL` | SEO text generation (default Haiku 4.5) |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `MAILGUN_TEST_MODE` | Mailing through Mailgun |
| `MAIL_LINK_SECRET` | The key for signed links in mailing emails (default: one made from the service key) |
| `LOCAL_ADMIN_EMAIL`, `LOCAL_ADMIN_PASSWORD` | The admin the e2e scripts sign in as |
