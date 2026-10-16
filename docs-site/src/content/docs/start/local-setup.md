---
title: Local setup
description: Run the example site on your machine.
sidebar:
  order: 1
---

## Requirements

- Node 22.12 or later
- Docker (Docker Desktop or OrbStack), for the local Supabase stack
- For hosting: a Supabase project and a Netlify site
- Optional: an Anthropic API key (Compose), an SMTP account (form notifications and ticket emails)
  and a Stripe or Square account (paid forms and tickets)

The Supabase CLI runs through `npx`, so you don't need to install it.

## Steps

1. **Install.**

   ```sh
   git clone https://github.com/mjoslyn/supapuck-cms.git my-site
   cd my-site
   npm install
   ```

2. **Start the database.** This starts Supabase in Docker on ports 56520–56529 and applies the
   migrations in `supabase/migrations/`.

   ```sh
   npx supabase start
   ```

   On a machine short of memory, skip the services the CMS doesn't use:

   ```sh
   npx supabase start -x logflare,vector,studio,imgproxy,edge-runtime,realtime,supavisor,postgres-meta
   ```

3. **Configure.** Copy the example env file and fill in the values `npx supabase status` prints:

   ```sh
   cp .env.example .env
   ```

   | `.env` | from `supabase status` |
   | --- | --- |
   | `PUBLIC_SUPABASE_URL` | API URL (`http://127.0.0.1:56521`) |
   | `PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |

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

### Form notification mail

Set either `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_SECURE`, or a single
`SMTP_URL` such as `smtp://user:pass@host:587`. Also set `MAIL_FROM`. Notifications go to each form's
addresses, or to `FORMS_ADMIN_EMAIL`, or to `adminEmail` in the site config. Without SMTP,
submissions are stored but no mail is sent.

Locally, `SMTP_URL=smtp://127.0.0.1:56525` sends to the Supabase stack's mail catcher, whose inbox is
at http://127.0.0.1:56524.

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
unpaid order holds its tickets, and the emails. Ticket emails need SMTP; their links use `SITE_URL`
(default Netlify's `URL`), and the copy of each order goes to `TICKETS_NOTIFY_EMAIL` (default
`FORMS_ADMIN_EMAIL`, then `adminEmail`). The same keys take payments on forms. See
[Tickets](../../features/tickets/) and [Forms](../../features/forms/).

### Members

Turn it on under **Settings > Members** (admins): the levels, how people join and the message
visitors see. Members sign in at `/account/`; their emails (confirming an address, resetting a
password, invitations) go through Supabase Auth and, locally, arrive in the mail catcher. See
[Members](../../features/members/).

## Troubleshooting

- After merges that change dependencies, restart the dev server. Stale Vite dependency caches show
  as "Outdated Optimize Dep" and islands that don't hydrate.
- Netlify's edge-function emulation is off under `astro dev` (`astro.config.mjs`): its Deno runtime
  ran out of memory on the editor's image requests.
