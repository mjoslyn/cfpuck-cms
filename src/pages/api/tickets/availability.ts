// What's left of an event's tickets, for the ticket form's script (public/assets/js/tickets.js), since
// the page itself can be a minute old: GET /api/tickets/availability?event=<id>[&date=<Y-m-d>]
//   -> { left: n | null, types: { <type id>: n | null } } (null: no limit)
import type { APIRoute } from 'astro';
import { siteDb } from '../../../lib/supabase';
import { PUBLIC_SCOPE, visibleTo } from '../../../lib/data';
import { remaining, ticketsOf } from '../../../lib/tickets/config';
import { soldCounts } from '../../../lib/tickets/orders';

export const GET: APIRoute = async ({ url }) => {
  const id = Number(url.searchParams.get('event')) || 0;
  const date = (url.searchParams.get('date') ?? '').slice(0, 10);
  const { data: entry } = id ? await visibleTo(siteDb().from('entries').select('fields').eq('id', id).eq('type', 'event'), PUBLIC_SCOPE).maybeSingle() : { data: null };
  const tickets = ticketsOf(entry?.fields);
  if (!entry || !tickets.enabled) return new Response('Not found', { status: 404 });
  const left = remaining(tickets, await soldCounts(siteDb(), id, /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''));
  return Response.json({ left: left.total, types: left.types }, { headers: { 'Cache-Control': 'no-store' } });
};
