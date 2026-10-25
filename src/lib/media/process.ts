// Image processing for the media library: responsive sizes (hard crops keep the focal point in view)
// and WebP/AVIF copies of every size, stored next to the originals in the `media` bucket.
// Server-only (sharp).
import sharp, { type Sharp } from 'sharp';
import type { Db } from '../db/query';
import type { Media, MediaSize } from '../types';
import { focalFor } from './focal';

export interface Focal {
  x: number;
  y: number;
}

/** The sizes every image gets. */
export const SIZES: { name: string; width: number; height: number; crop?: boolean }[] = [
  { name: 'thumbnail', width: 150, height: 150, crop: true },
  { name: 'medium', width: 300, height: 300 },
  { name: 'medium_large', width: 768, height: 0 },
  { name: 'large', width: 1024, height: 1024 },
  { name: '1536x1536', width: 1536, height: 1536 },
  { name: '2048x2048', width: 2048, height: 2048 },
];

/** Uploads larger than this on either side are stored scaled down, with the original kept aside. */
export const BIG_IMAGE = 2560;

const CONVERTIBLE = new Set(['image/jpeg', 'image/png']);
const MODERN = new Set(['image/webp', 'image/avif']);
const TO_JPEG = new Set(['image/heic', 'image/heif', 'image/tiff', 'image/bmp']);

const stem = (p: string) => p.replace(/\.[a-z0-9]+$/i, '');
const ext = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' })[mime] ?? 'jpg';

async function encode(img: Sharp, mime: string): Promise<Buffer> {
  return (await encodeRaw(img, mime)) as Buffer;
}

async function encodeRaw(img: Sharp, mime: string) {
  switch (mime) {
    case 'image/png': return img.png({ compressionLevel: 9 }).toBuffer();
    case 'image/webp': return img.webp({ quality: 80 }).toBuffer();
    case 'image/avif': return img.avif({ quality: 50, effort: 4 }).toBuffer();
    default: return img.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  }
}

/** Resize to fill w x h, cropping around the focal point (default: centre). */
function focalCrop(src: Buffer, W: number, H: number, w: number, h: number, focal?: Focal | null): Sharp {
  const scale = Math.max(w / W, h / H);
  const rw = Math.max(w, Math.round(W * scale));
  const rh = Math.max(h, Math.round(H * scale));
  const f = focal ?? { x: 0.5, y: 0.5 };
  const left = Math.min(Math.max(0, Math.round(f.x * rw - w / 2)), rw - w);
  const top = Math.min(Math.max(0, Math.round(f.y * rh - h / 2)), rh - h);
  return sharp(src).resize(rw, rh).extract({ left, top, width: w, height: h });
}

/** Dimensions of a size: fit inside the box, never upscale. */
function fitDims(W: number, H: number, bw: number, bh: number): [number, number] | null {
  const ratio = Math.min(bw ? bw / W : Infinity, bh ? bh / H : Infinity);
  if (ratio >= 1) return null;
  return [Math.round(W * ratio), Math.round(H * ratio)];
}

export class MediaStore {
  constructor(private db: Db) {}

  async put(path: string, body: Buffer, mime: string) {
    const { error } = await this.db.storage.from('media').upload(path, body, { contentType: mime, upsert: true, cacheControl: '31536000' });
    if (error) throw new Error(`${path}: ${error.message}`);
  }

  async get(path: string): Promise<Buffer> {
    const { data, error } = await this.db.storage.from('media').download(path);
    if (error || !data) throw new Error(`${path}: ${error?.message ?? 'not found'}`);
    return Buffer.from(await data.arrayBuffer());
  }

  /** WebP and AVIF copies of one file. */
  async variants(path: string, body: Buffer): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const mime of ['image/avif', 'image/webp']) {
      const p = `${stem(path)}.${ext(mime)}`;
      await this.put(p, await encode(sharp(body), mime), mime);
      out[ext(mime)] = p;
    }
    return out;
  }
}

export interface Processed {
  path: string;
  mime_type: string;
  width: number;
  height: number;
  sizes: Record<string, MediaSize & { formats?: Record<string, string> }>;
  formats: Record<string, string>;
}

/**
 * A new upload: stored at `path` (scaled down if very large), with every size and its modern copies.
 * Returns the media fields to save.
 */
