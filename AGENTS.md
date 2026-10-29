@CORE.md

# Working on the core

This repository is cfpuck-cms: the CMS (everything outside `src/site/`) and an example site in
`src/site/` (Example Town). Real sites are forks with this repository as their `upstream` remote, kept
beside it (`../<site>`).
`CORE.md`, imported above, is the reference for how the core works, and every site's `AGENTS.md` imports
it too. This file is about working here.

## Keep the docs current

Update the docs in the same commit as the change, not afterwards:

- `CORE.md`: what the core does and where (features, data, APIs, blocks, settings, rules). Sites read
  it, so describe the core, never a particular site.
- `AGENTS.md` (this file): how to work on the core, its checklists and open work.
- `README.md`: setting up a new site and taking core updates.
- `docs-site/`: the documentation site (Starlight, published to GitHub Pages by
  `.github/workflows/docs.yml` when it changes on `main`). Preview with `cd docs-site && npm install && npx astro dev`.
- `docs-site/src/content/docs/guide/`: the site guide for editors and admins (a low-tech audience; the
  admin bar's **?** links to it). Change it when a screen they use changes: plain words, the labels as
  they appear on screen, steps. Its screenshots (`docs-site/src/assets/guide/`) are taken from the
  example site at 1280 by 800 with Playwright, with Astro's dev toolbar hidden.

## Where things go

- Nothing site-specific in core code: no site's types, taxonomies, URLs, names, palette names or
  classes. Core code reads a site only through `src/lib/site` (config, render and editor extensions).
  If a site needs something general (a filter, a map, a menu), build it as a core feature with
  settings, and move the site onto it.
- Sites keep their own blocks, patterns and templates where those are their design; only general
  features belong in the core.
- The example site follows the same layout as every site (`render/c/`, `lib/`, `pages/api/`,
  `styles/`, `public/`, `scripts/`, entry points at the top) and must keep working with every change.
- Styles: `src/styles/site.css` and its imports, using role tokens only (`--color-text`, `-muted`,
  `-accent`, `-dark`, `-on-dark`, `-surface`...), never a site's palette names.

### Adding a block

1. Renderer in `src/render/c/` (a string of HTML; `c-*` classes), added to `src/render/blocks/index.ts`.
2. Data it needs: a `case` in `walk()` in `src/render/prepare.ts` (load into `ctx.data`, add page
   scripts to `ctx.scripts` / `ctx.headScripts`, vendor CSS through `ctx.assets`).
3. Editor: panel in `CONTENT_PANELS` and label in `CONTENT_LABELS` (`src/puck/panels.tsx`), its
   category in `buildConfig` (`src/puck/config.tsx`); containers go in `CONTENT_CONTAINERS`.
4. Browser behaviour: a script in `public/assets/js/` that enhances the server markup (the page works
   without it).
5. Styles in `src/styles/site.css`; a section in `CORE.md`.

## Workflow

1. Change and commit here. `npm run check` (TypeScript) and `npm test` (unit tests, `tests/`) must pass;
   a fix comes with a test that fails without it.
2. Test on the example site, and for anything that real content exercises, in a site: in
   `../<site>`, `git fetch <path to this repository> main && git merge --no-commit FETCH_HEAD`,
   restart its dev server if config or dependencies changed, and test there.
3. Push cfpuck-cms (it deploys nothing), then in the site `git fetch upstream && git merge upstream/main`
   and commit; a site keeps its own `AGENTS.md`, `README.md`, `.env.example` and `wrangler.jsonc`
   when they conflict. The site's owner pushes the site, which deploys it.
4. Stored content changes and how to check changes: `CORE.md` (Changing stored content, Checking
   changes).

## Local setup

- `npm run db:migrate` (the local database; it and the local file bucket are in `.wrangler/state`) and
  `npx astro dev --background` (http://localhost:4321). A mail catcher for the e2e scripts that read
  email: `docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit`, `SMTP_URL=smtp://127.0.0.1:1025`.
- The dev server and scripts share `.wrangler/state`: the database through `node:sqlite`, files through
  wrangler's platform proxy (`closeLocalBindings()` at a script's end). Two dev servers sharing `node_modules` (a
  worktree with a symlink) share Vite's dependency cache too, and break each other's: give a second
  checkout its own install, or `rm -rf node_modules/.vite` and restart.
- `astro dev` runs the site in workerd, as a Worker (CORE.md, Hosting): code that only works in Node
  (native modules, `node:net`, `node:dns`) fails there as it would in production. Scripts run in Node.
- After merges that change dependencies, restart the dev server: stale Vite dependency caches show as
  "Outdated Optimize Dep" and islands that don't hydrate.

## Commits

Concise and factual: what changed, why, and any measurements; no editorial framing.

## Open work

- The move to Cloudflare is built (`docs/cloudflare-migration.md`); still to check on the first real
  deploy: Images' trim, the cache purge, SMTP over sockets, and a real site's move (its own tables,
  row sizes against D1's 2 MB).
- Core tests that run on the example site's content (several e2e scripts assume a site's content).
- The shop (CORE.md, Shop), on the preview branch until it is merged: phase 2 is checkout (payments
  through `src/lib/payments`, manual shipping rates and pickup, tax, discounts, orders with stock holds,
  refunds with a restock choice, order emails, orders and stock in sync and backups); phase 3 the Stock
  screen, low-stock alerts, digital downloads and a carrier API.
