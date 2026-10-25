// Editor for entries that are data only, with no page of their own (venues): name, status and fields,
// plus the entries that refer to it.
import { useEffect, useState } from 'react';
import { SITE_TZ } from '../lib/site';
import { FieldsForm, fieldsFor } from './entry-fields';
import { Select, Text } from './fields';
import { browserClient } from '../lib/db/browser';
import { isPlaceholderSlug, slugify } from '../lib/slug';

interface Record_ { id: number; type: string; title: string; slug: string; status: string; fields: Record<string, any> }
interface Ref { id: number; title: string; event_start: string | null }


export default function RecordEditor({ entryId, singular }: { entryId: number; singular: string }) {
  const [rec, setRec] = useState<Record_ | null>(null);
  const [usedBy, setUsedBy] = useState<Ref[]>([]);
  const [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const db = browserClient();
    db.from('entries').select('id, type, title, slug, status, fields').eq('id', entryId).single().then(({ data }) => setRec(data as Record_));
    db.from('entries').select('id, title, event_start').eq('type', 'event').neq('status', 'trash').eq('fields->>venue', String(entryId)).order('event_start', { ascending: false }).limit(50)
      .then(({ data }) => setUsedBy((data ?? []) as Ref[]));
  }, [entryId]);

  if (!rec) return <p className="text-admin-muted">Loading…</p>;
  const set = (patch: Partial<Record_>) => {
    setRec({ ...rec, ...patch });
    setDirty(true);
  };

  const save = async () => {
    if (!rec.title.trim()) return setStatus('Enter a name.');
    setStatus('Saving…');
    // Placeholder slugs from "New ..." follow the name.
    const slug = isPlaceholderSlug(rec.slug, rec.type) ? slugify(rec.title) || rec.slug : rec.slug;
    const res = await fetch(`/api/admin/entries/${rec.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry: { title: rec.title, slug, status: rec.status, excerpt: '', template: null, fields: rec.fields, featured_image: null } }),
    });
    if (!res.ok) return setStatus(`Save failed: ${await res.text()}`);
    setRec({ ...rec, slug });
    setDirty(false);
    setStatus(`Saved ${new Date().toLocaleTimeString()}`);
  };

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_280px]">
      <section className="rounded-lg border border-admin-ink/10 bg-white p-6">
        <Text title="Name" value={rec.title} onChange={(x) => set({ title: x })} />
        <Select title="Status" value={rec.status} options={[['publish', 'Published'], ['draft', 'Draft']]} onChange={(x) => set({ status: x ?? 'draft' })} />
        <FieldsForm defs={fieldsFor(rec.type)} value={rec.fields ?? {}} onChange={(fields) => set({ fields })} />
        <div className="mt-2 flex items-center gap-4">
          <button type="button" onClick={save} className="rounded-sm bg-admin-ink px-4 py-2 text-xs font-semibold tracking-wider text-white uppercase hover:bg-admin-accent">Save</button>
          <span className="text-xs text-admin-muted">{status || (dirty ? 'Unsaved changes' : '')}</span>
        </div>
      </section>
      <aside>
        <h2 className="mb-2 text-xs font-semibold tracking-wider text-admin-muted uppercase">Events at this {singular.toLowerCase()}</h2>
        {usedBy.length ? (
          <ul className="space-y-1 text-sm">
            {usedBy.map((e) => (
              <li key={e.id}>
                <a href={`/admin/edit/${e.id}/`} className="hover:text-admin-accent">{e.title || '(no title)'}</a>
                {e.event_start && <span className="ml-2 text-xs text-admin-muted">{new Date(e.event_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: SITE_TZ })}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-admin-muted">None yet. Choose this {singular.toLowerCase()} in an event's details.</p>
        )}
      </aside>
    </div>
  );
}
