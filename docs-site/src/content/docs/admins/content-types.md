---
title: Kinds of content and taxonomies
description: "Adding your own kinds of content, marking content featured, and adding your own ways to sort it."
sidebar:
  order: 4
---

## Adding a kind of content

Besides pages and posts, a site can keep other kinds of content, such as recipes, products or staff.
Admins add them under **Settings**, **Types**:

1. Click **Add a type**.
2. Give it a name (Recipes) and a name for one of them (Recipe).
3. Choose whether each has a page, or is data only (kept to show elsewhere, like venues).
4. For pages, type the address they start with (`recipes` puts Plum cake at `/recipes/plum-cake/`), and
   if you like a listing page that shows them all (`cookbook`).
5. Under **Details each one keeps**, click **Add a detail** for each thing to keep, such as Serves (a
   number) or Course (a choice from a list, one choice a line).
6. Click **Add type**. It now has its own list under **Content**.

Kinds of content marked **Defined in the site's code** were set up when the site was built. Click
**View** to see them; they can only be changed by whoever builds the site.

The same section sets which layout (template) each kind of content and its listing page use, and can turn
a listing page off.

## Featured content

Under **Settings**, **Types**, **Featured**, tick the kinds of content that can be marked featured, then
**Save settings**. Each one then has a **Featured** switch in its settings, and editors can show featured
content only in a Collection block (see [Featured content](/editors/pages-and-posts/#featured-content)).

## Your own ways to sort content

Admins can add a taxonomy of their own, such as Colors or Regions, and choose which types of content
use it.

1. Click **Content**, then **Taxonomies**, then **Add a taxonomy**.
2. Give it a name (Colors) and a name for one of them (Color).
3. To give each term a page listing its content, type an address, such as `colors`. Red would then be
   at `/colors/red/`. Leave it empty for no pages.
4. Tick **A flat list, like tags** if its terms never sit under each other.
5. Under **Used on**, tick each type that uses it, then click **Add taxonomy**.

Add its terms on its tab. Each page of a ticked type then has a picker for them in its right-hand
panel. To change the name, address or types later, open the taxonomy's tab and click its settings.
The same place adds more types to the site's own taxonomies, such as Category; the types the site
was built with stay ticked.
