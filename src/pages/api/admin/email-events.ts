// Events for the email builder's Events block (src/forms/email-events.tsx). POST { query }: the events
// that query lists now (the canvas); POST { design }: each Events block's events by block id (a preview
// rendered in the browser). Read-only, so it doesn't clear the page cache (src/lib/cache.ts).
import type { APIRoute } from 'astro';
import { emailEvents } from '../../../lib/events/email';

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const origin = new URL(request.url).origin;
  try {
    if (body.design?.content) return Response.json(await emailEvents(locals.db, body.design, origin));
    const query = body.query && typeof body.query === 'object' ? body.query : {};
    const events = await emailEvents(locals.db, { root: { props: {} }, content: [{ type: 'Events', props: { id: 'q', query } }] }, origin);
    return Response.json(events.q ?? []);
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }
};
