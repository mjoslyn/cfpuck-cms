// What the media library's alt text Generate works from (safe in the browser; the call is describe.ts).
import type { Media } from '../types';

export const ALT_MAX = 150;

/** Whether Claude can look at it: raster images only (not SVG, video or documents). */
export const describable = (m: Pick<Media, 'mime_type'>) => /^image\/(jpeg|png|gif|webp|avif)$/.test(m.mime_type ?? '');

/** What is known about the image besides its pixels, for names and places Claude can't see. */
export function altContext(m: Pick<Media, 'path' | 'title' | 'caption' | 'alt'>): string {
  const lines = [`File name: ${m.path.split('/').pop()}`];
  if (m.title) lines.push(`Title: ${m.title}`);
  if (m.caption) lines.push(`Caption: ${m.caption}`);
  if (m.alt) lines.push(`Its alt text now (improve on it): ${m.alt}`);
  return lines.join('\n');
}
