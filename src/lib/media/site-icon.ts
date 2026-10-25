// The site icon (Settings > Social): square PNGs made from a library image, for browser tabs (32),
// home screens (180 for iOS, 192 and 512 for Android) and the site's own header (192). Stored in the
// store's media folder under site-icon/, named by the image and size; the page head links them.
import type { Db } from '../db/query';
import { MediaStore } from './process';
import { focalRect } from './engine';
import { mediaUrl, versioned } from './image';
import type { Media } from '../types';

export const ICON_SIZES = [32, 180, 192, 270, 512] as const;

/** The icons' URLs by size, made from media `id` (cropped square around its focal point). */
export async function makeSiteIcons(db: Db, store: MediaStore, id: number): Promise<Record<string, string>> {
  const { data: m, error } = await db.from('media').select('*').eq('id', id).single();
  if (error || !m) throw new Error('That image is no longer in the library.');
  if (!String(m.mime_type).startsWith('image/')) throw new Error('Choose an image for the site icon.');
  const media = m as Media;
  // Orientation applied first, so the square is cut from the image as it is seen.
  const source = await store.engine.convert(await store.get(media.sizes?.original_image?.path ?? media.path), { format: 'image/png' });
  const { width: W, height: H } = await store.engine.info(source);
  if (!W || !H) throw new Error('That image has no size.');
  // The largest square around the focal point (the centre when none is set).
  const square = focalRect(W, H, 1, 1, media.focal_point);
  const stamp = new Date().toISOString();
  const icons: Record<string, string> = {};
  for (const size of ICON_SIZES) {
    const path = `site-icon/${id}-${size}.png`;
    await store.put(path, await store.engine.convert(source, { format: 'image/png', trim: square, width: size, height: size }), 'image/png');
    icons[String(size)] = versioned({ processed_at: stamp }, mediaUrl(path));
  }
  return icons;
}
