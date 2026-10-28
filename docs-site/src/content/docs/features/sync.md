---
title: Sync
description: Copy content, files and settings between this site and another copy of it, either way.
sidebar:
  order: 11
---

**Settings > Sync** (admins) copies content between this site and another copy of it, such as
production and a local copy, in either direction.

## Setting it up

Give both copies the same secret, a long random value of at least 32 characters (on a deployed copy,
`npx wrangler secret put SYNC_SECRET`), and set the other copy's name and address on the copy you sync
from, then restart it:

```sh
SYNC_SECRET=<the same long random value on both copies>
SYNC_REMOTE_NAME=Production
SYNC_REMOTE_URL=https://<its address>
```

Both copies need the same version of the core: each request is signed with its route and a one-time
value, which an older copy doesn't check or send, so update both before syncing again.

The sync sends its queries and file calls to the other copy's `/api/sync/remote` and `/api/sync/files`,
signed with the secret; the other copy answers only signed requests, and only for the tables and
folders a sync uses. So it runs from the copy that has the address set: a local copy can push to and
pull from production; production can't reach a local copy. Apply the migrations on both copies.

## What can sync

| Group | Matched by | Includes |
| --- | --- | --- |
| Each content type | id | The entry, its terms (those that exist on the target) and unpublished changes |
| Each taxonomy | id | Its terms, parents first |
| Files | id | The media row and every storage object: sizes, the kept original, AVIF and WebP copies |
| Templates, parts and patterns | kind and slug | Title and content |
| Forms | id | Title, fields, notifications, active |
| Settings and menu | key | `site` and `options`, and the site icon's files |
| Redirects | old address | Target, status, note |

Copies of one site share ids, and a sync keeps them; rows added later take ids past the largest, so they
don't collide.

## Running a sync

1. Pick a direction and what to sync, and **Compare**.
2. Each group lists its new, changed and unchanged rows, and its conflicts. Conflicts are left alone:
   an id that is a different row on the target, an address another row has, or a parent or featured
   image that isn't on the target (include Files to bring images).
3. **Show differences** opens a line diff of a row: the target's version against what the sync would
   write. Untick any row you want left as it is.
4. The warning names the site being written to and how many of its rows will be overwritten. Tick it
   and sync. Rows are written in batches, with progress shown.

A sync adds and overwrites; it never deletes.

## Backups and snapshots

:::caution[Images aren't backed up]
Backups and snapshots hold the site's content as database rows. Stored images, the files of the media
library, are not backed up: a restore brings back a file's library row, not its image. Keep a copy of
the store's `media/` folder (the R2 bucket) some other way if you need one.
:::

What protects images instead: the CMS never deletes or overwrites a stored image. The media library has
no delete; a restore that removes a file's library row leaves its images in storage, so undoing the
restore finds them again; and an upload never takes a name whose files are still in storage. Images are
lost only if someone deletes them from the bucket directly.

**Settings > Backups** has a panel for this site, and one for the copy it syncs with when one is set
up. Each lists that site's backups and snapshots, newest first, to download, restore or delete.

### Sync backups

Before writing anything, a sync checks the target can take it (it isn't protected and has its
migrations; without them the sync is refused). Then, with **Save a backup first** ticked (the default),
it saves a backup on the target: every row the sync is about to overwrite, whole and as it is now, and a
list of the rows it adds. If the backup can't be saved, nothing is synced. If a row the sync means to
add now exists on the target (someone made it there since Compare), the sync stops and asks you to
compare again. As each batch is written, the rows it really added are recorded beside the backup.

### Snapshots

A snapshot is everything a sync covers on one site, as it is: entries with their terms and unpublished
changes, terms, library rows, templates, forms, settings and redirects.

- **Back up now** takes one at once.
- **Take one every day / every week** takes them on a schedule: the Worker's daily run at 07:00 UTC
  (`src/worker.ts`) on the deployed site.
- Restoring a snapshot takes one of the current state first.

### What a site keeps

Each site sets how many sync backups (10 by default) and snapshots (14) it keeps; 0 keeps all. Older ones
are deleted after each new one, and when you lower a number. These settings, and the snapshot schedule,
belong to each site: syncing or restoring settings never changes them.

### Restoring

- **A sync backup** undoes that sync on the site that holds it: the rows the sync overwrote go back to
  how they were (entries with their terms and unpublished changes), and the rows it added are deleted:
  only those it really wrote, so a sync that stopped halfway doesn't take later rows with it.
- **A snapshot** writes every row it holds back as it was. The panel first shows, per table, how many
  rows it puts back and how many were made since; those are deleted only if you tick **Also delete the
  rows made since the snapshot**.

Either way, changes made to those rows since are lost, and the current state is saved first (named
`before-restore`), so a restore can be undone with the same button. Deleting a file deletes its library
row only; its stored images stay, so undoing the restore brings the file back whole. A form that has
submissions is never deleted by a restore (its submissions would be cut loose from it), nor is a row
other rows came to depend on: an event with ticket orders or waitlists, a page with pages under it, a
term entries still use, a file entries feature. The report names what was kept.

A restore runs as a job (on the Worker's jobs queue, up to 15 minutes), so a large one isn't cut off halfway; the screen waits for it and then shows the result.

## Protecting a site

**Protect this site from syncs** (in each copy's own Settings > Sync, `settings.site.sync_protected`) makes
that copy refuse every sync into it, whichever copy starts it. Syncing settings never changes the
target's protection.
