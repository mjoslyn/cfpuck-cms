// The Featured image block's height: a preset, Auto (the image's own height) or a custom CSS length.
// In a collection's cards a featured image with no height, ratio or fit of its own gets the card
// height, so the cards in a row line up. Safe in the browser.

type Attrs = Record<string, any>;

/** Preset heights, stored as CSS lengths. */
export const IMAGE_HEIGHTS: [string, string][] = [
  ['160px', 'Small'],
  ['240px', 'Medium'],
  ['320px', 'Large'],
  ['420px', 'Extra large'],
];

/** The height of a featured image in a collection's card when the block sets none. */
export const CARD_IMAGE_HEIGHT = '240px';

/** The height a Featured image block renders at, or undefined for the image's own. */
export function entryImageHeight(a: Attrs, inCard?: boolean): string | undefined {
  if (a.height === 'auto') return undefined;
  if (a.height) return String(a.height);
  const ratio = a.aspectRatio && a.aspectRatio !== 'auto';
  // A ratio, a fit (which fills the card's space) or a cover image size themselves.
  if (inCard && !ratio && !a.scale && !a.cover) return CARD_IMAGE_HEIGHT;
  return undefined;
}

/** The picker's choice for a stored height: '' (default), 'auto', a preset, or 'custom'. */
export function heightChoice(height: unknown): string {
  if (height === undefined || height === null || height === '') return '';
  if (height === 'auto') return 'auto';
  return IMAGE_HEIGHTS.some(([v]) => v === height) ? String(height) : 'custom';
}
