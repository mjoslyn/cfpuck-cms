// Upload an image (stored at YYYY/MM/name.ext with responsive sizes and AVIF/WebP copies) or a video
// (MP4/WebM/MOV, stored as is, up to 200 MB). Images come as a form (field `file`); a video comes as the
// request's body (its type as Content-Type, its name in X-File-Name; src/lib/media/upload.ts) and is
// streamed to the store as it arrives, since the Worker has 128 MB of memory. A form is read whole,
// so it is refused over FORM_MAX_MB.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/db/site';
import { MediaStore, PathTaken, processUpload } from '../../../../lib/media/process';
import { VIDEO_MAX_MB, VIDEO_TYPES } from '../../../../lib/media/upload';

const FORM_MAX_MB = 90;
const MB = 1024 * 1024;

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.db;
  const sent = Number(request.headers.get('content-length') ?? NaN);
  const rawType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  let file: { name: string; type: string; size: number; stream: () => ReadableStream<Uint8Array>; bytes: () => Promise<Uint8Array> };
  if (VIDEO_TYPES.includes(rawType)) {
    if (!request.body || !Number.isFinite(sent) || sent <= 0) return new Response('No file (or no Content-Length)', { status: 411 });
    if (sent > VIDEO_MAX_MB * MB) return new Response(`Videos can be up to ${VIDEO_MAX_MB} MB (on Cloudflare's Free and Pro plans, up to 100 MB)`, { status: 413 });
    let name = 'video';
    try {
      name = decodeURIComponent(request.headers.get('x-file-name') ?? '') || name;
    } catch {}
    const body = request.body;
    file = { name, type: rawType, size: sent, stream: () => body, bytes: () => Promise.reject(new Error('not an image')) };
  } else {
    if (sent > FORM_MAX_MB * MB) return new Response(`Files can be up to ${FORM_MAX_MB} MB here`, { status: 413 });
    const form = (await request.formData()).get('file');
    if (!(form instanceof File)) return new Response('No file', { status: 400 });
    file = { name: form.name, type: form.type, size: form.size, stream: () => form.stream(), bytes: async () => new Uint8Array(await form.arrayBuffer()) };
  }
  const isVideo = VIDEO_TYPES.includes(file.type);
  if (!file.type.startsWith('image/') && !isVideo) return new Response('Only images and videos (MP4, WebM, MOV) can be uploaded here', { status: 400 });
  const now = new Date();
  const dir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const base = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
  const dot = base.lastIndexOf('.');
  // A free name: no stored file may start with its family name (the name without an ending the sizes
  // use, "-300x300" or "-scaled"). So photo-300x300.jpg can't take the place of photo.jpg's thumbnail,
  // and photo.jpg's sizes can't take the place of an upload named photo-300x300.jpg. Storage is checked
  // as well as the library: a file whose library row a restore deleted keeps its images (they aren't in
  // backups), and an upload must never overwrite them.
  const family = (p: string) => p.replace(/\.[a-z0-9]+$/, '').replace(/(-\d+x\d+)?(-scaled)?$/, '');
  const stored = serviceClient().storage.from('media');
  const taken = async (p: string) => {
    const { data } = await db.from('media').select('id').like('path', `${family(p)}%`).limit(1).maybeSingle();
    if (data) return true;
    const name = family(p).slice(dir.length + 1);
    const { data: files, error } = await stored.list(dir, { search: name, limit: 1000 });
    if (error) throw new Error(`Could not check the name: ${error.message}`);
    return (files ?? []).some((f) => f.name.startsWith(name));
  };
  let path = `${dir}/${base}`;
  let n = 0;
  const freeName = async () => {
    while (await taken(path)) path = `${dir}/${base.slice(0, dot)}-${++n}${base.slice(dot)}`;
  };
  // Another upload can take the same name between the check and the writes (parallel uploads of one
  // name): this store never writes over a stored file, and the upload goes again under the next free name.
  // A video's body is read once, so it can't go again: that upload is refused instead.
  const store = new MediaStore(serviceClient(), undefined, true);
  const bytes = isVideo ? null : await file.bytes();
  let processed;
  for (let attempt = 1; ; attempt++) {
    try {
      await freeName();
    } catch (e) {
      return new Response((e as Error).message, { status: 400 });
    }
    try {
      if (bytes) processed = await processUpload(store, path, bytes, file.type);
      else await store.put(path, file.stream(), file.type, file.size);
      break;
    } catch (e) {
      if (e instanceof PathTaken && isVideo) return new Response('Another upload took this name at the same moment: upload the video again.', { status: 409 });
      if (e instanceof PathTaken && attempt < 5) continue;
      return new Response(`Could not ${isVideo ? 'store the video' : 'process the image'}: ${(e as Error).message}`, { status: 400 });
    }
  }
  if (isVideo) {
    const { data, error } = await db
      .from('media')
      .insert({ path, mime_type: file.type, title: base.slice(0, dot > 0 ? dot : undefined), sizes: {}, formats: {}, processed_at: new Date().toISOString() })
      .select('*')
      .single();
    if (error) return new Response(error.message, { status: 400 });
    return Response.json(data);
  }
  const { data, error } = await db
    .from('media')
    .insert({ ...processed, title: base.slice(0, dot > 0 ? dot : undefined), processed_at: new Date().toISOString() })
    .select('*')
    .single();
  if (error) return new Response(error.message, { status: 400 });
  return Response.json(data);
};
