// Tickets are their own records: entries of the hidden `ticket` type (src/lib/events/types.ts), each one
// pool of ticket types, capacity, questions and waitlist (its `fields.tickets`), with its own orders,
// waitlist, emails and attendee list (keyed by its id: ticket_orders.entry_id and the rest). They are
// made and set up under People > Tickets (/admin/tickets/<ticket id>/; POST /api/admin/ticket-setup).
// Events attach to a ticket (`fields.ticket`), from the ticket's page or the event's settings; any number
// of events can attach to one, each selling from its pool. The entries API keeps an event's stored
// `ticket` whatever an editor save brings (keepTickets), so attaching never races an open editor.
import type { Db } from '../db/query';
import { TICKET_KEY, TICKETS_KEY, ticketOf, ticketsOf, type EventTickets } from './config';

/** The setup as stored: cleaned, without the derived `enabled`. */
export function storedTickets(v: unknown): Omit<EventTickets, 'enabled'> {
  const { enabled: _enabled, ...t } = ticketsOf({ [TICKETS_KEY]: v });
  return t;
}

/** An event's `fields` with the ticket `stored` has (or none), whatever `fields` brought; tickets of an
 * event's own (before tickets were their own records) are dropped. */
export function keepTickets(fields: Record<string, any>, stored: Record<string, any> | null | undefined): Record<string, any> {
  const { [TICKETS_KEY]: _own, [TICKET_KEY]: _sent, tickets_from: _from, ...rest } = fields ?? {};
  return ticketOf(stored) ? { ...rest, [TICKET_KEY]: ticketOf(stored) } : rest;
}

/** Writes an entry's fields (and its changes kept aside) as `change` makes them, keeping updated_at. */
async function writeFields(db: Db, id: number, change: (fields: Record<string, any>) => Record<string, any>): Promise<string | null> {
  const { data: row, error } = await db.from('entries').select('fields, updated_at').eq('id', id).single();
  if (error) return error.message;
  const { error: upErr } = await db.from('entries').update({ fields: change(row.fields ?? {}), updated_at: row.updated_at }).eq('id', id);
  if (upErr) return upErr.message;
  const { data: kept } = await db.from('entry_drafts').select('draft').eq('entry_id', id).maybeSingle();
  const draft = kept?.draft as { entry?: { fields?: Record<string, any> } } | undefined;
  if (draft?.entry?.fields) {
    const { error: dErr } = await db.from('entry_drafts').update({ draft: { ...draft, entry: { ...draft.entry, fields: change(draft.entry.fields) } } }).eq('entry_id', id);
    if (dErr) return dErr.message;
  }
  return null;
}

export interface TicketRow {
  id: number;
  title: string;
  fields: Record<string, any> | null;
}

/** A ticket by id, or null. */
export async function loadTicketRow(db: Db, id: number): Promise<TicketRow | null> {
  if (!id) return null;
  const { data } = await db.from('entries').select('id, title, fields').eq('id', id).eq('type', 'ticket').maybeSingle<TicketRow>();
  return data ?? null;
}

/** The events attached to a ticket. */
export async function ticketEvents(db: Db, id: number): Promise<{ id: number; title: string; status: string; event_start: string | null }[]> {
  const { data } = await db.from('entries').select('id, title, status, event_start').eq('type', 'event').neq('status', 'trash').eq(`fields->>${TICKET_KEY}`, String(id)).order('event_start');
  return (data ?? []).map((e) => ({ id: e.id, title: e.title || '(untitled)', status: e.status, event_start: e.event_start }));
}

/** A name no other ticket has: `name`, else it with the next free number ("Christmas Stroll 2"). */
export async function freeTicketName(db: Db, name: string): Promise<string> {
  const base = name.trim().replace(/\s+/g, ' ').slice(0, 190) || 'Tickets';
  const { data } = await db.from('entries').select('title').eq('type', 'ticket');
  const taken = new Set((data ?? []).map((r) => String(r.title ?? '').trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** Makes a ticket (`name`, else "Tickets", made unique), with `setup` if given. Returns its id and name, or an error. */
export async function createTicket(db: Db, name: string, setup?: unknown): Promise<{ id?: number; title?: string; error?: string }> {
  const title = await freeTicketName(db, name);
  const slug = `ticket-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await db.from('entries').insert({ type: 'ticket', slug, title, status: 'publish', fields: setup ? { [TICKETS_KEY]: storedTickets(setup) } : {}, content: { content: [], root: { props: {} } } }).select('id').single();
  return error ? { error: error.message } : { id: data.id, title };
}

/** Saves a ticket's setup (and its name, if given). Returns an error message, or null. */
export async function saveTicketSetup(db: Db, id: number, tickets: unknown, name?: string): Promise<string | null> {
  if (!(await loadTicketRow(db, id))) return 'No such ticket.';
  if (name !== undefined) {
    const { error } = await db.from('entries').update({ title: name.trim().slice(0, 200) || 'Tickets' }).eq('id', id);
    if (error) return error.message;
  }
  return writeFields(db, id, (fields) => ({ ...fields, [TICKETS_KEY]: storedTickets(tickets) }));
}

/** Attaches an event to a ticket (`ticket` 0: detaches it). Its orders stay with the ticket they were made on. */
export async function attachEvent(db: Db, event: number, ticket: number): Promise<string | null> {
  const { data: ev } = await db.from('entries').select('id, type').eq('id', event).maybeSingle();
  if (ev?.type !== 'event') return 'No such event.';
  if (ticket && !(await loadTicketRow(db, ticket))) return 'No such ticket.';
  return writeFields(db, event, (fields) => {
    const { [TICKET_KEY]: _old, ...rest } = fields;
    return ticket ? { ...rest, [TICKET_KEY]: ticket } : rest;
  });
}

/** Deletes a ticket that has no orders, detaching its events. Returns an error message, or null. */
export async function deleteTicket(db: Db, id: number): Promise<string | null> {
  if (!(await loadTicketRow(db, id))) return 'No such ticket.';
  const { data: orders } = await db.from('ticket_orders').select('id').eq('entry_id', id).limit(1);
  if (orders?.length) return 'This ticket has orders, so it stays (detach its events to stop selling it).';
  for (const e of await ticketEvents(db, id)) {
    const problem = await attachEvent(db, e.id, 0);
    if (problem) return problem;
  }
  await db.from('ticket_emails').delete().eq('entry_id', id);
  await db.from('ticket_waitlist').delete().eq('entry_id', id);
  const { error } = await db.from('entries').delete().eq('id', id);
  return error ? error.message : null;
}
