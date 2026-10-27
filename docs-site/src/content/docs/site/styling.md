---
title: Styling
description: Design tokens, role colors, editor presets, the site theme and Compose's house style.
sidebar:
  order: 3
---

## Files

- `src/site/styles/tokens.css`: design token values, the site's palette, and the role colors the
  core uses.
- `src/site/styles/theme.css`: the site's own styles.
- `src/site/presets.json`: the colors, sizes and spacing the editor offers.

`src/styles/site.css` (Tailwind, no preflight) imports the site's `tokens.css` and `theme.css`, along
with the core's `forms.css` and `events.css`. The page shell links the compiled file.

## Palette and role colors

A site names its own palette. Content and `presets.json` use those names; the core's styles never do.
They use only **role tokens**, which `tokens.css` maps onto the palette:

```css
@theme static {
  --color-night: #1c2331;
  --color-slate: #555f6d;
  --color-copper: #1f6672;
  /* ... */
}

:root {
  --color-text: var(--color-night);
  --color-muted: var(--color-slate);
  --color-accent: var(--color-copper);
  --color-accent-hover: var(--color-bark);
  --color-dark: var(--color-night);
  --color-on-dark: var(--color-white);
  --color-on-accent: var(--color-white);
  --color-surface: var(--color-white);
  --color-surface-alt: var(--color-stone);
  --color-surface-soft: var(--color-cream);
}
```

| Role | Used for |
| --- | --- |
| `--color-text` | Body text |
| `--color-muted` | Secondary text |
| `--color-accent`, `--color-accent-hover` | Links, buttons, eyebrows |
| `--color-dark`, `--color-on-dark` | Dark bands and the text on them |
| `--color-on-accent` | Text on accent fills (optional; falls back to on-dark) |
| `--color-accent-fill` | The accent as a background under text: the Hero's first button, button and search hovers, today in the calendar (optional; falls back to the accent) |
| `--color-surface`, `-surface-alt`, `-surface-soft` | Light backgrounds |

Inside dark bands, covers and heroes, `tokens.css` re-maps the palette (lighter accent and muted
colors) so accent text keeps 4.5:1 contrast. A lighter accent can be too light under white text: set
`--color-accent-fill` on `:root` to a deep enough accent and leave it out of the re-mapping, so filled
buttons keep 4.5:1 there too.

Other tokens: `--font-display`, `--font-body`, `--text-*` (sizes, `small` to `hero`) and
`--space-*` (spacing). Block props store styles as CSS that uses these tokens.

## Compose house style

Compose builds sections in a house style taken from the config's `compose`. Each option defaults to a
role token or the original house style.

| Option | Meaning |
| --- | --- |
| `bands` | Section backgrounds: `plain`, `tint`, `soft`, `dark` |
| `body` | Body text on light bands |
| `onDark` | Text on dark bands |
| `accent` | Eyebrows, the rule above headings, big numbers |
| `card` | Card backgrounds on light bands |
| `bandNames` | Older band names in saved conversations, mapped to the generic ones |
| `headingFont` | Headings, quotes and big numbers |
| `rule` | An accent rule between eyebrow and heading (default true) |
| `bodySize`, `bodyWeight`, `bodyLineHeight` | Body text |
| `bandPadding` | `{ block, inline }` padding of a band |
| `textWidth`, `wideWidth` | Content widths (default 720px and 1280px) |
| `radius`, `buttonRadius` | Corners of cards and images (6px) and buttons (2px) |
| `buttonCaps` | Button labels in spaced capitals (default true) |
