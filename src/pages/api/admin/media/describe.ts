// Suggest an image's alt text (the media library's Generate): POST { id }; answers { alt }. Nothing is
// saved: the editor saves the form.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/db/site';
import { MediaStore } from '../../../../lib/media/process';
import { describeImage } from '../../../../lib/media/describe';
import { describable } from '../../../../lib/media/alt-text';
import { QuickError } from '../../../../lib/compose/quick';
import type { Media } from '../../../../lib/types';

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const { data: m } = await locals.db.from('media').select('*').eq('id', Number(body.id) || 0).maybeSingle();
  if (!m) return new Response('No such file.', { status: 404 });
  if (!describable(m as Media)) return new Response('Alt text can be written for photos and images only.', { status: 400 });
  try {
    const alt = await describeImage(new MediaStore(serviceClient()), m as Media);
    if (!alt) return new Response('No suggestion came back.', { status: 502 });
    return Response.json({ alt });
  } catch (e) {
    return new Response((e as Error).message, { status: e instanceof QuickError ? e.status : 502 });
  }
};
