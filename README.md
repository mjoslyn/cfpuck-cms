# supapuck-cms

A CMS for small organisation sites: Astro rendering on
Netlify, content in Supabase, the Puck visual editor, and Compose, which writes pages with Claude from
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
- Events with recurrence, a calendar (list, month, day) and `.ics` feeds
- Media library with focal points, standard crops and AVIF/WebP copies
- Form builder with conditional logic and email notifications
- Compose: pages and edits written by Claude from your materials
- Roles: editor and admin, with invitations

## Requirements

- Node 22.12 or later
- Docker (Docker Desktop or OrbStack), for the local Supabase stack
- For hosting: a Supabase project and a Netlify site
- Optional: an Anthropic API key (Compose) and an SMTP account (form notifications)

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

   The site is at http://localhost:4321 and the editor at http://localhost:4321/admin/.

### Optional features

- **Compose.** Set `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_MODEL` (default claude-opus-5-5).
  Restart the dev server after setting it.
- **Form notification mail.** Set either `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and
  `SMTP_SECURE`, or a single `SMTP_URL` such as `smtp://user:pass@host:587`. Also set `MAIL_FROM`.
  Notifications go to each form's addresses, or to `FORMS_ADMIN_EMAIL`, or to `adminEmail` in the
  site config. Without SMTP, submissions are stored but no mail is sent.
  Locally, `SMTP_URL=smtp://127.0.0.1:56525` sends to the Supabase stack's mail catcher (inbox at
  http://127.0.0.1:56524).

## Make it your site

Replace `AGENTS.md` with your site's own notes (its content types, blocks, hosting, rules), keeping
its first line, `@CORE.md`, which brings in the core's reference; the core's `AGENTS.md` is about
working on the core itself.

Everything site-specific lives in `src/site/`:

| File | What it holds |
| --- | --- |
| `config.ts` | Name, organization, timezone, mail sender, admin email, a short brief for Compose, content types (labels, URLs, fields) and taxonomies |
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

1. **Supabase.** Create a project at supabase.com.
   - Link it and apply the migrations:
     ```
     npx supabase link --project-ref <project-ref>
     npx supabase db push --linked
     ```
   - Under Authentication > URL Configuration, set the **Site URL** to your domain.
   - Add `https://<your-domain>/admin/set-password/` to the **Redirect URLs**. Invitation and
     password-reset links land on that page.
2. **Seed and create an admin.** Point a copy of `.env` at the hosted project: its URL, anon key and
   service_role key, from Project Settings > API. Then run the same two commands as locally:
   ```
   npx tsx --env-file=.env.production scripts/seed.ts
   npx tsx --env-file=.env.production scripts/create-editor.ts you@example.org 'a-password' admin
   ```
   To move local media to the hosted storage bucket, use `scripts/copy-storage.ts`.
3. **Netlify.**
   - Create a site from your repository. The build settings are in `netlify.toml`.
   - Set the same environment variables as `.env`: the Supabase URL and keys, plus the optional
     Compose, SMTP and ticket payment (Stripe or Square) ones.
   - Add your domain.
   - Selling paid tickets: add the payment provider's webhook (`/api/tickets/webhook/stripe` or
     `/square`; events in the docs' Tickets page).

   Compose runs long jobs in the background function `netlify/functions/compose-background.mts`,
   which Netlify deploys with the site.
4. **Invite editors** from `/admin/users/`.

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
npx tsx --env-file=.env scripts/publishing-e2e.ts   # drafts, preview, publish (needs LOCAL_ADMIN_* in .env)
```
