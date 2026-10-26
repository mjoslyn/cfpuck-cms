// Image processing for the media library: responsive sizes (hard crops keep the focal point in view)
// and WebP/AVIF copies of every size, stored next to the originals in the store's `media/` folder.
// Server-only: the work is an image engine's (src/lib/media/engine.ts, Cloudflare Images in the Worker).
import type { Db } from '../db/query';
import type { Media, MediaSize } from '../types';
import { focalFor } from './focal';
import { focalRect, imageEngine, type ImageEngine } from './engine';

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

/** An SVG's size: its width and height in pixels, else its viewBox's. */
export function svgSize(head: string): { width: number; height: number } | null {
  const tag = head.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;
  const attr = (n: string) => tag.match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
  const px = (v?: string) => (v && /^\s*[\d.]+\s*(px)?\s*$/.test(v) ? Math.round(parseFloat(v)) : 0);
  const [width, height] = [px(attr('width')), px(attr('height'))];
  if (width && height) return { width, height };
  const box = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  return box?.length === 4 && box[2] > 0 && box[3] > 0 ? { width: Math.round(box[2]), height: Math.round(box[3]) } : null;
}

/** Dimensions of a size: fit inside the box, never upscale. */
function fitDims(W: number, H: number, bw: number, bh: number): [number, number] | null {
  const ratio = Math.min(bw ? bw / W : Infinity, bh ? bh / H : Infinity);
  if (ratio >= 1) return null;
  return [Math.round(W * ratio), Math.round(H * ratio)];
}

/** A put onto a file already stored, by a store that keeps stored files (`keep`). */
export class PathTaken extends Error {}

export class MediaStore {
  /** With `keep` (a new upload's files), a put never writes over a stored file: it throws PathTaken. */
  constructor(private db: Db, private engineOf: () => ImageEngine = imageEngine, private keep = false) {}

  get engine(): ImageEngine {
    return this.engineOf();
  }

  async put(path: string, body: Uint8Array, mime: string) {
    const { error } = await this.db.storage.from('media').upload(path, body, { contentType: mime, upsert: !this.keep, cacheControl: '31536000' });
    if (error && this.keep && error.statusCode === '409') throw new PathTaken(`${path} is already stored`);
    if (error) throw new Error(`${path}: ${error.message}`);
  }

  async get(path: string): Promise<Uint8Array> {
    const { data, error } = await this.db.storage.from('media').download(path);
    if (error || !data) throw new Error(`${path}: ${error?.message ?? 'not found'}`);
    return new Uint8Array(await data.arrayBuffer());
  }

  /** WebP and AVIF copies of one file. */
  async variants(path: string, body: Uint8Array): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const mime of ['image/avif', 'image/webp']) {
      const p = `${stem(path)}.${ext(mime)}`;
      await this.put(p, await this.engine.convert(body, { format: mime }), mime);
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
export async function processUpload(store: MediaStore, path: string, input: Uint8Array, mime: string, focal?: Focal | null): Promise<Processed> {
  const engine = store.engine;
  // SVGs and GIFs are kept as uploaded, and so are animated images (WebP, APNG): resizing keeps one frame.
  if (mime === 'image/svg+xml' || mime === 'image/gif') {
    await store.put(path, input, mime);
    const info = mime === 'image/gif' ? await engine.info(input).catch(() => null) : svgSize(new TextDecoder().decode(input.slice(0, 4096)));
    return { path, mime_type: mime, width: info?.width ?? 0, height: info?.height ?? 0, sizes: {}, formats: {} };
  }
  const first = await engine.info(input);
  if (first.animated) {
    await store.put(path, input, mime);
    return { path, mime_type: mime, width: first.width, height: first.height, sizes: {}, formats: {} };
  }
  let type = TO_JPEG.has(mime) ? 'image/jpeg' : mime;
  if (type !== mime) path = `${stem(path)}.jpg`;
  // Orientation applied (and other types made JPEG) once, so every size starts from the same pixels.
  let body = await engine.convert(input, { format: type });
  const meta = await engine.info(body);
  let W = meta.width;
  let H = meta.height;
  const sizes: Processed['sizes'] = {};

  if (!W || !H) {
    await store.put(path, input, mime);
    return { path, mime_type: mime, width: W, height: H, sizes, formats: {} };
  }

  if (Math.max(W, H) > BIG_IMAGE) {
    // Keep the original, serve a "-scaled" copy as the full size.
    await store.put(path, body, type);
    sizes.original_image = { path, width: W, height: H, mime_type: type };
    const [w, h] = fitDims(W, H, BIG_IMAGE, BIG_IMAGE)!;
    path = `${stem(path)}-scaled.${ext(type)}`;
    body = await engine.convert(body, { format: type, width: w, height: h });
    W = w;
    H = h;
  }
  await store.put(path, body, type);

  for (const s of SIZES) {
    const dims = s.crop ? (W > s.width || H > s.height ? ([Math.min(s.width, W), Math.min(s.height, H)] as [number, number]) : null) : fitDims(W, H, s.width, s.height);
    if (!dims) continue;
    const [w, h] = dims;
    const p = `${stem(path).replace(/-scaled$/, '')}-${w}x${h}.${ext(type)}`;
    const buf = await engine.convert(body, { format: type, width: w, height: h, ...(s.crop ? { trim: focalRect(W, H, w, h, focal) } : {}) });
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
    let buf: Uint8Array;
    if (opts.recrop && s.width && s.height && isCrop(m, s)) {
      buf = await store.engine.convert(original, { format: m.mime_type, width: s.width, height: s.height, trim: focalRect(m.width!, m.height!, s.width, s.height, focalFor(m, s.width / s.height)) });
      await store.put(s.path, buf, m.mime_type);
    } else {
      buf = await store.get(s.path).catch(() => new Uint8Array(0));
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
