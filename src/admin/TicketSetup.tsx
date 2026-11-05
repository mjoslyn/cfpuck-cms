// A ticket's setup on its page in the Tickets admin (?view=setup): its name, the events attached to it
// (attach another, detach one), the form (src/puck/TicketsForm.tsx) with Save, and Delete for a ticket
// without orders; POST /api/admin/ticket-setup (src/lib/tickets/setup.ts). Every attached event sells from
// the ticket's one pool (types, capacity, orders, waitlist). Leaving with unsaved changes asks first.
import { useEffect, useState } from 'react';
import { TicketsForm } from '../puck/TicketsForm';
import { TICKETS_KEY } from '../lib/tickets/config';

/** An event, as the setup lists it. */
export interface TicketEvent {
  id: number;
  title: string;
  when: string;
  draft?: boolean;
  /** The ticket it is attached to now, if another: its name. */
  other?: string;
}

interface Props {
  ticketId: number;
  name: string;
  tickets: Record<string, any> | null;
  /** The events attached to it. */
  events: TicketEvent[];
  /** Events that can be attached (not this ticket's). */
  attachable: TicketEvent[];
  /** It has orders: it can't be deleted. */
  hasOrders: boolean;
}

const post = async (body: Record<string, unknown>) => {
  const res = await fetch('/api/admin/ticket-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.ok ? null : await res.text();
};

export default function TicketSetup({ ticketId, name: savedName, tickets, events, attachable, hasOrders }: Props) {
  const [pick, setPick] = useState('');
  const [name, setName] = useState(savedName);
  const [fields, setFields] = useState<Record<string, any>>(() => (tickets ? { [TICKETS_KEY]: tickets } : {}));
  const [saved, setSaved] = useState(() => JSON.stringify(fields));
  const [status, setStatus] = useState('');
  const dirty = JSON.stringify(fields) !== saved || name.trim() !== savedName;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async () => {
    setStatus('Saving…');
    const problem = await post({ action: 'save', ticket: ticketId, name, tickets: fields[TICKETS_KEY] ?? null });
    if (problem) return setStatus(`Not saved: ${problem}`);
    setSaved(JSON.stringify(fields));
    setStatus('Saved.');
    // The counts and tabs above follow the setup.
    location.reload();
  };

  const act = async (body: Record<string, unknown>, question: string, then = () => location.reload()) => {
    if (dirty && !confirm('You have unsaved changes to the ticket types. Carry on without saving them?')) return;
    if (!confirm(question)) return;
    setStatus('Saving…');
    const problem = await post(body);
    if (problem) return setStatus(`Not saved: ${problem}`);
    setSaved(JSON.stringify(fields));
    then();
  };
  const panel = 'max-w-xl rounded bg-white p-5 shadow-[0_0_0_1px_rgba(26,26,46,0.08)]';
  const button = 'rounded border border-admin-ink/20 px-3 py-1.5 text-sm hover:border-admin-accent hover:text-admin-accent disabled:opacity-50';

  return (
    <div className="space-y-4">
      <div className={panel}>
        <label htmlFor="ticket-name" className="mb-1 block text-xs font-medium text-admin-muted">Name</label>
        <input id="ticket-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-admin-ink/15 px-2 py-1.5 text-sm" />
        <p className="mt-1 text-xs text-admin-muted">For you, and for emails and orders when it sells at several events (with one event, they use the event's name).</p>

        <h2 className="mt-5 text-sm font-medium">Events selling this ticket</h2>
        {events.length ? (
          <ul className="mt-2 list-none divide-y divide-admin-ink/5 pl-0 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-1.5">
                <span>
                  <a className="hover:text-admin-accent" href={`/admin/edit/${e.id}/`}>{e.title}</a>
                  <span className="text-admin-muted">{e.when ? ` (${e.when})` : ''}{e.draft ? ' (draft)' : ''}</span>
                </span>
                <button type="button" className="text-xs text-admin-muted hover:text-[#b91c1c]" onClick={() => act({ action: 'detach', event: e.id }, `Stop selling this ticket at ${e.title}? Its orders stay with the ticket.`)}>
                  Detach
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-admin-muted">None yet. Attach an event to sell this ticket on its page.</p>
        )}
        {events.length > 1 && <p className="mt-1 text-xs text-admin-muted">One pool: tickets bought at any of these events come from the same ticket types and capacity, like a pass.</p>}
        {attachable.length > 0 && (
          <div className="mt-3 flex gap-2">
            <label htmlFor="attach-event" className="sr-only">Event to attach</label>
            <select id="attach-event" value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm">
              <option value="">Choose an event</option>
              {attachable.map((x) => (
                <option key={x.id} value={x.id}>{x.title}{x.when ? ` (${x.when})` : ''}{x.draft ? ' (draft)' : ''}{x.other ? `: sells ${x.other}` : ''}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!pick}
              className={button}
              onClick={() => {
                const ev = attachable.find((x) => String(x.id) === pick);
                if (ev) act({ action: 'attach', ticket: ticketId, event: ev.id }, `Sell this ticket at ${ev.title}?${ev.other ? ` It stops selling ${ev.other} (orders already made stay with that ticket).` : ''}`);
              }}
            >
              Attach
            </button>
          </div>
        )}
      </div>

      <div className={panel}>
        <TicketsForm ticketId={ticketId} fields={fields} onChange={(f) => { setFields(f); setStatus(''); }} />
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-admin-ink/10 pt-4">
          <button type="button" disabled={!dirty} onClick={save} className="rounded bg-admin-accent px-4 py-2 text-sm text-white hover:bg-admin-accent-dark disabled:opacity-50">
            Save tickets
          </button>
          <span role="status" className="text-sm text-admin-muted">{status || (dirty ? 'Unsaved changes' : '')}</span>
          {!hasOrders && (
            <button type="button" className="ml-auto text-xs text-[#b91c1c] hover:underline" onClick={() => act({ action: 'delete', ticket: ticketId }, `Delete ${savedName}?${events.length ? ' Its events stop selling tickets.' : ''} This can't be undone.`, () => (location.href = '/admin/tickets/'))}>
              Delete ticket
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
