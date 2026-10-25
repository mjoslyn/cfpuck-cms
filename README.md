# supapuck-cms

A CMS for small business and organisation sites: Astro rendering on a
Cloudflare Worker, content in Postgres (a Supabase project) and files in R2, the Puck visual editor, and Compose, which writes pages with Claude from
the documents, images and links an editor adds.

The core is everything outside `src/site/`. `src/site/` is an example site called Example Town, with
its own content types, taxonomies, card designs, colors and theme. A real site is a copy of this
repository that replaces `src/site/` and keeps this one as its `upstream`. `CORE.md` documents the
code; `docs-site/` is the same documentation as a site, published to
https://mjoslyn.github.io/supapuck-cms/.

What you get:

- Page editor with drafts, preview, revisions, patterns and an accessibility check
- Content types and fields from one config file; tags and categories; collections (grids, lists,
  sliders, load more)
- Events (optional, Settings > Events) with recurrence, a calendar (list, month, day) and `.ics` feeds
- Media library with focal points, standard crops and AVIF/WebP copies
- Form builder with conditional logic, email notifications and payments (Stripe or Square)
- Event tickets and free registrations: ticket types with prices, capacities and sales windows,
  a waitlist, an attendee list with check-in and refunds, and confirmation, reminder and follow-up
  emails
- Members: levels, sign-ups, members-only pages and blocks, and member ticket prices
- Mailing (optional, through Mailgun): lists with confirmed sign-ups, campaigns and a weekly digest
  built in the email builder, one-click unsubscribe, and opens and clicks with mail scanners' clicks
  told apart from people's
- Compose: pages and edits written by Claude from your materials
- Roles: editor and admin, with invitations; what each may read and change is checked on the server

## Requirements

- Node 22.12 or later
- Docker (Docker Desktop or OrbStack), for the local Supabase stack
- For hosting: a Cloudflare account (Workers paid plan: the jobs queue and CPU time), and a Supabase
  project for the database
- Optional: an Anthropic API key (Compose), an SMTP account (form notifications and ticket emails)
  and a Stripe or Square account (paid forms and tickets)

The Supabase CLI runs through `npx`, so you don't need to install it.

## Local setup

1. **Install**

   ```
   git clone https://github.com/mjoslyn/supapuck-cms.git my-site
   cd my-site
   npm install
   ```

2. **Start the database.** This starts Supabase in Docker on ports 56520–56529 and applies the
   migrations in `supabase/migrations/`.

   ```
   npx supabase start
   ```

   On a machine short of memory, skip the services the CMS doesn't use:
   `npx supabase start -x logflare,vector,studio,imgproxy,edge-runtime,realtime,supavisor,postgres-meta`.

3. **Configure.** Copy the example env file:

   ```
   cp .env.example .env
   ```

   Then fill in the values that `npx supabase status` prints:

   | `.env` | from `supabase status` |
   | --- | --- |
   | `PUBLIC_SUPABASE_URL` | API URL (`http://127.0.0.1:56521`) |
   | `PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `DATABASE_URL` | DB URL (`postgresql://postgres:postgres@127.0.0.1:56522/postgres`) |
   | `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | S3 access key and secret (the rest of `STORAGE_*` is in `.env.example`) |
   | `AUTH_SECRET` | any long random value (`openssl rand -hex 32`) |

4. **Add starter content.** This adds the header, footer, base templates, a home page, an About page
   and a sample event. It skips anything that already exists, so it is safe to run again.

   ```
   npm run seed
   ```

5. **Create an admin.** This makes an admin user you can sign in with:

   ```
   npx tsx --env-file=.env scripts/create-editor.ts you@example.org 'a-password' admin
   ```

6. **Run it.**

   ```
   npx astro dev
   ```

   The site is at http://localhost:4321 and the editor at http://localhost:4321/admin/. It runs as the
   Worker does in production (workerd), with local bindings: `.env`'s
   `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` points the database binding at the local
   stack.

### Optional features

- **Compose.** Set `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_MODEL` (default claude-sonnet-5-5).
  Restart the dev server after setting it.
- **Form notification mail.** Set either `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and
  `SMTP_SECURE`, or a single `SMTP_URL` such as `smtp://user:pass@host:587`. Also set `MAIL_FROM`.
  Notifications go to each form's addresses, or to `FORMS_ADMIN_EMAIL`, or to `adminEmail` in the
  site config. Without SMTP, submissions are stored but no mail is sent.
  Locally, `SMTP_URL=smtp://127.0.0.1:56525` sends to the Supabase stack's mail catcher (inbox at
  http://127.0.0.1:56524).
