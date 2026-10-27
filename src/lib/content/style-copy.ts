// Copy styles / Paste styles (the end of every block's settings): a block's look, taken to another block.
// Any block takes the shared style settings; a block of the same type also takes its look settings
// (layout, overlay, size...). Content (text, images, links, what a block lists) is never copied. Safe in
// the browser.

type Attrs = Record<string, unknown>;

/** Style settings every block has the same way: colours, spacing, type, borders, width, classes, form style. */
export const SHARED_STYLE = ['style', 'width', 'className', 'formStyle'] as const;

/** Look settings that mean the same within one block type. */
export const LOOK = [
  'align',
  'justify',
  'gap',
  'itemGap',
  'verticalAlign',
  'variant',
  'size',
  'height',
  'minHeight',
  'aspectRatio',
  'ratio',
  'scale',
  'overlay',
  'overlayFrom',
  'overlayStyle',
  'dim',
  'shade',
  'columns',
  'display',
  'mediaWidth',
  'mediaPosition',
  'position',
  'stack',
  'unstacked',
  'vertical',
  'widthPct',
  'wrap',
  'dropCap',
] as const;

export interface CopiedStyle {
  /** The block type it came from (its look settings apply only to the same type). */
  type: string;
  attrs: Attrs;
}

const keysFor = (sameType: boolean): readonly string[] => (sameType ? [...SHARED_STYLE, ...LOOK] : SHARED_STYLE);

/** A block's styles, to paste elsewhere. */
export function copyStyle(type: string, attrs: Attrs | undefined): CopiedStyle {
  const a = attrs ?? {};
  const picked: Attrs = {};
  for (const k of keysFor(true)) if (a[k] !== undefined) picked[k] = structuredClone(a[k]);
  return { type, attrs: picked };
}

/**
 * A block's attributes with copied styles in place of its own: each style setting the copy covers is
 * set to the copy's value, or cleared when the copy has none, so the block looks like the one copied.
 */
export function pasteStyle(type: string, attrs: Attrs | undefined, copied: CopiedStyle): Attrs {
  const out: Attrs = { ...(attrs ?? {}) };
  for (const k of keysFor(type === copied.type)) {
    if (copied.attrs[k] === undefined) delete out[k];
    else out[k] = structuredClone(copied.attrs[k]);
  }
  return out;
}

/** Whether a block takes pasted styles: not inside a linked pattern, whose styles are the pattern's. */
export const takesStyle = (type: string, attrs: Attrs | undefined) => !(attrs?.__src || (type === 'pattern' && attrs?.linked));
