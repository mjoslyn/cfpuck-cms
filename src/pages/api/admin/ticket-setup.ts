// An event's ticket setup, from its page in the Tickets admin (src/lib/tickets/setup.ts):
//   POST { event, tickets }            save its ticket types and settings
//   POST { action: 'attach', event, from }   share another event's tickets (one pool)
//   POST { action: 'detach', event }   stop sharing them
// Saved as the editor, so the policies apply; it clears the page cache.
import type { APIRoute } from 'astro';
import { attachTickets, detachTickets, saveTicketSetup } from '../../../lib/tickets/setup';

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const event = Number(body.event) || 0;
  const problem =
    body.action === 'attach' ? await attachTickets(locals.db, event, Number(body.from) || 0)
    : body.action === 'detach' ? await detachTickets(locals.db, event)
    : await saveTicketSetup(locals.db, event, body.tickets);
  return problem ? new Response(problem, { status: 400 }) : Response.json({ ok: true });
};
