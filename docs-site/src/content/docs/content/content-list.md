---
title: Content list
description: Tabs, bulk actions and duplicating entries.
sidebar:
  order: 6
---

The admin content list has **All**, **Published**, **Drafts** and **Trash** tabs, a tab per type,
and bulk actions on the checked rows (`/api/admin/entries/bulk`).

## Bulk actions

| Action | Effect |
| --- | --- |
| Publish | A placeholder address gets one from the title; untitled entries are skipped |
| Move to drafts | Unpublishes |
| Move to trash | Not the home page |
| Restore | In the trash: back as drafts |
| Delete permanently | In the trash |
| Add a term, Remove a term | Changes the entries' terms at once: the type's taxonomies, tags, and any taxonomy its entries use. A tag also goes into unpublished changes kept aside |

## Duplicate

**Duplicate** (list rows and the editor header; `src/lib/admin/duplicate.ts`) makes a draft copy (from
the page's unpublished changes, when it has some)
titled "(copy)" with its own address: content with any unpublished changes, fields, tags and other
terms, template, featured image and event dates.

Templates, parts and patterns duplicate from the templates list (`<slug>-copy`).

## Make a page from a template

**Make a page** (the templates list and a template's editor header; `src/admin/MakePage.tsx`) asks for a
title and a type with pages, then POSTs `action=make-page` to `/api/admin/templates`
(`entryFromTemplate`, `src/lib/admin/duplicate.ts`): a new draft whose content is a copy of the
template's, part's or pattern's blocks under new ids, and opens it in the editor. Template parts (the
header, the footer) and Page content blocks are left out, since the entry's own template supplies
them, unless **Keep the header, footer and Page content blocks** is ticked.

## Records

Record types (`record: true`, such as venues) are data only: `/admin/edit/<id>/` shows a plain form
(`src/puck/RecordEditor.tsx`) with the entries that use them. An `entry` field picks one: search,
clear, or add a new one inline (`EntryField` in `src/puck/entry-fields.tsx`).

`POST /api/admin/entries` creates entries: a form post from the list makes an untitled draft; JSON
from pickers makes a titled one and returns its id.
