---
title: Blocks
description: The block types content is built from, and how they are stored.
sidebar:
  order: 2
---

Content is Puck data, in `entries.content` and `templates.content`: a tree of items
`{ type, props: { id, attrs, children } }`, rendered by `src/render/c/`.

Props are clean values: styles as CSS with design tokens (`var(--color-*)`, `var(--space-*)`,
`var(--text-*)`), layouts as `{ type: flow | constrained | row | stack | grid }`.

## Core blocks

| Group | Blocks |
| --- | --- |
| Layout | `section`, `columns` / `column`, `separator`, `spacer` |
| Text | `text` (paragraph), `heading`, `list` / `list-item`, `quote`, `buttons` / `button`, `html` |
| Media | `image`, `cover`, `hero`, `gallery`, `video-gallery`, `video`, `embed`, `media-text` |
| Entry fields | `entry-title`, `entry-excerpt`, `entry-date`, `entry-terms`, `entry-image`, `entry-field`, `entry-content` (Page content) |
| Collections | `collection`, `pagination`, `archive-title` (and older `collection-items`, `collection-empty`, `pagination-*` children) |
| Events | `event-date`, `event-details`, `event-schedule`, `event-calendar`, `events-calendar` |
| Site | `navigation`, `site-title`, `social-links`, `search-form`, `collection-filters`, `map` |
| Forms | `form` |
| Structure | `part`, `pattern`, `global` |

A site adds its own through `render.ts` ([Blocks and hooks](../../site/extending/)). An unknown
type renders its children.

### Notable blocks

- **`hero`**: a full-bleed image with eyebrow, title, text and two buttons. Its overlay keeps the text
  readable: **Overlay** (`overlay`: none, light, medium by default, strong) and **Darkest at**
  (`overlayFrom`: bottom by default, left, or all over).
- **`cover`**'s overlay is a colour and opacity, **Even** or a gradient **From bottom** or **From left**
  (`overlayStyle`), clearing towards the other side.
- **Focal points per screen size** (Hero, Cover, and Image when it is cropped): Desktop, Tablet and
  Phone (`focal`, `focalTablet`, `focalPhone`, set by clicking the image in the block's settings,
  `src/puck/FocalPoints.tsx`). A size without its own uses the image's focal points from the media
  library: its point for the crop's shape on that size (16:9 on desktop and 3:4 on tablets and phones
  for Hero and Cover, the block's ratio for Image), else its main point. They are written as CSS
  variables (`--focal`, `--focal-tablet`, `--focal-phone`) and the stylesheet picks one per screen
  (tablet up to 1024px wide, phone up to 599px).
- **`gallery`, `video-gallery`**: image blocks, or embed and video blocks, shown as a grid, masonry
  columns or a slider (`display`). The slider is a scroll-snap row with buttons and autoplay
  (`public/assets/js/gallery-slider.js`). Media picked in the panel arrive as `attrs.add` and become
  child blocks (`resolveGallery` in `src/puck/config.tsx`).
- **`entry-image`**: `field` picks an image field instead of the featured image, and `linkField` links
  it to a URL field (a logo linked to a member's website).
- **`entry-content`**: where a template places the entry's content. `attrs.area` names a content area
  ([Templates and types](../templates/#content-areas)).

## Classes and behaviour

Core blocks output `c-*` classes. A site's classes in content are only styling hooks for its
`theme.css`. Behaviour never keys off content class names: the core uses block settings instead
(`entry-image` `field`, `event-date` for card dates, collection `shuffle`, `query.upcoming`,
`columns`, `autoplay`).

## Formatting

Rendered output passes through `texturize` (smart quotes, dashes). Section and loop markup is followed
by `autop`, so the whitespace in those templates matters.
