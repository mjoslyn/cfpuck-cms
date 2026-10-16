---
title: Compose
description: Pages, fields and block edits written by Claude from an editor's materials.
sidebar:
  order: 2
---

Compose writes pages with Claude from the documents, images and links an editor adds. It is at
`/admin/compose/` and in the page editor as a panel docked beside the canvas (pin keeps it open).

Needs `ANTHROPIC_API_KEY`. `ANTHROPIC_MODEL` overrides the model (default `claude-sonnet-5-5`).

## Conversations

Each page has a saved conversation (`compose_sessions`). The editor adds:

- documents: PDF, Word, text, Markdown
- images and videos, uploaded to the media library or multi-selected from it
- video links (YouTube, Vimeo)
- web links

and asks for a page or changes. A new conversation can create any type with a page of its own
(`COMPOSABLE_TYPES`). Claude is told what the type is (its `describe`) and fills the fields that have
a `compose` hint from the materials, in the plan's `fields`, when the entry is created
(`src/lib/compose/entry-fields.ts`). Later it updates them with `update_fields`, which the editor
applies to its sidebar form and saves with the page.

## What Claude can do

| Tool | Effect |
| --- | --- |
| `build_page` | The complete page plan (`spec.ts`), turned into blocks in the house style by `build.ts` |
| `update_fields` | Just the changed fields |
| `edit_block` | Replaces the selected block, or its whole section |
| `search_site` | Finds the site's own entries to feature (`src/lib/compose/site.ts`) |

Or it simply replies.

Blocks built by a conversation carry its id prefix, so each update replaces only those, in place.
Hand edits are shown to Claude. With a block selected in the editor, the panel targets it.

## Materials

`src/lib/compose/materials.ts` keeps a registry with stable ids (`image-1`, `doc-1`...). PDFs go in
the private `compose` bucket, link text is fetched once (private addresses refused), and images are
re-encoded to JPEG for Claude. The whole conversation is sent with prompt caching
(`src/lib/compose/claude.ts`).

## Safety

Materials can carry instructions, so replacements are checked (`src/lib/compose/edit.ts`): known block
types, kept ids, materials resolved. Markup is cut to inline formatting and links, addresses to web,
mail, phone and site links, and raw HTML is never taken from Claude (`safe-html.ts`).

## Jobs

A build takes 30–90 seconds or more, past Netlify's request limits, so a turn runs as a job
(`src/lib/compose/job.ts`, table `compose_jobs`):

1. `POST /api/admin/compose` reads the materials, queues the turn and POSTs `{ jobId, token }` to the
   background function `netlify/functions/compose-background.mts`, which answers 202 and runs for up
   to 15 minutes. Under `astro dev` the route runs the job in-process.
2. The runner claims the job with its token and writes progress, then the result or error, to the row.
3. The panel polls `GET /api/admin/compose?job=<id>`.

A job silent for 3 minutes, or older than 16, is reported as failed. One turn runs at a time per
conversation (409 otherwise).

## House style

Compose's colors, type and shapes come from the config's `compose` ([Styling](../../site/styling/#compose-house-style)).
