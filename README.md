# supapuck-cms

A CMS for small business and organisation sites: Astro rendering on a
Cloudflare Worker, content in D1 and files in R2, the Puck visual editor, and Compose, which writes pages with Claude from
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
- Optional: a local mail catcher to see the site's email (Mailpit, through Docker or Homebrew)
- For hosting: a Cloudflare account (Workers paid plan: the jobs queue and CPU time)
- Optional: an Anthropic API key (Compose), an SMTP account (form notifications and ticket emails)
  and a Stripe or Square account (paid forms and tickets)

Wrangler (Cloudflare's CLI) is a dev dependency, so `npx wrangler` needs no install.

## Local setup

1. **Install**

   ```
   git clone https://github.com/mjoslyn/supapuck-cms.git my-site
   cd my-site
   npm install
   ```

2. **Make the local database.** This makes the local D1 database from `db/migrations/`, in
   `.wrangler/state`, where the local file bucket also lives. Nothing else needs to run.

   ```
   npm run db:migrate
   ```

   To see the site's email, run a mail catcher and set `SMTP_URL=smtp://127.0.0.1:1025` in `.env`
   (its inbox is at http://127.0.0.1:8025):

   ```
   docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit
   ```

3. **Configure.** Copy the example env file:

   ```
   cp .env.example .env
   ```

   Then set `AUTH_SECRET` to any long random value (`openssl rand -hex 32`).

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
   Worker does in production (workerd), with local bindings: the database is the local D1, the same
   file the scripts above use.

### Optional features

- **Compose.** Set `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_MODEL` (default claude-sonnet-5-5).
  Restart the dev server after setting it.
- **Form notification mail.** Set either `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and
  `SMTP_SECURE`, or a single `SMTP_URL` such as `smtp://user:pass@host:587`. Also set `MAIL_FROM`.
  Notifications go to each form's addresses, or to `FORMS_ADMIN_EMAIL`, or to `adminEmail` in the
  site config. Without SMTP, submissions are stored but no mail is sent.
  Locally, `SMTP_URL=smtp://127.0.0.1:1025` sends to a mail catcher such as Mailpit (inbox at
  http://127.0.0.1:8025).
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

  Members' emails (confirming an address, resetting a password, invitations) are sent by the site
  over SMTP; locally they arrive in the mail catcher.
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

1. **Cloudflare resources.** Give the Worker, its database, bucket and queue names of the site's own
   in `wrangler.jsonc` (`name`, `database_name`, `bucket_name`, the queue's), then:
   ```
   npx wrangler login
   npx wrangler d1 create <site>
   npx wrangler d1 migrations apply DB --remote
   npx wrangler r2 bucket create <site>
   npx wrangler queues create <site>-jobs
   ```
   Put the database's id in `wrangler.jsonc` (`database_id`). Images needs Cloudflare Images turned on
   for the account.
2. **Scripts on the deployed site** (optional) reach its database through Cloudflare's API and its
   files over R2's S3 API: an API token with D1 edit (`CLOUDFLARE_API_TOKEN`, with
   `CLOUDFLARE_ACCOUNT_ID` and `D1_DATABASE_ID`) and an R2 API token (R2 > Manage API tokens:
   `STORAGE_ENDPOINT` `https://<account-id>.r2.cloudflarestorage.com`, `STORAGE_BUCKET`,
   `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`), in a copy of `.env` such as `.env.production`.
3. **Seed and create an admin**, with the database settings above, by the same two commands as locally:
   ```
   npx tsx --env-file=.env.production scripts/seed.ts
   npx tsx --env-file=.env.production scripts/create-editor.ts you@example.org 'a-password' admin
   ```
   A site moving from Netlify and Supabase copies its files with `scripts/copy-storage.ts` and its data
   with `scripts/pg-to-d1.ts` instead (`docs/cloudflare-migration.md`, Moving an existing site).
4. **The Worker.**
   Set the secrets (`npx wrangler secret put <NAME>`): `AUTH_SECRET` (a long random value of its own,
   e.g. `openssl rand -hex 32`), `SMTP_PASS` (invitations, password links and confirmations are sent
   over SMTP; port 587 or 465), `SYNC_SECRET` (to sync with another copy: the same long random value on
   both) and the optional Compose, payment and Mailgun keys; the rest (`SMTP_HOST`, `SMTP_USER`,
   `MAIL_FROM`, `SITE_URL`...) as `vars` in `wrangler.jsonc` or as secrets too. Deploy with
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
npx wrangler d1 migrations apply DB --remote       # if there are new migrations
npx tsx --env-file=.env scripts/migrate-content.ts # if stored content needs migrating
```

The merges stay clean as long as the site only changes `src/site/`, its own migrations
(`db/migrations/*_site_*.sql`), `AGENTS.md`, `README.md` and its local settings. If you fix a core bug while working on a site,
commit the fix on its own and `git cherry-pick` it into the core repository.

## Checks

```
npm run check                                   # typecheck
npx tsx scripts/checks/recurrence.ts            # recurrence rules and DST
npx tsx scripts/checks/mailing.ts               # mailing emails, signed links, click verdicts, digest times
npx tsx --env-file=.env scripts/publishing-e2e.ts   # drafts, preview, publish (needs LOCAL_ADMIN_* in .env)
```
