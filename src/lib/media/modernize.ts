// Page-level pass: images that reference /media/ files directly (HTML blocks, theme sections, inline
// backgrounds) get their AVIF/WebP copies too. Images rendered from the media library already carry
// <picture> sources and are left alone.
import type { Db } from '../db/query';
import { UPLOADS_BASE } from './image';
import { safeDecode } from '../url';

type Variants = Record<string, string>;

/** Media rows a file path may belong to: the file itself, or the original a size was made from. */
function candidates(path: string): string[] {
  const out = new Set([path]);
  const m = path.match(/^(.*?)(?:-\d+x\d+)?(-scaled)?(\.[a-z0-9]+)$/i);
  if (m) {
    out.add(`${m[1]}${m[3]}`);
    out.add(`${m[1]}-scaled${m[3]}`);
  }
  return [...out];
}

const pathOf = (url: string) => safeDecode(url.split(/[?#]/)[0].slice(UPLOADS_BASE.length));

export async function modernizeImages(html: string, db: Db): Promise<string> {
  if (!html.includes(UPLOADS_BASE)) return html;
  // Leave existing <picture> elements untouched.
  const parts = html.split(/(<picture>[\s\S]*?<\/picture>)/);
  const urls = new Set<string>();
  const imgRe = /<img\b[^>]*>/g;
  const bgRe = /background-image:\s*url\((['"]?)(\/media\/[^'")]+)\1\)/g;
  parts.forEach((p, i) => {
    if (i % 2) return;
    for (const tag of p.match(imgRe) ?? []) {
      for (const m of tag.matchAll(/(?:src|srcset)="([^"]+)"/g)) for (const c of m[1].split(',')) {
        const u = c.trim().split(/\s+/)[0];
        if (u.startsWith(UPLOADS_BASE)) urls.add(u);
      }
    }
    for (const m of p.matchAll(bgRe)) urls.add(m[2]);
  });
  if (!urls.size) return html;

  const paths = [...urls].map(pathOf);
  const { data } = await db.from('media').select('path, formats, sizes').in('path', [...new Set(paths.flatMap(candidates))]);
  const variants = new Map<string, Variants>();
  for (const m of data ?? []) {
    if (m.formats && Object.keys(m.formats).length) variants.set(m.path, m.formats);
    for (const s of Object.values((m.sizes ?? {}) as Record<string, { path: string; formats?: Variants }>)) if (s.formats) variants.set(s.path, s.formats);
  }
  if (!variants.size) return html;
  const swap = (url: string, fmt: string) => {
    const v = variants.get(pathOf(url))?.[fmt];
    return v ? UPLOADS_BASE + v : null;
  };

  return parts
    .map((p, i) => {
      if (i % 2) return p;
      p = p.replace(imgRe, (tag) => {
        const src = tag.match(/\ssrc="([^"]+)"/)?.[1];
        if (!src?.startsWith(UPLOADS_BASE)) return tag;
        const set = tag.match(/\ssrcset="([^"]+)"/)?.[1];
        const sizes = tag.match(/\ssizes="([^"]+)"/)?.[1]?.replace(/^auto,\s*/, '');
        const sources: string[] = [];
        for (const [fmt, type] of [['avif', 'image/avif'], ['webp', 'image/webp']]) {
          let srcset: string | null;
          if (set) {
            const mapped = set.split(',').map((c) => {
              const [u, w] = c.trim().split(/\s+/);
              const v = swap(u, fmt);
              return v ? `${v}${w ? ` ${w}` : ''}` : null;
            });
            srcset = mapped.every(Boolean) ? mapped.join(', ') : null;
          } else srcset = swap(src, fmt);
          if (srcset) sources.push(`<source type="${type}" srcset="${srcset}"${sizes ? ` sizes="${sizes}"` : ''} />`);
        }
        return sources.length ? `<picture>${sources.join('')}${tag}</picture>` : tag;
      });
      // Inline backgrounds (style="..." attributes): the original declaration stays first as the fallback.
      return p.replace(/\sstyle="([^"]*)"/g, (attr, style: string) =>
        attr.replace(style, style.replace(bgRe, (decl, q, url) => {
          const set = [['avif', 'image/avif'], ['webp', 'image/webp']].map(([f, t]) => swap(url, f) && `url('${swap(url, f)}') type('${t}')`).filter(Boolean);
          return set.length ? `${decl};background-image:image-set(${[...set, `url('${url}')`].join(', ')})` : decl;
        })),
      );
    })
    .join('');
}
