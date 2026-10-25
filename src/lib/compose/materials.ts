// What the editor gave the composer, kept per session so later turns can use it: documents (PDFs in the
// store's private compose/ folder; Word, text, Markdown and HTML as text), library images (sent as images),
// videos (uploaded files and YouTube/Vimeo links) and web links (fetched once, kept as text). Each gets
// a stable id ("image-1", "video-2", "link-1", "doc-1") that page plans refer to.
import type Anthropic from '@anthropic-ai/sdk';
import { parse } from 'node-html-parser';
import mammoth from 'mammoth';
import { isIP } from '../net';
import type { Db } from '../db/query';
import type { Media } from '../types';
import { downsize, mediaUrl } from '../media/image';
import { MediaStore } from '../media/process';
import { videoIframe, videoLink as parseVideoLink } from '../media/video-link';
import type { BuildMaterials, ImageMaterial, VideoMaterial } from './build';
import { privateAddress } from './private-address';

type Block = Anthropic.Messages.ContentBlockParam;


const MAX_DOC = 25 * 1024 * 1024;
const MAX_TEXT = 60_000;
const MAX_LINK_TEXT = 12_000;

/** A name's addresses (A and AAAA), over DNS-over-HTTPS: the Worker runtime has no resolver of its own. */
async function addressesOf(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  const answers = await Promise.all(['A', 'AAAA'].map(async (type) => {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
    const json = (await res.json()) as { Answer?: { type: number; data: string }[] };
    return (json.Answer ?? []).filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
  }));
  return answers.flat();
}

/**
 * A link's page, refusing private addresses at every hop. The name is checked before the fetch (a
 * Worker's requests can't reach private networks either, so a name that answers differently the
 * second time gains nothing).
 */
async function safeFetch(raw: string, accept = 'text/html,*/*;q=0.5'): Promise<Response> {
  let url = new URL(raw);
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw new Error('only http and https links');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addrs = await addressesOf(host);
    if (!addrs.length || addrs.some((a) => privateAddress(a))) throw new Error('private address');
    const res = await fetch(url, { redirect: 'manual', headers: { Accept: accept, 'User-Agent': 'Composer/1.0 (link reader)' }, signal: AbortSignal.timeout(12_000) });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) return res;
    url = new URL(next, url);
  }
  throw new Error('too many redirects');
}

/** A response body up to `max` bytes; more than that is refused without reading the rest. */
async function readBytesCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (declared > max) throw new Error(`over ${Math.round(max / 1024 / 1024)} MB`);
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error(`over ${Math.round(max / 1024 / 1024)} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function readCapped(res: Response, max = 3 * 1024 * 1024): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const collapse = (s: string) => s.replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function htmlToText(html: string): { title: string; description: string; text: string } {
  const root = parse(html);
  const title = root.querySelector('meta[property="og:title"]')?.getAttribute('content') || root.querySelector('title')?.text || '';
  const description = root.querySelector('meta[name="description"]')?.getAttribute('content') || root.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
  root.querySelectorAll('script, style, noscript, svg, nav, footer, header, form, iframe').forEach((n) => n.remove());
  const main = root.querySelector('main') ?? root.querySelector('article') ?? root.querySelector('body') ?? root;
  main.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, br, div, tr').forEach((n) => n.insertAdjacentHTML('afterend', '\n'));
  return { title: collapse(title).slice(0, 300), description: collapse(description).slice(0, 1000), text: collapse(main.text).slice(0, MAX_LINK_TEXT) };
}

/** YouTube / Vimeo link -> embed material, with its title from oEmbed when available. */
async function videoLink(url: string): Promise<Extract<VideoMaterial, { kind: 'embed' }> | null> {
  const v = parseVideoLink(url);
  if (!v) return null;
  const oembed = v.provider === 'youtube' ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}` : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
  const title = await fetch(oembed, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: any) => String(j?.title ?? ''))
    .catch(() => '');
  return { kind: 'embed', url, provider: v.provider, title, html: videoIframe(v.src, title) };
}

/**
 * A library image as base64 JPEG, at most 1568px on the long edge. Re-encoding means the declared type
 * always matches (stored files can be WebP or AVIF whatever their name says).
 */
export async function imageForClaude(store: MediaStore, m: Media): Promise<string> {
  const buf = await store.get(downsize(m, 'large').path).catch(() => store.get(m.path));
  const out = await store.engine.convert(buf, { format: 'image/jpeg', width: 1568, height: 1568, fit: 'inside', background: '#ffffff' });
  return Buffer.from(out).toString('base64');
}

export interface Registry {
  images: { ref: string; mediaId: number; src: string; alt: string; title: string; width: number | null; height: number | null }[];
  videos: ({ ref: string } & VideoMaterial)[];
  links: { ref: string; url: string; title?: string; text?: string; pdfPath?: string; error?: string }[];
  docs: { ref: string; name: string; kind: 'pdf' | 'text'; path?: string; text?: string }[];
}
export const emptyRegistry = (): Registry => ({ images: [], videos: [], links: [], docs: [] });

