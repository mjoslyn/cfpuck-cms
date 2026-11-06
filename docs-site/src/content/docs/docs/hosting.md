---
title: Hosting
description: Put a site on a Cloudflare Worker with D1 and R2.
sidebar:
  order: 2
---

A site runs as a Cloudflare Worker (Astro SSR) with D1 for the database and a Cloudflare R2 bucket
for its files. Accounts are the site's own, in its database.

## 1. R2

Create a private bucket for the site (`npx wrangler r2 bucket create <site>`) and put its name in
`wrangler.jsonc` (`bucket_name`): the Worker reaches it through the `BUCKET` binding and serves the media
library from it at `/media/`. Scripts working on the deployed files reach it over R2's S3 API instead:
an API token with Object Read & Write (**R2 > Manage API tokens**), with `STORAGE_ENDPOINT`
`https://<account-id>.r2.cloudflarestorage.com`, `STORAGE_BUCKET`, `STORAGE_REGION` `auto` and the
token's `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY`, in their env file only.

## 2. D1

Give the Worker and its database names of the site's own in `wrangler.jsonc` (`name`,
`database_name`), then create the database and apply the migrations:

```sh
npx wrangler login
npx wrangler d1 create <site>
npx wrangler d1 migrations apply DB --remote
```

Put the database's id in `wrangler.jsonc` (`database_id`). The site reads and writes it only on the
server; the admin screens' queries go through the site, which checks each person's role. Accounts are
the site's own (in its database). Invitations (7 days), password links (an hour) and members'
confirmation links (a day) are sent by the site's email (Cloudflare Email Service, else SMTP); without
either, admins are shown invitation and password links to pass on themselves.

## 3. Seed and create an admin

Scripts reach the deployed database through Cloudflare's API. In a copy of `.env`, set
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (a token with D1 edit) and `D1_DATABASE_ID`, then run
the same commands as locally:

```sh
npx tsx --env-file=.env.production scripts/seed.ts
npx tsx --env-file=.env.production scripts/create-editor.ts you@example.org 'a-password' admin
```

A site moving from Netlify and Supabase copies its files with `scripts/copy-storage.ts` (resumable) and
its data with `scripts/pg-to-d1.ts` instead (`docs/cloudflare-migration.md` in the repository).

## 4. The Worker

Give the queue a name of the site's own in `wrangler.jsonc`, then:

```sh
npx wrangler queues create <site>-jobs
```

Turn on Cloudflare Images for the account. Set the
secrets with `npx wrangler secret put <NAME>` (`AUTH_SECRET`, `SYNC_SECRET` and the optional Compose,
payment and Mailgun keys) and the other settings as `vars` in `wrangler.jsonc`.

For the site's email, add `"send_email": [{ "name": "EMAIL" }]` to `wrangler.jsonc`, onboard the
sender's domain under **Email Service** > **Email Sending** in the Cloudflare dashboard, and set
`MAIL_FROM` to an address on it. Without that binding the site sends over SMTP (`SMTP_PASS` as a
secret, the other `SMTP_*` settings as `vars`). Deploy with `npm run deploy`, then add your domain under the Worker's **Domains &
Routes**.

To deploy from git instead (the Worker's **Settings** > **Build**, connected to the repository), set the
build command to `npm run build` and the deploy command to `npm run deploy:remote`, which applies any new
database migrations and then deploys. The API token Cloudflare makes for builds can't change D1: add
**D1 Edit** to it under **My Profile** > **API Tokens**. A migration that changes stored blocks has to go
out after its code; deploy that one with `npm run deploy` and apply it straight after. SMTP, when used, goes through the Worker's sockets: use port 587 or 465 (25 is closed to Workers).

The Worker does the background work itself (`src/worker.ts`):

| What | When |
| --- | --- |
| Compose turns, backup restores, a campaign's sending run | The jobs queue (up to 15 minutes each) |
| Ticket reminders and follow-ups, expired holds, automatic waitlists | Hourly |
| Scheduled snapshots | Daily at 07:00 UTC |
| Mailing: scheduled campaigns, weekly digest issues, issues not approved in time | Every 5 minutes |
| Mailing: Mailgun's bounces, complaints and unsubscribes; pruning | Nightly at 06:20 UTC |

## Connections

Claude, Stripe, Square and Mailgun can be set up by an admin on the deployed site, under **Settings >
Connections**, with no environment variables: paste the service's key and click **Connect**. The site
checks the key with the service and sets the rest up itself:

- **Stripe**: makes its webhook at `/api/payments/stripe` and keeps its signing secret.
- **Square**: finds whether the token is for production or the sandbox and which location takes
  payments (asking when there are several), and makes its webhook subscription.
- **Mailgun**: finds the account's region and sending domain (asking when there are several), adds its
  webhooks and reads its signing key.

Webhooks need the site's public address, so connect on the live site (`SITE_URL`), not a local copy.
Connecting again with the same key keeps the webhook and its secret; with a new key, the old webhook is
deleted only once the new one is made and its secret saved. Mailgun's webhooks get the site's address
beside any already there, so a staging copy connected to the same domain doesn't take them from the live
site. A setting the server sets that the key doesn't fit (say
`MAILGUN_REGION=eu` with a US key) stops the connection until it is changed on the server.

