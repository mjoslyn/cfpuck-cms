// The email builder's Events block, in the builder: its "Shows" setting (the next upcoming events,
// optionally of some categories or featured ones only, or events picked by hand) and the events the
// canvas shows, the site's real ones as they are now (/api/admin/email-events; the same code fills
// them in when the email is sent, src/lib/events/email.ts).
import { useEffect, useState } from 'react';
import type { EmailEvent } from '../lib/forms/email';
import type { EmailEventsQuery } from '../lib/events/email';
import { taxonomiesOf, taxonomyLabel } from '../lib/site';
import { Num, Segmented, Toggle } from '../puck/fields';
import { EntriesField } from '../puck/entry-fields';
import { TermPicker } from '../puck/CollectionPanel';

const cache = new Map<string, Promise<EmailEvent[]>>();

/** A query's events (null while loading), each query fetched once per builder session. */
export function useEmailEvents(query: EmailEventsQuery | undefined): { events: EmailEvent[] | null; error: string } {
  const key = JSON.stringify(query ?? {});
  const [state, setState] = useState<{ key: string; events: EmailEvent[] | null; error: string }>({ key, events: null, error: '' });
  useEffect(() => {
    if (!cache.has(key)) {
      const load = fetch('/api/admin/email-events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"query":${key}}` }).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))));
      load.catch(() => cache.delete(key));
      cache.set(key, load);
    }
    let live = true;
    cache.get(key)!.then(
      (events) => live && setState({ key, events, error: '' }),
      (e) => live && setState({ key, events: [], error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return state.key === key ? state : { events: null, error: '' };
}

/** Every Events block's events in a document, by block id (for a preview rendered in the browser). */
export async function fetchEmailEvents(design: unknown): Promise<Record<string, EmailEvent[]>> {
  const r = await fetch('/api/admin/email-events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ design }) });
  return r.ok ? r.json() : {};
}

export function EventsQueryField({ value, onChange }: { value?: EmailEventsQuery; onChange: (v: EmailEventsQuery) => void }) {
  const q = value ?? {};
  const set = (patch: EmailEventsQuery) => onChange({ ...q, ...patch });
  const taxonomies = taxonomiesOf('event');
  return (
    <div>
      <Segmented title="Shows" value={q.source === 'picked' ? 'picked' : 'upcoming'} options={[['upcoming', 'Next upcoming'], ['picked', 'Picked events']]} onChange={(v) => set({ source: v as EmailEventsQuery['source'] })} />
      {q.source === 'picked' ? (
        <>
          <EntriesField title="Events, in order" types={['event']} value={q.include} onChange={(include) => set({ include })} />
          <p className="text-xs text-admin-muted">Each shows at its next date; events that are over are left out.</p>
        </>
      ) : (
        <>
          <Num title="How many" value={q.count ?? 3} min={1} max={12} onChange={(count) => set({ count })} />
          {taxonomies.map((t) => (
            <TermPicker key={t} title={`${taxonomyLabel(t)} (any of)`} taxonomies={[t]} value={q.terms ?? []} onChange={(ids) => set({ terms: ids })} />
          ))}
          <Toggle title="Featured events only" value={q.featured} onChange={(featured) => set({ featured })} />
        </>
      )}
      <p className="text-xs text-admin-muted">Listed when each email is sent, so they are the events as they are then. A plain text of your own doesn't list them: leave it empty to have it made with them.</p>
    </div>
  );
}
