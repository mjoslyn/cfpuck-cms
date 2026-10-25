// The site icon (Settings > Social): square PNGs made from a library image, for browser tabs (32),
// home screens (180 for iOS, 192 and 512 for Android) and the site's own header (192). Stored in the
// media bucket under site-icon/, named by the image and size; the page head links them.
import sharp from 'sharp';
import type { Db } from '../db/query';
import { MediaStore } from './process';
import { mediaUrl, versioned } from './image';
import type { Media } from '../types';

export const ICON_SIZES = [32, 180, 192, 270, 512] as const;

/** The icons' URLs by size, made from media `id` (cropped square around its focal point). */
export async function makeSiteIcons(db: Db, store: MediaStore, id: number): Promise<Record<string, string>> {
  const { data: m, error } = await db.from('media').select('*').eq('id', id).single();
  if (error || !m) throw new Error('That image is no longer in the library.');
  if (!String(m.mime_type).startsWith('image/')) throw new Error('Choose an image for the site icon.');
  const media = m as Media;
  const source = await store.get(media.sizes?.original_image?.path ?? media.path);
  const meta = await sharp(source).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error('That image has no size.');
  // The largest square around the focal point (the centre when none is set).
  const side = Math.min(W, H);
  const f = media.focal_point ?? { x: 0.5, y: 0.5 };
  const left = Math.min(Math.max(0, Math.round(f.x * W - side / 2)), W - side);
  const top = Math.min(Math.max(0, Math.round(f.y * H - side / 2)), H - side);
  const square = await sharp(source).rotate().extract({ left, top, width: side, height: side }).toBuffer();
  const stamp = new Date().toISOString();
  const icons: Record<string, string> = {};
  for (const size of ICON_SIZES) {
    const path = `site-icon/${id}-${size}.png`;
    await store.put(path, await sharp(square).resize(size, size).png({ compressionLevel: 9 }).toBuffer(), 'image/png');
    icons[String(size)] = versioned({ processed_at: stamp }, mediaUrl(path));
  }
  return icons;
}
