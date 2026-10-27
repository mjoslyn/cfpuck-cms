// /media/ URLs: the media library's files, from the site's store (the bucket's media/ folder, same
// paths). Validators pass through, and one range (video), checked against the file's size by the store.
// Files never change in place, so answers are cached a year, at the CDN too. Headers by type: mediaHeaders.
import type { APIRoute } from 'astro';
import { siteStorage } from '../../lib/storage';
import { unsafeMediaPath, MEDIA_HEADERS, mediaHeaders } from '../../lib/media/path-guard';

const PASSED_IN = ['range', 'if-none-match', 'if-modified-since'];
const PASSED_OUT = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

const answer = async (request: Request, path: string | undefined, head: boolean) => {
  // Only paths inside the media folder.
  if (!path || unsafeMediaPath(new URL(request.url).pathname) || unsafeMediaPath(path)) return new Response('Not found', { status: 404 });
  const headers = Object.fromEntries(PASSED_IN.flatMap((h) => (request.headers.get(h) ? [[h, request.headers.get(h)!]] : [])));
  const res = await siteStorage().get(`media/${path}`, headers);
  // A range past the end of the file (the store checks it against the file's size): 416, not kept.
  if (res.status === 416) return new Response(null, { status: 416, headers: { 'Content-Range': res.headers.get('content-range') ?? '', 'Cache-Control': 'no-store', ...MEDIA_HEADERS } });
  if (!res.ok && res.status !== 304) return new Response('Not found', { status: 404 });
  const out = new Headers({ 'Cache-Control': 'public, max-age=31536000, immutable', 'Cloudflare-CDN-Cache-Control': 'public, max-age=31536000, immutable', ...mediaHeaders(res.headers.get('content-type'), path) });
  for (const h of PASSED_OUT) if (res.headers.get(h)) out.set(h, res.headers.get(h)!);
  return new Response(head || res.status === 304 ? null : res.body, { status: res.status, headers: out });
};

export const GET: APIRoute = ({ request, params }) => answer(request, params.path, false);
export const HEAD: APIRoute = ({ request, params }) => answer(request, params.path, true);