/** Refs added in one turn. */
export type Added = string[];

const nextRef = (prefix: string, taken: { ref: string }[]) => `${prefix}-${taken.filter((t) => t.ref.startsWith(`${prefix}-`)).length + 1}`;

/**
 * New materials for a turn: documents are stored (PDF) or reduced to text, library media is recorded,
 * links are fetched once. Returns the refs added and notes for the editor.
 */
export async function ingest(db: Db, sessionId: string, reg: Registry, input: { docs: File[]; mediaIds: number[]; links: string[] }): Promise<{ added: Added; notes: string[] }> {
  const added: Added = [];
  const notes: string[] = [];
  const service = db;

  for (const file of input.docs) {
    if (file.size > MAX_DOC) {
      notes.push(`${file.name} is over 25 MB and was skipped.`);
      continue;
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    const ref = nextRef('doc', reg.docs);
    if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
      const path = `${sessionId}/${ref}-${name.replace(/[^a-z0-9.]+/g, '-')}`;
      const { error } = await service.storage.from('compose').upload(path, buf, { contentType: 'application/pdf', upsert: true });
      if (error) {
        notes.push(`${file.name}: could not be stored (${error.message}).`);
        continue;
      }
      reg.docs.push({ ref, name: file.name, kind: 'pdf', path });
    } else if (name.endsWith('.docx')) {
      const { value } = await mammoth.extractRawText({ buffer: buf });
      reg.docs.push({ ref, name: file.name, kind: 'text', text: collapse(value).slice(0, MAX_TEXT) });
    } else if (/\.(html?|xhtml)$/.test(name) || file.type === 'text/html') {
      const t = htmlToText(buf.toString('utf8'));
      reg.docs.push({ ref, name: file.name, kind: 'text', text: `${t.title ? `${t.title}\n\n` : ''}${t.text}` });
    } else if (/\.(txt|md|markdown|csv|json)$/.test(name) || file.type.startsWith('text/')) {
      reg.docs.push({ ref, name: file.name, kind: 'text', text: buf.toString('utf8').slice(0, MAX_TEXT) });
    } else {
      notes.push(`${file.name}: unsupported document type (use PDF, Word .docx, text or Markdown).`);
      continue;
    }
    added.push(ref);
  }

  if (input.mediaIds.length) {
    const { data, error } = await db.from('media').select('*').in('id', input.mediaIds);
    if (error) throw error;
    for (const id of input.mediaIds) {
      const m = (data ?? []).find((x) => x.id === id) as Media | undefined;
      if (!m) continue;
      if (m.mime_type.startsWith('video/')) {
        if (reg.videos.some((v) => v.kind === 'file' && v.mediaId === m.id)) continue;
        const ref = nextRef('video', reg.videos);
        reg.videos.push({ ref, kind: 'file', src: mediaUrl(m.path), mediaId: m.id, title: m.title });
        added.push(ref);
      } else if (m.mime_type.startsWith('image/')) {
        if (reg.images.some((x) => x.mediaId === m.id)) continue;
        const ref = nextRef('image', reg.images);
        reg.images.push({ ref, mediaId: m.id, src: mediaUrl(m.path), alt: m.alt || '', title: m.title || '', width: m.width, height: m.height });
        added.push(ref);
      }
    }
  }

  for (const raw of input.links) {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      notes.push(`"${raw}" is not a valid link.`);
      continue;
    }
    if (reg.links.some((l) => l.url === url.href) || reg.videos.some((v) => v.kind === 'embed' && v.url === url.href)) continue;
    const v = await videoLink(url.href).catch(() => null);
    if (v) {
      const ref = nextRef('video', reg.videos);
      reg.videos.push({ ref, ...v });
      added.push(ref);
      continue;
    }
    const ref = nextRef('link', reg.links);
    try {
      const res = await safeFetch(url.href);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if ((res.headers.get('content-type') ?? '').includes('pdf')) {
        // Read no more than the limit (a link can be any size; don't hold it all to find out).
        const buf = await readBytesCapped(res, MAX_DOC);
        const path = `${sessionId}/${ref}.pdf`;
        const { error } = await service.storage.from('compose').upload(path, buf, { contentType: 'application/pdf', upsert: true });
        if (error) throw new Error(error.message);
        reg.links.push({ ref, url: url.href, pdfPath: path });
      } else {
        const t = htmlToText(await readCapped(res));
        reg.links.push({ ref, url: url.href, title: t.title, text: `${t.description ? `${t.description}\n\n` : ''}${t.text}` });
      }
    } catch (e) {
      notes.push(`Could not read ${url.href} (${(e as Error).message}); it is still offered as a link.`);
      reg.links.push({ ref, url: url.href, error: (e as Error).message });
    }
    added.push(ref);
  }
  return { added, notes };
}

