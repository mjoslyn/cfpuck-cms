// The image engine for scripts in Node (src/lib/media/engine.ts), with sharp: the Worker uses Cloudflare
// Images. The same rectangles and qualities, so both cut and encode the same way.
import sharp from 'sharp';
import { QUALITY, isAnimated, type ImageEngine } from '../../src/lib/media/engine';

export function sharpEngine(): ImageEngine {
  return {
    async info(input) {
      const m = await sharp(input, { animated: true }).metadata();
      return { width: m.width ?? 0, height: m.pageHeight ?? m.height ?? 0, animated: (m.pages ?? 1) > 1 || isAnimated(input) };
    },
    async convert(input, out) {
      let img = sharp(input).rotate();
      if (out.trim) img = img.extract(out.trim);
      if (out.width || out.height) img = img.resize(out.width ?? null, out.height ?? null, out.fit === 'inside' ? { fit: 'inside', withoutEnlargement: true } : { fit: 'fill' });
      if (out.background) img = img.flatten({ background: out.background });
      const q = QUALITY[out.format];
      switch (out.format) {
        case 'image/png': return img.png({ compressionLevel: 9 }).toBuffer();
        case 'image/webp': return img.webp({ quality: q }).toBuffer();
        case 'image/avif': return img.avif({ quality: q, effort: 4 }).toBuffer();
        default: return img.jpeg({ quality: q, mozjpeg: true }).toBuffer();
      }
    },
  };
}
