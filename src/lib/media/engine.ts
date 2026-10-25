// Image work for the media library, Compose and the site icon (server only), behind one small interface:
// read an image's size and re-encode it, optionally cut to a rectangle (`trim`) and resized. In the
// Worker that is Cloudflare Images (the IMAGES binding); scripts in Node pass their own engine (sharp,
// scripts/lib/sharp-engine.ts). Crops are computed here as a rectangle, so every engine cuts the same
// pixels. Orientation from EXIF is applied before anything else.
import { bindings, type ImagesBinding } from '../platform';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Convert {
  /** The output type (image/jpeg, image/png, image/webp, image/avif). */
  format: string;
  /** The part of the image to keep, in its own pixels, before resizing. */
  trim?: Rect;
  /** Resize to exactly this (`fill`, the default) or to fit inside it (`inside`, never larger). */
  width?: number;
  height?: number;
  fit?: 'fill' | 'inside';
  /** Fills transparency for types without it (JPEG). */
  background?: string;
}

export interface ImageInfo {
  width: number;
  height: number;
  /** Several frames (animated GIF, WebP, PNG). */
  animated: boolean;
}

export interface ImageEngine {
  info(input: Uint8Array): Promise<ImageInfo>;
  convert(input: Uint8Array, out: Convert): Promise<Uint8Array>;
}

/** Each type's encoding: the qualities the library has always used. */
export const QUALITY: Record<string, number | undefined> = { 'image/jpeg': 82, 'image/webp': 80, 'image/avif': 50 };

/** Whether an image has several frames, from its bytes (WebP's ANIM chunk, PNG's acTL, GIF's frames). */
export function isAnimated(b: Uint8Array): boolean {
  const ascii = (at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
  const has = (s: string, limit = b.length) => {
    outer: for (let i = 0; i < Math.min(b.length, limit) - s.length; i++) {
      for (let j = 0; j < s.length; j++) if (b[i + j] !== s.charCodeAt(j)) continue outer;
      return true;
    }
    return false;
  };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return has('ANIM', 4096);
  if (b[0] === 0x89 && ascii(1, 'PNG')) return has('acTL', 65536);
  if (ascii(0, 'GIF8')) {
    // More than one image descriptor after the header: count graphic control extensions.
    let frames = 0;
    for (let i = 0; i < b.length - 1; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9 && ++frames > 1) return true;
  }
  return false;
}

const stream = (b: Uint8Array) => new Blob([b as Uint8Array<ArrayBuffer>]).stream();

/** Cloudflare Images, through the Worker's binding. */
export function imagesEngine(images: ImagesBinding): ImageEngine {
  return {
    async info(input) {
      const i = await images.info(stream(input));
      return { width: i.width ?? 0, height: i.height ?? 0, animated: isAnimated(input) };
    },
    async convert(input, out) {
      let t = images.input(stream(input));
      if (out.trim) {
        // Cut to the rectangle first, by the pixels each side loses.
        const info = await images.info(stream(input));
        const { left, top, width, height } = out.trim;
        t = t.transform({ trim: { left, top, right: (info.width ?? 0) - left - width, bottom: (info.height ?? 0) - top - height } });
      }
      if (out.width || out.height) t = t.transform({ width: out.width, height: out.height, fit: out.fit === 'inside' ? 'scale-down' : 'cover', ...(out.background ? { background: out.background } : {}) });
      else if (out.background) t = t.transform({ background: out.background });
      const res = await t.output({ format: out.format, quality: QUALITY[out.format] });
      return new Uint8Array(await res.response().arrayBuffer());
    },
  };
}

/** The engine for this place: the Worker's Images binding. */
export function imageEngine(): ImageEngine {
  const images = bindings()?.IMAGES;
  if (!images) throw new Error('No image engine here (the IMAGES binding)');
  return imagesEngine(images);
}

/**
 * The rectangle that fills w x h from a W x H image, around the focal point (default: the centre),
 * as large as the image allows: what a crop to that shape keeps.
 */
export function focalRect(W: number, H: number, w: number, h: number, focal?: { x: number; y: number } | null): Rect {
  const scale = Math.max(w / W, h / H);
  const cw = Math.min(W, Math.round(w / scale));
  const ch = Math.min(H, Math.round(h / scale));
  const f = focal ?? { x: 0.5, y: 0.5 };
  const left = Math.min(Math.max(0, Math.round(f.x * W - cw / 2)), W - cw);
  const top = Math.min(Math.max(0, Math.round(f.y * H - ch / 2)), H - ch);
  return { left, top, width: cw, height: ch };
}