/** A library image in the registry (reusing its ref if it is already there). */
export function registerImage(reg: Registry, m: Media): string {
  const known = reg.images.find((x) => x.mediaId === m.id);
  if (known) return known.ref;
  const ref = nextRef('image', reg.images);
  reg.images.push({ ref, mediaId: m.id, src: mediaUrl(m.path), alt: m.alt || '', title: m.title || '', width: m.width, height: m.height });
  return ref;
}

/** Claude input for some registry items (images re-encoded, PDFs read from storage). */
export async function blocksFor(db: Db, store: MediaStore, reg: Registry, refs: string[]): Promise<Block[]> {
  const blocks: Block[] = [];
  const pdf = async (path: string) => {
    const { data, error } = await db.storage.from('compose').download(path);
    if (error || !data) throw new Error(error?.message ?? 'missing');
    return Buffer.from(await data.arrayBuffer()).toString('base64');
  };
  for (const ref of refs) {
    const doc = reg.docs.find((d) => d.ref === ref);
    if (doc) {
      if (doc.kind === 'pdf' && doc.path) {
        try {
          blocks.push({ type: 'text', text: `${ref}: document "${doc.name}"` }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await pdf(doc.path) }, title: doc.name });
        } catch {
          blocks.push({ type: 'text', text: `${ref}: document "${doc.name}" (no longer available).` });
        }
      } else blocks.push({ type: 'text', text: `${ref}: document "${doc.name}"\n\n${doc.text ?? ''}` });
      continue;
    }
    const img = reg.images.find((x) => x.ref === ref);
    if (img) {
      const { data: m } = await db.from('media').select('*').eq('id', img.mediaId).maybeSingle();
      try {
        if (!m) throw new Error('gone');
        blocks.push({ type: 'text', text: `${ref} (${img.width ?? '?'}x${img.height ?? '?'}${img.alt ? `, alt text: "${img.alt}"` : ''}):` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await imageForClaude(store, m as Media) } });
      } catch {
        blocks.push({ type: 'text', text: `${ref}: image "${img.title || img.src}" (preview unavailable).` });
      }
      continue;
    }
    const vid = reg.videos.find((v) => v.ref === ref);
    if (vid) {
      blocks.push({ type: 'text', text: vid.kind === 'embed' ? `${ref}: ${vid.provider} video${vid.title ? ` "${vid.title}"` : ''} (${vid.url}).` : `${ref}: uploaded video file "${vid.title || vid.src}".` });
      continue;
    }
    const link = reg.links.find((l) => l.ref === ref);
    if (link) {
      if (link.pdfPath) {
        try {
          blocks.push({ type: 'text', text: `${ref}: ${link.url} (PDF)` }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await pdf(link.pdfPath) } });
        } catch {
          blocks.push({ type: 'text', text: `${ref}: ${link.url} (PDF, no longer available)` });
        }
      } else if (link.error) blocks.push({ type: 'text', text: `${ref}: ${link.url} (could not be fetched; you may still link to it).` });
      else blocks.push({ type: 'text', text: `${ref}: ${link.url}\nTitle: ${link.title ?? ''}\n\n${link.text ?? ''}` });
    }
  }
  return blocks;
}

/** A turn's materials as text only: ids and descriptions, for turns past the budget (shown earlier). */
export function briefBlocksFor(reg: Registry, refs: string[]): Block[] {
  const lines = refs.map((ref) => {
    const doc = reg.docs.find((d) => d.ref === ref);
    if (doc) return doc.kind === 'pdf' ? `${ref}: document "${doc.name}" (PDF, shown earlier in this conversation; not sent again)` : `${ref}: document "${doc.name}" (shown earlier)`;
    const img = reg.images.find((x) => x.ref === ref);
    if (img) return `${ref}: image${img.alt ? ` "${img.alt}"` : img.title ? ` "${img.title}"` : ''} (${img.width ?? '?'}x${img.height ?? '?'}; shown earlier, not sent again; still usable by its id)`;
    const vid = reg.videos.find((v) => v.ref === ref);
    if (vid) return vid.kind === 'embed' ? `${ref}: ${vid.provider} video (${vid.url})` : `${ref}: uploaded video "${vid.title || vid.src}"`;
    const link = reg.links.find((l) => l.ref === ref);
    if (link) return `${ref}: ${link.url}${link.title ? ` ("${link.title}")` : ''} (read earlier)`;
    return ref;
  });
  return lines.length ? [{ type: 'text', text: lines.join('\n') }] : [];
}

/** What the page builder needs from the registry. */
export async function buildMaterials(db: Db, reg: Registry): Promise<BuildMaterials> {
  const { data: tagRows } = await db.from('terms').select('id, name').eq('taxonomy', 'tag');
  return {
    images: new Map(reg.images.map((i) => [i.ref, { mediaId: i.mediaId, src: i.src, alt: i.alt || i.title }] as [string, ImageMaterial])),
    videos: new Map(reg.videos.map(({ ref, ...v }) => [ref, v as VideoMaterial])),
    tags: new Map((tagRows ?? []).map((t) => [t.name.toLowerCase(), t.id])),
  };
}