- **Events.** Turn them on under Settings > Events (admins): event and venue types, the calendar at
  `/events/`, event categories, `.ics` feeds and the event blocks, plus the default time zone (an event
  can choose its own). Run `npm run seed` again afterwards for the event templates and a sample
  event. The site config needs nothing for them; to add fields or change labels and URLs, extend them
  with `events` in `src/site/config.ts`:

  ```ts
  events: {
    event: { fields: [{ key: 'ages', label: 'Ages', type: 'text' }], removeFields: ['schedule'] },
    venue: { fields: [{ key: 'parking', label: 'Parking', type: 'textarea' }] },
    category: { label: 'Kind of event' },
  },
  ```
- **Tickets.** With Events on, add ticket types in an event's settings (under Tickets); the Event
  details block shows the form, or place a Tickets block on any page or template. Free tickets
  need nothing else. For paid ones, set one provider's keys:
  - Stripe: `STRIPE_SECRET_KEY` (`sk_test_...` to test) and `STRIPE_WEBHOOK_SECRET`.
  - Square: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT=sandbox` to test,
    `SQUARE_WEBHOOK_SIGNATURE_KEY` and `SQUARE_WEBHOOK_URL`.

  With both set, choose one under Settings > Tickets, which also has the currency, how long an
  unpaid order holds its tickets, and the emails. Ticket emails need SMTP; their links use
  `SITE_URL` (default the request's address), and the copy of each order goes to `TICKETS_NOTIFY_EMAIL`
  (default `FORMS_ADMIN_EMAIL`, then `adminEmail`). Orders and the waitlist are at `/admin/tickets/`.
  The same keys take payments on forms (a form's Payment tab).
- **Members.** Turn it on under Settings > Members (admins): membership levels, how people join
  (admins add them, sign up and wait for approval, or sign up and join at once) and the message
  shown to visitors who can't see something. Then:
  - make a page members only in its settings (Members), or wrap blocks in a **Members only** block;
  - give ticket types member prices or make them members only (an event's Tickets settings);
  - manage members at `/admin/members/`. Members sign in, sign up and reset their password at
    `/account/`; to design that page, make a page with that address and put the **Member account**
    block on it.

  Members' emails (confirming an address, resetting a password, invitations) go through Supabase
  Auth; locally they arrive in the mail catcher.
- **Mailing.** Turn it on under Settings > Mailing Lists (admins) and fill in the postal address every email
  carries (nothing sends without it). Add lists on the Mailing Lists screen (Lists tab), put a **Subscribe** block where
  people should sign up (or link to `/subscribe/`), then write campaigns or set up a weekly digest there. Segments (tags, fields, sign-up date, opens and clicks) send to part of a list, members or not.
  Sign-ups are confirmed by email over SMTP. Sending needs Mailgun (see Hosting): `MAILGUN_API_KEY`,
  `MAILGUN_DOMAIN`, `MAILGUN_REGION` (`eu` for EU accounts) and `MAILGUN_WEBHOOK_SIGNING_KEY`, plus
  `MAIL_LINK_SECRET` for the signed links in emails. Locally, without Mailgun, campaigns go to the mail
  catcher one address at a time. With Members on, member sign-up and the account page offer the lists
  chosen under Settings > Mailing Lists.

## Make it your site

Replace `AGENTS.md` with your site's own notes (its content types, blocks, hosting, rules), keeping
its first line, `@CORE.md`, which brings in the core's reference; the core's `AGENTS.md` is about
working on the core itself.

Everything site-specific lives in `src/site/`:

| File | What it holds |
| --- | --- |
| `config.ts` | Name, organization, timezone, mail sender, admin email, a short brief for Compose, content types (labels, URLs, fields), taxonomies, and changes to the core's event types (`events`) |
| `styles/tokens.css` | Colors, fonts, type sizes and spacing. The core's styles use the role colors (`--color-text`, `--color-accent`, `--color-dark`, ...), which this file maps onto your palette |
| `presets.json` | The colors, sizes and spacing the editor offers |
| `styles/theme.css` | Your own styles |
| `lib/content/cards.ts` | Card designs for collections |
| `render.ts`, `editor.tsx` | Your own blocks (their markup in `render/c/`), and their settings panels |
| `migrations/` | Content migrations for your own data changes |
| `pages/api/`, `routes.json` | Your own endpoints |
| `public/` | Your own static files (scripts, images), served at the same paths as `public/` |
| `scripts/` | Your own checks |

Inside `src/site/`, files sit where their core counterparts do (`render/c/`, `lib/`, `pages/api/`,
`styles/`, `public/`, `scripts/`), so each maps onto the core.

After you change `config.ts`, run `npm run check`. The editor, URLs, Compose and admin tabs all
follow the config. `CORE.md` describes each option.

## Hosting

1. **Cloudflare R2** (files). Create a bucket for the site (R2 > Create bucket; private) and an API
   token with Object Read & Write on it (R2 > Manage API tokens). `STORAGE_ENDPOINT` is
   `https://<account-id>.r2.cloudflarestorage.com`, `STORAGE_BUCKET` the bucket's name, and the token's
   access key and secret are `STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_ACCESS_KEY`.
