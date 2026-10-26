// The waitlist form of a sold-out event (src/render/c/tickets.ts; src/lib/tickets/orders.ts joinWaitlist).
import type { APIRoute } from 'astro';
import { eventsOnIn } from '../../../lib/events/on';
import { siteDb } from '../../../lib/db/site';
import { joinWaitlist } from '../../../lib/tickets/orders';
import { siteViewer } from '../../../lib/members/viewer';

const FORM = /multipart\/form-data|application\/x-www-form-urlencoded/i;

export const POST: APIRoute = async ({ request, url }) => {
  if (!FORM.test(request.headers.get('content-type') ?? '')) return new Response('Not found', { status: 404 });
  // Events off (Settings > Events): no ticket sales.
  if (!(await eventsOnIn(siteDb()))) return new Response('Not found', { status: 404 });
  // Members-only events take a waitlist from those who may see them (as their pages).
  const who = await siteViewer(request);
  const next = await joinWaitlist(await request.formData(), who);
  if (!next) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 303, headers: { Location: new URL(next, url).toString(), 'Cache-Control': 'no-store' } });
};
