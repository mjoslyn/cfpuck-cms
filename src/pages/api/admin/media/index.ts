// Upload an image (stored at YYYY/MM/name.ext with responsive sizes and AVIF/WebP copies) or a video
// (MP4/WebM/MOV, stored as is, up to 200 MB).
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/db/site';
import { MediaStore, processUpload } from '../../../../lib/media/process';

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.db;
  const file = (await request.formData()).get('file');
  if (!(file instanceof File)) return new Response('No file', { status: 400 });
  const isVideo = ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type);
  if (!file.type.startsWith('image/') && !isVideo) return new Response('Only images and videos (MP4, WebM, MOV) can be uploaded here', { status: 400 });
  if (isVideo && file.size > 200 * 1024 * 1024) return new Response('Videos can be up to 200 MB', { status: 400 });
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
  try {
    for (let n = 1; await taken(path); n++) path = `${dir}/${base.slice(0, dot)}-${n}${base.slice(dot)}`;
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }
  if (isVideo) {
    try {
      await new MediaStore(serviceClient()).put(path, Buffer.from(await file.arrayBuffer()), file.type);
    } catch (e) {
      return new Response(`Could not store the video: ${(e as Error).message}`, { status: 400 });
    }
    const { data, error } = await db
      .from('media')
      .insert({ path, mime_type: file.type, title: base.slice(0, dot > 0 ? dot : undefined), sizes: {}, formats: {}, processed_at: new Date().toISOString() })
      .select('*')
      .single();
    if (error) return new Response(error.message, { status: 400 });
    return Response.json(data);
  }
  let processed;
  try {
    processed = await processUpload(new MediaStore(serviceClient()), path, Buffer.from(await file.arrayBuffer()), file.type);
  } catch (e) {
    return new Response(`Could not process the image: ${(e as Error).message}`, { status: 400 });
  }
  const { data, error } = await db
    .from('media')
    .insert({ ...processed, title: base.slice(0, dot > 0 ? dot : undefined), processed_at: new Date().toISOString() })
    .select('*')
    .single();
  if (error) return new Response(error.message, { status: 400 });
  return Response.json(data);
};