Keys are encrypted in the database with a key made from `AUTH_SECRET`, readable by no admin or editor,
and never synced or backed up. Admins see only their last 4 characters. Payment and Mailgun keys ask for
the admin's password again, and every change (not a check that changed nothing) is emailed to all admins. Changing `AUTH_SECRET` makes
saved keys unreadable: enter them again. A key set as an environment variable wins and can't be changed
on the screen, for a site whose keys should stay with the Cloudflare account.

## Payments

To take payments on forms or tickets, connect one provider under Settings > Connections (above), or set
its keys and add its webhook by hand. One endpoint per provider serves both:

- **Stripe**: `https://<your-domain>/api/payments/stripe`, with the `checkout.session.*`,
  `charge.refunded`, `charge.refund.updated`, `refund.updated` and `refund.failed` events; its signing secret is
  `STRIPE_WEBHOOK_SECRET`.
- **Square**: `https://<your-domain>/api/payments/square`, with `payment.created`,
  `payment.updated`, `refund.created` and `refund.updated`; its signature key is
  `SQUARE_WEBHOOK_SIGNATURE_KEY`, and `SQUARE_WEBHOOK_URL` must be that exact address (the
  signature covers it).

Free tickets need no provider. See [Tickets](../../features/tickets/) and
[Forms](../../features/forms/).

## Mailing

To send [Mailing](../../features/mailing/) campaigns and digests, set up Mailgun (its key, domain,
region and webhooks can be connected under Settings > Connections, above, in place of the last two
points' webhook and variables):

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
| `SYNC_SECRET` | Shared with another copy of the site for Settings > Sync (32 characters or more) |
| `SYNC_REMOTE_URL`, `SYNC_REMOTE_NAME` | On the copy that starts syncs: the other copy's address and name |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `D1_DATABASE_ID` | Scripts only: the deployed database through Cloudflare's API |
| `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | Scripts only: the deployed files over R2's S3 API (set, they win over the binding) |
| `AUTH_SECRET` | Signs sessions and the site's links: a long random value (`openssl rand -hex 32`) |
| `AUTH_CONFIRM_EMAIL` | `false` lets member sign-ups in without confirming their address |
| `DATABASE_URL` | Moving a site only: the Postgres database `scripts/pg-to-d1.ts` copies from |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` or `SMTP_URL` | Outgoing mail over SMTP, when the Worker has no `EMAIL` binding (Cloudflare Email Service) |
| `MAIL_FROM` | Sender, overriding the config's `mailFrom` |
| `FORMS_ADMIN_EMAIL` | Where form notifications go when a form doesn't say |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe payments (or Settings > Connections) |
| `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_URL` | Square payments (or Settings > Connections) |
| `TICKETS_NOTIFY_EMAIL` | Where the copy of each ticket order goes (default `FORMS_ADMIN_EMAIL`, then `adminEmail`) |
| `SITE_URL` | The site's address for links in emails (default the request's address). Required for Mailing: campaigns and digests are sent without a request |
| `SITE_NOINDEX` | `1` or `true` on a demo or preview copy: every answer, static files included, tells search engines to stay away (`X-Robots-Tag: noindex`). Set it in `wrangler.jsonc` `vars`, which the build reads for static files. After changing it, save anything in the admin to clear the cached pages |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Compose (the key, or Settings > Connections; `ANTHROPIC_MODEL` overrides the default model, `claude-sonnet-5-5`) |
| `ANTHROPIC_SEO_MODEL` | SEO text generation (default Haiku 4.5) |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `MAILGUN_TEST_MODE` | Mailing through Mailgun (or Settings > Connections, but for test mode) |
| `MAIL_LINK_SECRET` | The key for signed links in mailing emails (default: one made from `AUTH_SECRET`) |
| `LOCAL_ADMIN_EMAIL`, `LOCAL_ADMIN_PASSWORD` | The admin the e2e scripts sign in as |
