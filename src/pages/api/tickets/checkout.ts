// A ticket form posted from an event page (src/render/c/tickets.ts): a free order is confirmed at
// once, a paid one goes to the payment provider's checkout (src/lib/tickets/orders.ts startCheckout).
import type { APIRoute } from 'astro';
import { eventsOnIn } from '../../../lib/events/on';
import { startCheckout } from '../../../lib/tickets/orders';
import { viewerOf } from '../../../lib/members/viewer';
import { loadMemberSettings } from '../../../lib/members/account';
import { siteDb } from '../../../lib/db/site';

const FORM = /multipart\/form-data|application\/x-www-form-urlencoded/i;

export const POST: APIRoute = async ({ request, url, cookies }) => {
  if (!FORM.test(request.headers.get('content-type') ?? '')) return new Response('Not found', { status: 404 });
  // Events off (Settings > Events): no ticket sales.
  if (!(await eventsOnIn(siteDb()))) return new Response('Not found', { status: 404 });
  // A signed-in member pays members' prices and may buy members-only tickets (while Members is on).
  const viewer = await viewerOf(request, cookies);
  const member = viewer?.member && (await loadMemberSettings(siteDb())).enabled ? viewer.member : null;
  const next = await startCheckout(await request.formData(), url.origin, member);
  if (!next) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 303, headers: { Location: new URL(next, url).toString(), 'Cache-Control': 'no-store' } });
};
