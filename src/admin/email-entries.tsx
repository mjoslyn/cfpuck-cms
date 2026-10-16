// The email builder's Entries block (mailing emails), in the builder: its "Shows" setting (the latest
// entries of some types, optionally of some terms; in a digest, only those published since its last
// issue) and the entries the canvas shows, the site's real ones as they are now
// (/api/admin/mailing/preview; the same code fills them in when the email is sent, src/lib/mailing/entries.ts).
import { useEffect, useState } from 'react';
import type { EmailEvent } from '../lib/forms/email';
import type { EmailEntriesQuery } from '../lib/mailing/entries';
import { LISTABLE_TYPES, taxonomiesOf, taxonomyLabel, typeDef } from '../lib/site';
import { Num, Toggle } from '../puck/fields';
import { TermPicker } from '../puck/CollectionPanel';
import { useEventsOn } from '../puck/member-settings';
import { EVENT_TYPES } from '../lib/events/types';

const cache = new Map<string, Promise<EmailEvent[]>>();

/** A query's entries (null while loading), each query fetched once per builder session. */
export function useEmailEntries(query: EmailEntriesQuery | undefined): { entries: EmailEvent[] | null; error: string } {
  const key = JSON.stringify(query ?? {});
  const [state, setState] = useState<{ key: string; entries: EmailEvent[] | null; error: string }>({ key, entries: null, error: '' });
  useEffect(() => {
    if (!cache.has(key)) {
      const load = fetch('/api/admin/mailing/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"query":${key}}` }).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))));
      load.catch(() => cache.delete(key));
      cache.set(key, load);
    }
    let live = true;
    cache.get(key)!.then(
      (entries) => live && setState({ key, entries, error: '' }),
      (e) => live && setState({ key, entries: [], error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return state.key === key ? state : { entries: null, error: '' };
}

export function EntriesQueryField({ value, onChange }: { value?: EmailEntriesQuery; onChange: (v: EmailEntriesQuery) => void }) {
  const q = value ?? {};
  const set = (patch: EmailEntriesQuery) => onChange({ ...q, ...patch });
  const events = useEventsOn() === true;
  const types = LISTABLE_TYPES.filter((t) => events || !EVENT_TYPES.includes(t));
  const picked = (q.types ?? []).filter((t) => types.includes(t));
  const shown = picked.length ? picked : types.includes('post') ? ['post'] : types.slice(0, 1);
  const taxonomies = [...new Set(shown.flatMap((t) => taxonomiesOf(t)))];
  return (
    <div>
      <fieldset className="mb-3">
        <legend className="mb-1 text-sm font-medium text-[#3b3b3b]">Of</legend>
        {types.map((t) => (
          <label key={t} className="mr-3 inline-flex items-center gap-1 text-sm">
            <input type="checkbox" checked={shown.includes(t)} onChange={(e) => set({ types: e.target.checked ? [...shown, t] : shown.filter((x) => x !== t) })} />
            {typeDef(t)?.label ?? t}
          </label>
        ))}
      </fieldset>
      <Num title="How many" value={q.count ?? 3} min={1} max={12} onChange={(count) => set({ count })} />
      {taxonomies.map((t) => (
        <TermPicker key={t} title={`${taxonomyLabel(t)} (any of)`} taxonomies={[t]} value={q.terms ?? []} onChange={(ids) => set({ terms: ids })} />
      ))}
      <Toggle title="In a digest: only those new since the last issue" value={q.newOnly} onChange={(newOnly) => set({ newOnly })} />
      <Toggle title="Show the date" value={q.showDate !== false} onChange={(showDate) => set({ showDate })} />
      <p className="text-xs text-admin-muted">Listed when each email is sent. Members-only entries are left out. The canvas shows the latest now (in a digest, from the last 7 days).</p>
    </div>
  );
}
