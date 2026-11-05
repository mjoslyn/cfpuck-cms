// What's left of a ticket's pool, for the ticket form's script (public/assets/js/tickets.js), since the
// page itself can be a minute old: GET /api/tickets/availability?event=<ticket id>[&date=<Y-m-d>]
//   -> { left: n | null, types: { <type id>: n | null } } (null: no limit)
import type { APIRoute } from 'astro';
import { siteDb } from '../../../lib/db/site';
import { siteViewer } from '../../../lib/members/viewer';
import { eventsOnIn } from '../../../lib/events/on';
import { remaining } from '../../../lib/tickets/config';
import { loadEvent, soldCounts } from '../../../lib/tickets/orders';

export const GET: APIRoute = async ({ url, request }) => {
  if (!(await eventsOnIn(siteDb()))) return new Response('Not found', { status: 404 });
  const id = Number(url.searchParams.get('event')) || 0;
  const date = (url.searchParams.get('date') ?? '').slice(0, 10);
  // As its events' pages: members-only events for the members who may see them.
  const ev = await loadEvent(siteDb(), id, /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '', { published: true, viewer: await siteViewer(request) });
  if (!ev || !ev.tickets.enabled) return new Response('Not found', { status: 404 });
  const left = remaining(ev.tickets, await soldCounts(siteDb(), id, ev.occurrence));
  return Response.json({ left: left.total, types: left.types }, { headers: { 'Cache-Control': 'no-store' } });
};
