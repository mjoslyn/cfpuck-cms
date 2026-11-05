// An event's ticket setup on its page in the Tickets admin (?view=setup): the form (src/puck/TicketsForm.tsx)
// with Save, POST /api/admin/ticket-setup (src/lib/tickets/setup.ts). **Use another event's tickets**
// shares that event's tickets: one pool (types, capacity, orders, waitlist) sold from every event sharing
// it, set up and managed on that event's page; Stop sharing ends it. Leaving with unsaved changes asks first.
import { useEffect, useState } from 'react';
import { TicketsForm } from '../puck/TicketsForm';
import { TICKETS_KEY } from '../lib/tickets/config';

/** An event whose tickets can be shared. */
export interface TicketSource {
  id: number;
  title: string;
  when: string;
  types: number;
}

interface Props {
  eventId: number;
  tickets: Record<string, any> | null;
  /** Events whose tickets this one can share (none when it can't: it has orders, or others share its own). */
  sources?: TicketSource[];
  /** The event whose tickets this one shares. */
  sharedFrom?: { id: number; title: string } | null;
  /** The events sharing this one's tickets. */
  sharedWith?: { id: number; title: string }[];
}

const post = async (body: Record<string, unknown>) => {
  const res = await fetch('/api/admin/ticket-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.ok ? null : await res.text();
};

export default function TicketSetup({ eventId, tickets, sources = [], sharedFrom = null, sharedWith = [] }: Props) {
  const [from, setFrom] = useState('');
  const [fields, setFields] = useState<Record<string, any>>(() => (tickets ? { [TICKETS_KEY]: tickets } : {}));
  const [saved, setSaved] = useState(() => JSON.stringify(fields));
  const [status, setStatus] = useState('');
  const dirty = JSON.stringify(fields) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async () => {
    setStatus('Saving…');
    const problem = await post({ event: eventId, tickets: fields[TICKETS_KEY] ?? null });
    if (problem) return setStatus(`Not saved: ${problem}`);
    setSaved(JSON.stringify(fields));
    setStatus('Saved.');
    // The counts and tabs above follow the setup.
    location.reload();
  };

  const act = async (body: Record<string, unknown>, question: string) => {
    if (!confirm(question)) return;
    setStatus('Saving…');
    const problem = await post({ event: eventId, ...body });
    if (problem) return setStatus(`Not saved: ${problem}`);
    location.reload();
  };
  const panel = 'max-w-xl rounded bg-white p-5 shadow-[0_0_0_1px_rgba(26,26,46,0.08)]';

  // Sharing another event's tickets: they are set up and sold there.
  if (sharedFrom) {
    return (
      <div className={panel}>
        <p className="text-sm">
          This event sells the tickets of <a className="text-admin-accent underline" href={`/admin/tickets/${sharedFrom.id}/?view=setup`}>{sharedFrom.title}</a>: one pool of tickets for every event sharing them, set up on that event's page with its capacity, waitlist and emails. Orders bought on this event's page are under Orders here, and on that event's page with all the others.
        </p>
        <div className="mt-4 flex items-center gap-3 border-t border-admin-ink/10 pt-4">
          <button type="button" onClick={() => act({ action: 'detach' }, `Stop selling ${sharedFrom.title}'s tickets here? This event goes back to its own ticket types, if it had any. Orders already made stay where they were made.`)} className="rounded border border-admin-ink/20 px-3 py-1.5 text-sm hover:border-admin-accent hover:text-admin-accent">
            Stop sharing
          </button>
          <span role="status" className="text-sm text-admin-muted">{status}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={panel}>
      {sharedWith.length > 0 && (
        <p className="mb-4 rounded bg-admin-bg p-3 text-sm">
          Shared with {sharedWith.map((e, i) => <span key={e.id}>{i ? ', ' : ''}<a className="text-admin-accent underline" href={`/admin/edit/${e.id}/`}>{e.title}</a></span>)}: they sell these tickets too, from one pool. Orders from all of them are listed here.
        </p>
      )}
      {sources.length > 0 && (
        <div className="mb-4 border-b border-admin-ink/10 pb-4">
          <label htmlFor="share-from" className="mb-1 block text-xs font-medium text-admin-muted">Or use another event's tickets</label>
          <div className="flex gap-2">
            <select id="share-from" value={from} onChange={(e) => setFrom(e.target.value)} className="min-w-0 flex-1 rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm">
              <option value="">Choose an event</option>
              {sources.map((x) => (
                <option key={x.id} value={x.id}>{x.title}{x.when ? ` (${x.when})` : ''}: {x.types} ticket type{x.types === 1 ? '' : 's'}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!from}
              onClick={() => {
                const src = sources.find((x) => String(x.id) === from);
                if (src) act({ action: 'attach', from: src.id }, `Sell ${src.title}'s tickets here? Both events then share one pool of tickets, set up and managed on ${src.title}'s page${fields[TICKETS_KEY]?.types?.length ? ", and this event's own ticket types are removed" : ''}.`);
              }}
              className="rounded border border-admin-ink/20 px-3 py-1.5 text-sm hover:border-admin-accent hover:text-admin-accent disabled:opacity-50"
            >
              Share its tickets
            </button>
          </div>
          <p className="mt-1 text-xs text-admin-muted">One pool: tickets bought at any of the events come from the same ticket types and capacity, like a pass.</p>
        </div>
      )}
      <TicketsForm eventId={eventId} fields={fields} onChange={(f) => { setFields(f); setStatus(''); }} />
      <div className="mt-4 flex items-center gap-3 border-t border-admin-ink/10 pt-4">
        <button type="button" disabled={!dirty} onClick={save} className="rounded bg-admin-accent px-4 py-2 text-sm text-white hover:bg-admin-accent-dark disabled:opacity-50">
          Save tickets
        </button>
        <span role="status" className="text-sm text-admin-muted">{status || (dirty ? 'Unsaved changes' : '')}</span>
      </div>
    </div>
  );
}
