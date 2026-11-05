// An event's ticket setup (fields.tickets) is edited on its page in the Tickets admin
// (/admin/tickets/<id>/?view=setup), not in the event's settings. Saved there (POST
// /api/admin/ticket-setup), it is written into the live entry's fields and any changes kept aside, without
// touching updated_at, so an editor open on the event isn't told someone else saved. The entries API keeps
// the stored setup whenever it writes an event's fields (keepTickets), so a save from the editor, a
// publish of changes kept aside or a restored version never brings back an older one.
// Shared tickets: an event can use another's tickets (attachTickets: fields.tickets_from), one pool for
// all of them: the ticket types, capacity, orders, waitlist, emails and attendee list stay on the event
// that holds them, and every event sharing them sells from it (src/render/c/tickets.ts loadHost).
import type { Db } from '../db/query';
import { TICKETS_FROM_KEY, TICKETS_KEY, ticketsFromOf, ticketsOf, type EventTickets } from './config';

/** The setup as stored: cleaned, without the derived `enabled`. */
export function storedTickets(v: unknown): Omit<EventTickets, 'enabled'> | undefined {
  const { enabled: _enabled, ...t } = ticketsOf({ [TICKETS_KEY]: v });
  return t.types.length || t.questions?.length || t.heading || t.capacity != null ? t : undefined;
}

/** `fields` with the setup `stored` has (its tickets, or the event it shares them with; or none), whatever `fields` brought. */
export function keepTickets(fields: Record<string, any>, stored: Record<string, any> | null | undefined): Record<string, any> {
  const { [TICKETS_KEY]: _sent, [TICKETS_FROM_KEY]: _from, ...rest } = fields ?? {};
  return {
    ...rest,
    ...(stored?.[TICKETS_KEY] ? { [TICKETS_KEY]: stored[TICKETS_KEY] } : {}),
    ...(ticketsFromOf(stored) ? { [TICKETS_FROM_KEY]: ticketsFromOf(stored) } : {}),
  };
}

/** Writes an event's fields (and its changes kept aside) as `change` makes them, keeping updated_at. */
async function writeSetup(db: Db, id: number, change: (fields: Record<string, any>) => Record<string, any>): Promise<string | null> {
  const { data: ev, error } = await db.from('entries').select('fields, updated_at').eq('id', id).single();
  if (error) return error.message;
  const { error: upErr } = await db.from('entries').update({ fields: change(ev.fields ?? {}), updated_at: ev.updated_at }).eq('id', id);
  if (upErr) return upErr.message;
  const { data: kept } = await db.from('entry_drafts').select('draft').eq('entry_id', id).maybeSingle();
  const draft = kept?.draft as { entry?: { fields?: Record<string, any> } } | undefined;
  if (draft?.entry?.fields) {
    const { error: dErr } = await db.from('entry_drafts').update({ draft: { ...draft, entry: { ...draft.entry, fields: change(draft.entry.fields) } } }).eq('entry_id', id);
    if (dErr) return dErr.message;
  }
  return null;
}

/** The events sharing an event's tickets. */
export async function sharingEvents(db: Db, id: number): Promise<{ id: number; title: string }[]> {
  const { data } = await db.from('entries').select('id, title, fields').eq('type', 'event').neq('status', 'trash').not(`fields->${TICKETS_FROM_KEY}`, 'is', null).order('title');
  return (data ?? []).filter((e) => ticketsFromOf(e.fields) === id).map((e) => ({ id: e.id, title: e.title || '(untitled)' }));
}

/** Makes event `id` sell `from`'s tickets, one pool for both. Returns an error message, or null. */
export async function attachTickets(db: Db, id: number, from: number): Promise<string | null> {
  if (!id || !from || id === from) return 'Choose another event.';
  const { data: rows } = await db.from('entries').select('id, type, fields').in('id', [id, from]);
  const ev = rows?.find((r) => r.id === id);
  const host = rows?.find((r) => r.id === from);
  if (ev?.type !== 'event' || host?.type !== 'event') return 'No such event.';
  if (ticketsFromOf(host.fields)) return 'That event shares another event’s tickets itself: choose that one.';
  if (!ticketsOf(host.fields).enabled) return 'That event has no tickets to share.';
  if ((await sharingEvents(db, id)).length) return 'Other events share this event’s tickets: they would lose them.';
  const { data: orders } = await db.from('ticket_orders').select('id').eq('entry_id', id).limit(1);
  if (orders?.length) return 'This event has orders of its own, so it keeps its own tickets.';
  return writeSetup(db, id, (fields) => {
    const { [TICKETS_KEY]: _own, ...rest } = fields;
    return { ...rest, [TICKETS_FROM_KEY]: from };
  });
}

/** Stops event `id` sharing another event's tickets (it then has none of its own). */
export function detachTickets(db: Db, id: number): Promise<string | null> {
  return writeSetup(db, id, (fields) => {
    const { [TICKETS_FROM_KEY]: _from, ...rest } = fields;
    return rest;
  });
}

/** Saves an event's ticket setup. Returns an error message, or null. */
export async function saveTicketSetup(db: Db, id: number, tickets: unknown): Promise<string | null> {
  const { data: ev, error } = await db.from('entries').select('id, type, fields').eq('id', id).maybeSingle();
  if (error) return error.message;
  if (!ev || ev.type !== 'event') return 'No such event.';
  if (ticketsFromOf(ev.fields)) return 'This event shares another event’s tickets: change them there, or stop sharing them first.';
  const setup = storedTickets(tickets);
  return writeSetup(db, id, (fields) => keepTickets(fields, setup ? { [TICKETS_KEY]: setup } : null));
}
