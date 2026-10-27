---
title: Local setup
description: Run the example site on your machine.
sidebar:
  order: 1
---

## Requirements

- Node 22.12 or later
- Optional: a local mail catcher to see the site's email (Mailpit, through Docker or Homebrew)
- For hosting: a Cloudflare account (Workers paid plan)
- Optional: an Anthropic API key (Compose), a domain onboarded for Cloudflare Email Service (or an SMTP
  account) for the site's email, and a Stripe or Square account (paid forms and tickets)

Wrangler (Cloudflare's CLI) is a dev dependency, so `npx wrangler` needs no install.

## Steps

1. **Install.**

   ```sh
   git clone https://github.com/mjoslyn/cfpuck-cms.git my-site
   cd my-site
   npm install
   ```

2. **Make the local database.** This makes the local D1 database from `db/migrations/`, in
   `.wrangler/state`, where the local file bucket also lives (shared by the dev server and the
   scripts). Nothing else needs to run.

   ```sh
   npm run db:migrate
   ```

3. **Configure.** Copy the example env file and set `AUTH_SECRET` to any long random value
   (`openssl rand -hex 32`):

   ```sh
   cp .env.example .env
   ```

4. **Add starter content**: the header, footer, base templates, a home page, an About page and a
   sample event. It skips anything that already exists, so it is safe to run again.

   ```sh
   npm run seed
   ```

5. **Create an admin.**

   ```sh
   npx tsx --env-file=.env scripts/create-editor.ts you@example.org 'a-password' admin
   ```

6. **Run it.**

   ```sh
   npx astro dev
   ```

   The site is at http://localhost:4321 and the editor at http://localhost:4321/admin/.

## Optional features

### Compose

Set `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). Restart the
dev server after setting it. See [Compose](../../features/compose/).

### Email

The site's own email (form notifications, ticket emails, account emails and mailing-list
confirmations) goes through Cloudflare Email Service when the Worker has its `EMAIL` binding
(`"send_email": [{ "name": "EMAIL" }]` in `wrangler.jsonc`, the sender's domain onboarded under Email
Service > Email Sending, `MAIL_FROM` an address on it; see Hosting). Without the binding it goes over
SMTP: either `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_SECURE`, or a single
`SMTP_URL` such as `smtp://user:pass@host:587`. With neither, submissions are stored but no mail is
sent. Notifications go to each form's addresses, or to `FORMS_ADMIN_EMAIL`, or to `adminEmail` in the
site config.

Locally, run a mail catcher such as Mailpit (`docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit`)
and set `SMTP_URL=smtp://127.0.0.1:1025`; its inbox is at http://127.0.0.1:8025.

### Events

Turn them on under **Settings > Events** (admins), where the default time zone is set too, then run
`npm run seed` again for the event templates and a sample event. The site's config needs nothing; to
add fields or change labels and URLs, see [Extending the event types](../../features/events/#extending-the-event-types).

### Payments and tickets

Turn Events on under Settings > Events, then add ticket types in an event's settings (under
Tickets); the Event details block shows the form, or place a Tickets block on any page or template. Free tickets need nothing else. For paid ones, set one provider's keys:

- Stripe: `STRIPE_SECRET_KEY` (`sk_test_...` to test) and `STRIPE_WEBHOOK_SECRET`.
- Square: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT=sandbox` to test,
  `SQUARE_WEBHOOK_SIGNATURE_KEY` and `SQUARE_WEBHOOK_URL`.

With both set, choose one under **Settings > Tickets**, which also has the currency, how long an
unpaid order holds its tickets, and the emails. Ticket emails need email set up (see Email); their links use `SITE_URL`
(default the request's address), and the copy of each order goes to `TICKETS_NOTIFY_EMAIL` (default
`FORMS_ADMIN_EMAIL`, then `adminEmail`). The same keys take payments on forms. See
[Tickets](../../features/tickets/) and [Forms](../../features/forms/).

### Members

Turn it on under **Settings > Members** (admins): the levels, how people join and the message
visitors see. Members sign in at `/account/`; their emails (confirming an address, resetting a
password, invitations) are sent by the site's email and, locally, arrive in the mail catcher. See
[Members](../../features/members/).

## Troubleshooting

- After merges that change dependencies, restart the dev server. Stale Vite dependency caches show
  as "Outdated Optimize Dep" and islands that don't hydrate.
- `astro dev` runs the site in workerd, as the Worker runs in production: code that only works in Node
  fails there too. Locally, image crops are centred (Miniflare's Images ignores crop rectangles).
