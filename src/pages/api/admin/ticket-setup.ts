// Tickets (their own records, src/lib/tickets/setup.ts), from People > Tickets and an event's settings:
//   POST { action: 'create', name, event? }     a new ticket, its name made unique (the event attached to it) -> { id, title }
//   POST { action: 'save', ticket, tickets, name? }   its ticket types and settings (and name)
//   POST { action: 'attach', ticket, event }    an event sells this ticket (from its old one, if any)
//   POST { action: 'detach', event }            the event sells none
//   POST { action: 'delete', ticket }           a ticket without orders, its events detached
// Saved as the editor, so the policies apply (deleting also clears the ticket's waitlist, the server's);
// it clears the page cache.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/db/site';
import { attachEvent, createTicket, deleteTicket, saveTicketSetup } from '../../../lib/tickets/setup';

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const ticket = Number(body.ticket) || 0;
  const event = Number(body.event) || 0;
  const name = typeof body.name === 'string' ? body.name : undefined;
  if (body.action === 'create') {
    const made = await createTicket(locals.db, name ?? '', body.tickets);
    if (!made.id) return new Response(made.error ?? 'Could not make the ticket.', { status: 400 });
    const problem = event ? await attachEvent(locals.db, event, made.id) : null;
    return problem ? new Response(problem, { status: 400 }) : Response.json({ ok: true, id: made.id, title: made.title });
  }
  const problem =
    body.action === 'attach' ? (ticket ? await attachEvent(locals.db, event, ticket) : 'Choose a ticket.')
    : body.action === 'detach' ? await attachEvent(locals.db, event, 0)
    : body.action === 'delete' ? await deleteTicket(serviceClient(), ticket)
    : await saveTicketSetup(locals.db, ticket, body.tickets, name);
  return problem ? new Response(problem, { status: 400 }) : Response.json({ ok: true });
};