export async function processUpload(store: MediaStore, path: string, input: Buffer, mime: string, focal?: Focal | null): Promise<Processed> {
  // Animated images (WebP, GIF, APNG) are kept as uploaded, like GIFs: resizing would keep one frame.
  const first = await sharp(input, { animated: true }).metadata();
  if ((first.pages ?? 1) > 1) {
    await store.put(path, input, mime);
    return { path, mime_type: mime, width: first.width ?? 0, height: first.pageHeight ?? first.height ?? 0, sizes: {}, formats: {} };
  }
  let body: Buffer = await sharp(input).rotate().toBuffer();
  let type = mime;
  if (TO_JPEG.has(mime)) {
    body = await encode(sharp(body), 'image/jpeg');
    type = 'image/jpeg';
    path = `${stem(path)}.jpg`;
  }
  const meta = await sharp(body).metadata();
  let W = meta.width ?? 0;
  let H = meta.height ?? 0;
  const sizes: Processed['sizes'] = {};

  if (type === 'image/gif' || type === 'image/svg+xml' || !W || !H) {
    await store.put(path, input, mime);
    return { path, mime_type: mime, width: W, height: H, sizes, formats: {} };
  }

  if (Math.max(W, H) > BIG_IMAGE) {
    // Keep the original, serve a "-scaled" copy as the full size.
    await store.put(path, body, type);
    sizes.original_image = { path, width: W, height: H, mime_type: type };
    const [w, h] = fitDims(W, H, BIG_IMAGE, BIG_IMAGE)!;
    path = `${stem(path)}-scaled.${ext(type)}`;
    body = await encode(sharp(body).resize(w, h), type);
    W = w;
    H = h;
  }
  await store.put(path, body, type);

  for (const s of SIZES) {
    const dims = s.crop ? (W > s.width || H > s.height ? ([Math.min(s.width, W), Math.min(s.height, H)] as [number, number]) : null) : fitDims(W, H, s.width, s.height);
    if (!dims) continue;
    const [w, h] = dims;
    const p = `${stem(path).replace(/-scaled$/, '')}-${w}x${h}.${ext(type)}`;
    const img = s.crop ? focalCrop(body, W, H, w, h, focal) : sharp(body).resize(w, h);
    const buf = await encode(img, type);
    await store.put(p, buf, type);
    sizes[s.name] = { path: p, width: w, height: h, mime_type: type, ...(CONVERTIBLE.has(type) ? { formats: await store.variants(p, buf) } : {}) };
  }
  const formats = CONVERTIBLE.has(type) ? await store.variants(path, body) : {};
  return { path, mime_type: type, width: W, height: H, sizes, formats };
}

/** Sizes whose shape differs from the image (hard crops), which depend on the focal point. */
export const isCrop = (m: Pick<Media, 'width' | 'height'>, s: MediaSize) => !!(m.width && m.height && s.width && s.height && Math.abs(s.width / s.height - m.width / m.height) > 0.02);

/**
 * Existing media (e.g. imported): add modern copies of the full size and each size
 * file. With `recrop`, hard-cropped sizes are first regenerated around the focal point.
 */
export async function addFormats(store: MediaStore, m: Media, opts: { recrop?: boolean } = {}): Promise<Pick<Processed, 'sizes' | 'formats'>> {
  if (!CONVERTIBLE.has(m.mime_type) && !MODERN.has(m.mime_type)) return { sizes: m.sizes as Processed['sizes'], formats: {} };
  const original = await store.get(m.path);
  const convertible = CONVERTIBLE.has(m.mime_type);
  const sizes: Processed['sizes'] = {};
  for (const [name, s] of Object.entries(m.sizes ?? {})) {
    if (name === 'original_image' || !s.path) {
      sizes[name] = s;
      continue;
    }
    let buf: Buffer;
    if (opts.recrop && s.width && s.height && isCrop(m, s)) {
      buf = await encode(focalCrop(original, m.width!, m.height!, s.width, s.height, focalFor(m, s.width / s.height)), m.mime_type);
      await store.put(s.path, buf, m.mime_type);
    } else {
      buf = await store.get(s.path).catch(() => Buffer.alloc(0));
      if (!buf.length) {
        sizes[name] = s;
        continue;
      }
    }
    sizes[name] = { ...s, ...(convertible ? { formats: await store.variants(s.path, buf) } : {}) };
  }
  const formats = convertible ? await store.variants(m.path, original) : {};
  return { sizes, formats };
}
