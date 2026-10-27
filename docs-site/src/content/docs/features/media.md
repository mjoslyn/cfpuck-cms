---
title: Media
description: Uploads, standard sizes, focal points and modern image formats.
sidebar:
  order: 5
---

## Uploads

Uploads (`/api/admin/media`) are processed by `src/lib/media/process.ts` with Cloudflare Images (the
Worker's `IMAGES` binding; locally Miniflare's, which centres crops):

- Images over 2560px get a `-scaled` copy, used as the full size.
- The standard sizes are generated, hard crops centred on the focal point.
- Every file gets AVIF and WebP copies next to it.
- An SVG is stored as uploaded. It can carry script and `/media/` is served from the site's own
  address, so every `/media/` answer carries `Content-Security-Policy: sandbox` and
  `X-Content-Type-Options: nosniff`: a file opened on its own can't run script.

## Alt text

The media library's detail panel has **Generate** beside an image's alt text
(`POST /api/admin/media/describe`, `src/lib/media/describe.ts`): Claude (`ANTHROPIC_SEO_MODEL`, the
quick model the SEO Generate uses) looks at the image, with its file name, title, caption and any
current alt text, and writes one plain sentence into the form. Nothing is saved until Save. It is
offered for raster images (JPEG, PNG, GIF, WebP, AVIF), not SVGs or videos, and needs
`ANTHROPIC_API_KEY`.

## Focal points

`media.focal_point` (`{ x, y }` in 0..1) is set in the media library, with optional overrides per crop
shape (`media.crop_focals`: square, 16:9, 4:3, 3:4; `src/lib/media/focal.ts`). Changing them
re-crops the cropped sizes. Wherever an image is cropped to a ratio, the point for the nearest shape
becomes its `object-position`. The library shows each shape's ratio (1:1, 16:9, 4:3, 3:4) and the
smallest image that fills it sharply (`SHAPES[].best`: 1000 × 1000, 1600 × 900, 1200 × 900, 900 × 1200),
and marks a crop that comes out smaller than that (`smallFor`).

## A different image for a crop

Some photos don't crop well to every shape: a tall portrait makes a poor wide banner. Under each crop
preview in the media library, **Use another image** picks a different image from the library for that
shape. Wherever the image is shown cropped to that shape (a block with that aspect ratio, a card, the
square thumbnail size), the other image shows instead, with its own focal point; **Remove** goes back to
the image itself. With that shape chosen above the image, the panel shows the other image: clicking it
sets its focal point for this crop, saved with Save. That point applies only where it stands in for this
image; the other image's own focal points are untouched. Shapes are matched within 15%, so 16:10 counts as wide; crops that aren't one of the four shapes
(3:1, say, or a height with no ratio) keep the image itself.

## Markup

Images render as `<picture>` with AVIF and WebP sources (`src/lib/media/image.ts`).
`src/lib/media/modernize.ts` does the same for plain `/media/` images and inline backgrounds in the
final HTML.

## Images are never deleted

The CMS never deletes or overwrites a stored image. The library has no delete; a sync restore or snapshot
restore that removes a file's library row leaves its images in storage; and an upload takes a name that
no library row or stored file already starts with, so it can't overwrite images kept that way. Re-crops
rewrite only the cropped sizes, which can be made again from the original. Backups hold library rows,
not images (see [Sync](../sync/#backups-and-snapshots)).

## Existing media

`scripts/media-formats.ts` backfills the AVIF and WebP copies; `processed_at` marks the files done.

```sh
npx tsx --env-file=.env scripts/media-formats.ts
```
