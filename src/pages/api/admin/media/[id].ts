// Update a media item's alt text, caption, title, focal point, per-shape focal points and per-shape
// images (crop_images: another image shown wherever this one is cropped to that shape). A changed focal
// point regenerates the hard-cropped sizes (and their AVIF/WebP copies) around it.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/db/site';
import { MediaStore, addFormats } from '../../../../lib/media/process';
import { SHAPES } from '../../../../lib/media/focal';

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const id = Number(params.id);
  const body = await request.json();
  const { data: m, error } = await locals.db.from('media').select('*').eq('id', id).single();
  if (error) return new Response(error.message, { status: 404 });
  const patch: Record<string, unknown> = {};
  for (const k of ['alt', 'caption', 'title'] as const) if (typeof body[k] === 'string') patch[k] = body[k];
  const f = body.focal_point;
  const focal = f && Number.isFinite(f.x) && Number.isFinite(f.y) ? { x: Math.min(1, Math.max(0, +f.x)), y: Math.min(1, Math.max(0, +f.y)) } : f === null ? null : undefined;
  // Per-shape overrides: { "1/1": {x, y} | null, ... }
  let crops: Record<string, { x: number; y: number }> | undefined;
  if (body.crop_focals && typeof body.crop_focals === 'object') {
    crops = {};
    for (const s of SHAPES) {
      const p = body.crop_focals[s.key];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) crops[s.key] = { x: Math.min(1, Math.max(0, +p.x)), y: Math.min(1, Math.max(0, +p.y)) };
    }
  }
  // Compared as the crops see them: no focal point is the centre, and tiny differences (a click on the
  // same spot, rounding) don't count. Saving only the alt text or caption then re-crops nothing.
  const same = (a: { x: number; y: number } | null | undefined, b: { x: number; y: number } | null | undefined) => {
    const p = a ?? { x: 0.5, y: 0.5 };
    const q = b ?? { x: 0.5, y: 0.5 };
    return Math.abs(p.x - q.x) < 0.001 && Math.abs(p.y - q.y) < 0.001;
  };
  // Per-shape images: { "1/1": { id, focal? } | null, ... }, each an image other than this one, with the
  // focal point for that use.
  if (body.crop_images && typeof body.crop_images === 'object') {
    const point = (p: any) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: Math.min(1, Math.max(0, +p.x)), y: Math.min(1, Math.max(0, +p.y)) } : undefined);
    const wanted: Record<string, { id: number; focal?: { x: number; y: number } }> = {};
    for (const s of SHAPES) {
      const c = body.crop_images[s.key];
      const other = Number(c?.id);
      if (other > 0 && other !== id) wanted[s.key] = { id: other, ...(point(c.focal) ? { focal: point(c.focal) } : {}) };
    }
    const ids = [...new Set(Object.values(wanted).map((c) => c.id))];
    const { data: found } = ids.length ? await locals.db.from('media').select('id, mime_type').in('id', ids) : { data: [] };
    const images = new Set((found ?? []).filter((r) => r.mime_type.startsWith('image/')).map((r) => r.id));
    const missing = ids.filter((x) => !images.has(x));
    if (missing.length) return new Response(`Not an image in the library: ${missing.join(', ')}`, { status: 400 });
    patch.crop_images = wanted;
  }
  const focalChanged = focal !== undefined && !same(focal, m.focal_point);
  const oldCrops = (m.crop_focals ?? {}) as Record<string, { x: number; y: number }>;
  const cropsChanged = crops !== undefined && SHAPES.some((s) => (crops as Record<string, any>)[s.key] || oldCrops[s.key] ? !(crops as Record<string, any>)[s.key] !== !oldCrops[s.key] || !same((crops as Record<string, any>)[s.key], oldCrops[s.key]) : false);
  if (focalChanged) patch.focal_point = focal;
  if (cropsChanged) patch.crop_focals = crops;
  if (focalChanged || cropsChanged) {
    try {
      const next = { ...m, focal_point: focalChanged ? focal : m.focal_point, crop_focals: cropsChanged ? crops : m.crop_focals };
      Object.assign(patch, await addFormats(new MediaStore(serviceClient()), next, { recrop: true }), { processed_at: new Date().toISOString() });
    } catch (e) {
      return new Response(`Could not recrop: ${(e as Error).message}`, { status: 400 });
    }
  }
  const { data, error: e2 } = await locals.db.from('media').update(patch).eq('id', id).select('*').single();
  if (e2) return new Response(e2.message, { status: 400 });
  return Response.json(data);
};
