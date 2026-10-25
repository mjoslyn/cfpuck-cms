---
title: Blocks and hooks
description: render.ts and editor.tsx, where a site adds its own blocks, card designs and page behaviour.
sidebar:
  order: 2
---

## render.ts

`src/site/render.ts` calls `defineRender` (types in `src/lib/site/extend.ts`):

```ts
import { defineRender } from '../lib/site/extend';
import { CARDS } from './lib/content/cards';

export default defineRender({
  blocks: {},
  cards: CARDS,
});
```

| Option | Meaning |
| --- | --- |
| `blocks` | The site's own block types, by name |
| `cards` | Card designs for collections; the first is the default |
| `archiveQuery(args, ctx, tools)` | Adjusts the main query of listing pages (type archives and term pages): search, filters, order |
| `head(ctx)` | Extra `<head>` markup after the site stylesheet: web fonts, meta tags |
| `pageScripts(ctx)` | The page's footer scripts, given those the blocks added (`ctx.scripts`) |
| `redirect(url)` | Where an old URL of the site now lives (a 301), or `null`. Answered from the catch-all route |

### Blocks

```ts
blocks: {
  'member-sidebar': {
    label: 'Member details',
    category: 'site',
    types: ['member'],
    render: (b, env) => `<aside class="member-sidebar">...</aside>`,
    prepare: async (item, ctx, tools) => { /* load data onto ctx.data */ },
  },
}
```

| Field | Meaning |
| --- | --- |
| `label` | Name in the editor |
| `category` | Where it appears in the block list: `text`, `media`, `layout`, `dynamic`, `card`, `sections`, `site`, `advanced` |
| `render` | Renders the block to an HTML string. Runs on the server and inside the editor, so it is synchronous |
| `prepare` | Loads what the block needs before rendering, once per occurrence on the page |
| `types` | The entry types it reads fields from; the editor offers it only there, and in templates |

`prepare` gets helpers: `uid()` (a number unique within the page), `loadEntryMedia(ids)` (featured
images and image fields in one query) and `descendantTermIds(ids)`.

Block markup goes in `src/site/render/c/`. A site's classes in content are styling hooks for its
`theme.css`; behaviour never keys off them.

### Card designs

A card design is the item a collection repeats per entry: a tree of blocks without ids (ids are
generated per use).

```ts
export const CARDS: CardPreset[] = [
  {
    id: 'image',
    label: 'Image, title and excerpt',
    description: 'White card with the featured image on top.',
    template: [
      { type: 'section', props: { attrs: { layout: { type: 'stack' } }, children: [
        { type: 'entry-image', props: { attrs: { link: true, size: 'medium_large' } } },
        { type: 'entry-title', props: { attrs: { link: true, level: 3 } } },
      ] } },
    ],
  },
];
```

Card fields available: `entry-title`, `entry-image`, `entry-excerpt`, `entry-date`, `event-date`,
`entry-terms`, `entry-field` (any field as text, link, email, phone or image).

## editor.tsx

`src/site/editor.tsx` calls `defineEditor`:

| Option | Meaning |
| --- | --- |
| `panels` | Settings panels for the site's blocks (and any core block whose panel the site replaces): `(attrs, set) => ReactNode` |
| `settingsFields` | Site-wide options edited under Settings, stored in `settings.options` |
| `settingsTitle` | The heading they appear under |

## Endpoints, static files and migrations

- **Endpoints**: files in `src/site/pages/api/`, listed in `routes.json`, added by the `site-routes`
  integration in `astro.config.mjs`.
- **Static files**: `src/site/public/` is served at the same paths as `public/` by the `site-public`
  integration. A site file wins.
- **Content migrations**: `src/site/migrations/index.ts` exports `MIGRATIONS`, run by
  `scripts/migrate-content.ts` before the core's.
- **Database migrations**: `db/migrations/YYYYMMDDHHMMSS_site_*.sql` (D1), beside the core's.
