---
title: Editor and roles
description: The Puck page editor, drafts, preview, the accessibility check and user roles.
sidebar:
  order: 1
---

The admin is at `/admin/`. Accounts and sessions are the site's own (`src/lib/auth`, with Better
Auth), in its database.

## Roles

`profiles.role` is one of:

| Role | Access |
| --- | --- |
| `editor` | Content, templates, media, forms and Compose |
| `admin` | Everything editors have, plus site settings, redirects and users |
| `viewer` | No access |

Admin-only pages are listed in `ADMIN_ONLY` (`src/middleware.ts`); settings writes are admin-only in
the site's policies (`src/lib/db/policies.ts`). Admins manage users at `/admin/users/`: roles and invitations, with **Resend invitation** for anyone invited who hasn't set a password yet, and **Delete** (not your own account; what they made stays).
Editors set their password at `/admin/set-password/`, where invitations (7 days) and password links
(Forgot password on the sign-in page; an hour) land; setting it signs them in and signs the account
out everywhere else. After 10 wrong passwords for an address (or 30 from one visitor) in 15 minutes,
sign-in asks them to wait; password links go out at most 3 an hour per address.

## Admin colors and logo

**Settings > Admin** sets the admin's colors for everyone who signs in: accent, text, menu bar and
background (`settings.site.admin_theme`, `src/lib/admin-theme.ts`), and a logo for the menu bar. The
logo replaces the site name there, or sits beside it with **Show the site name beside it** (on phones
only the logo shows); it is shown up to 32px tall, so pick one that reads on the menu bar's color. The
settings API stores its media id and makes its URL from the media row. Colors and logo change on the
screen as they are picked; Save keeps them. The admin's styles use only role tokens (`--color-admin-*` in
`src/styles/tailwind.css`, as Tailwind colors such as `text-admin-muted` and `bg-admin-accent`), and
every admin page writes the saved colors over them (`AdminTheme.astro`), with the shades made from
them: a darker accent, a soft background, and the menu bar's text, dark on a light bar. Puck's own
blue scale is made from the accent (`src/styles/admin.css`). The accent and text carry white text, so
the screen warns when white on them would be hard to read. The admin uses the system font. Admin
colors and logo are part of the site settings, so a settings sync copies them (sync Files too, or
the logo's image is missing on the other copy).

## The page editor

`src/puck/Editor.tsx` renders blocks through the same string renderer as the site, inside Puck
(`BlockView.tsx` parses the HTML to React; slots become the block's inner wrapper element). What you
see while editing is the site's own markup.

The left rail has **Blocks** (and **Patterns**), **Outline** and an **accessibility check**. Blocks
with `types` are offered only on those entry types. A **Compose** panel docks beside the canvas
([Compose](../compose/)).

## Saving and publishing

- **Save draft** keeps changes to a published page aside (`entry_drafts`) while the live page stays
  unchanged. Unpublished pages save in place as drafts.
- **Publish** / **Publish changes** makes them live.
- **Discard changes** and **Unpublish** are in the header (`PUT /api/admin/entries/:id` with
  `action`).
- **Preview** opens `/admin/preview/<id>/` with the editor's current state (POST) or the saved draft
  (GET), rendered like the site with a preview bar and noindex.
- If someone else saved the page (or template) since you opened it, your save is refused and the
  editor asks whether to save over their version; cancel and reload to see theirs first.
- **Autosave**: a page's content and settings save as a draft 3 seconds after the last edit (at most
  30 seconds after the first unsaved one), as Save draft does, so a published page's live version
  stays as it is. Autosaves don't clear the page cache, and a placeholder address stays one until a
  manual save. If someone else saved meanwhile, autosave stops and the next manual save asks.
  Templates and layout mode don't autosave: their changes apply to every page using them.
- **Revisions** (left rail): the page's saved versions, to preview or restore. Each manual save
  (Save draft, Publish, Unpublish) is a **checkpoint**; autosaves between them keep one version per
  ten minutes of editing (`src/lib/admin/revisions.ts`). **Checkpoints only** hides the autosaves.

A published entry whose address changes gets a redirect from the old one automatically.

## Accessibility check

`A11yPanel.tsx` lists problems on the page. Those a person has to judge (warnings, and text over an
image, whose contrast can't be measured) can be marked as checked with a note. The marks live in the
document's root props (`a11y`), save on their own as they are made (`PUT /api/admin/a11y`; not an
unsaved edit), and lapse when the text or image they were about changes.

## Editor bar on the site

Pages are cached at the CDN, so the editor bar signed-in editors see on the public site is added in
the browser (`public/assets/js/editor-bar.js`, `/api/admin/me`).