2. **Supabase** (the database). Create a project at supabase.com.
   - Link it and apply the migrations:
     ```
     npx supabase link --project-ref <project-ref>
     npx supabase db push --linked
     ```
3. **Seed and create an admin.** Point a copy of `.env` at the hosted project: its URL, anon key and
   service_role key, from Project Settings > API, and `DATABASE_URL`, its transaction pooler's
   connection string (Connect > Transaction pooler). Then run the same two commands as locally:
   ```
   npx tsx --env-file=.env.production scripts/seed.ts
   npx tsx --env-file=.env.production scripts/create-editor.ts you@example.org 'a-password' admin
   ```
   A site moving from Supabase Storage copies its files into the bucket with `scripts/copy-storage.ts`.
4. **The Worker.** Give it a name of the site's own in `wrangler.jsonc` (`name`, and the queue's), then:
   ```
   npx wrangler login
   npx wrangler hyperdrive create <site>-db --connection-string="<the project's direct connection string>"
   npx wrangler queues create <site>-jobs
   ```
   Put the Hyperdrive id in `wrangler.jsonc`. Images needs Cloudflare Images turned on for the account.
   Set the secrets (`npx wrangler secret put <NAME>`): `AUTH_SECRET` (a long random value of its own,
   e.g. `openssl rand -hex 32`), `STORAGE_SECRET_ACCESS_KEY`, `SMTP_PASS` (invitations, password links
   and confirmations are sent over SMTP; port 587 or 465), and the optional Compose, payment and Mailgun
   keys; the rest (`STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `SMTP_HOST`,
   `SMTP_USER`, `MAIL_FROM`, `SITE_URL`...) as `vars` in `wrangler.jsonc` or as secrets too. Deploy with
   `npm run deploy`, then add your domain to the Worker (Workers > the Worker > Domains & Routes).
   - Taking payments (forms or tickets): add the payment provider's webhook. One endpoint serves both:
     - Stripe: `https://<your-domain>/api/payments/stripe`, with the `checkout.session.*`,
       `charge.refunded` and `charge.refund.updated` events.
     - Square: `https://<your-domain>/api/payments/square`, with `payment.created`,
       `payment.updated`, `refund.created` and `refund.updated`; set `SQUARE_WEBHOOK_URL` to that
       exact address.

   - Using Mailing: in Mailgun, add a sending domain for marketing (a subdomain such as
     `news.<your-domain>`, separate from the domain your other mail uses) and add its SPF, DKIM and
     tracking CNAME records; publish a DMARC record (`p=none` at first, `quarantine` once reports are
     clean). Turn on open tracking for that domain; leave click and unsubscribe tracking off (the site
     does both). Add a webhook for delivered, opened, permanent and temporary failure, spam complaint
     and unsubscribed events to `https://<your-domain>/api/mailgun/webhook`, and set its signing key as
     `MAILGUN_WEBHOOK_SIGNING_KEY`. Set `MAILGUN_TEST_MODE=true` to try it without delivering anything.
     Before the first real campaign, send tests to Gmail, Outlook and Yahoo addresses and check the
     unsubscribe link Gmail shows next to the sender.

   The Worker does the background work itself: its jobs queue runs Compose turns, backup restores and
   campaigns' sending runs, and its Cron Triggers run ticket reminders and follow-ups (hourly),
   snapshots (daily), and Mailing's scheduled campaigns and digests (every 5 minutes) and upkeep
   (nightly).
5. **Invite editors** from `/admin/users/`.

## Updating the core

A site keeps this repository as its `upstream` remote. To set that up after cloning:

```
git remote rename origin upstream
git remote add origin git@github.com:<you>/my-site.git
```

To take core updates:

```
git fetch upstream
git merge upstream/main
npx supabase db push --linked                      # if there are new migrations
npx tsx --env-file=.env scripts/migrate-content.ts # if stored content needs migrating
```

The merges stay clean as long as the site only changes `src/site/`, its own migrations
(`supabase/migrations/*_site_*.sql`), `AGENTS.md`, `README.md` and its local settings. If you fix a core bug while working on a site,
commit the fix on its own and `git cherry-pick` it into the core repository.

## Checks

```
npm run check                                   # typecheck
npx tsx scripts/checks/recurrence.ts            # recurrence rules and DST
npx tsx scripts/checks/mailing.ts               # mailing emails, signed links, click verdicts, digest times
npx tsx --env-file=.env scripts/publishing-e2e.ts   # drafts, preview, publish (needs LOCAL_ADMIN_* in .env)
```
