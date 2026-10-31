// Sidebar form for an entry's own data: core columns plus the fields of each content type.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Code, LinkInput, MediaPicker, Num, Row, Select, Text, Toggle, inputClass, FieldGroup } from './fields';
import { browserClient } from '../lib/db/browser';
import { mediaUrl } from '../lib/media/image';
import { RECURRENCE_KEY, occurrenceDates, type Recurrence } from '../lib/recurrence';
import { fieldsFor as siteFields, PAGELESS_TYPES, SITE_TZ, type FieldDef, taxonomiesOf, taxonomyLabel } from '../lib/site';
import { permalink } from '../lib/permalink';
import { isPlaceholderSlug, slugify } from '../lib/slug';
import { SeoForm } from './SeoForm';
import { TicketsForm } from './TicketsForm';
import { useMemberSettings, useSite } from './member-settings';
import { tagsOn } from '../lib/templates';
import { accessOf } from '../lib/members/config';
import { itemsText } from '../lib/seo';
import { NO_CONTENT_WARNING, templateLabel, type TemplateInfo } from '../lib/templates';

/** A type's fields, from the site config. */
export const fieldsFor = (type: string): FieldDef[] => siteFields(type);


/** Image fields may hold a URL (return format "url") or an attachment id. */
const imageValue = (v: unknown) => (typeof v === 'string' && !/^\d+$/.test(v) ? v : '');

export function FieldsForm({ defs, value, onChange }: { defs: FieldDef[]; value: Record<string, any>; onChange: (v: Record<string, any>) => void }) {
  const v = value ?? {};
  const set = (k: string, x: any) => onChange({ ...v, [k]: x });
  return (
    <>
      {defs.map((d) => {
        switch (d.type) {
          case 'text':
          case 'email':
            return <Text key={d.key} title={d.label} value={v[d.key]} onChange={(x) => set(d.key, x)} />;
          case 'url':
            return <LinkInput key={d.key} title={d.label} value={v[d.key]} onChange={(x) => set(d.key, x)} />;
          case 'number':
            return <Num key={d.key} title={d.label} value={v[d.key]} onChange={(x) => set(d.key, x ?? '')} />;
          case 'textarea':
            return (
              <Row key={d.key} title={d.label}>
                <textarea className={inputClass} rows={3} value={v[d.key] ?? ''} onChange={(e) => set(d.key, e.target.value)} />
              </Row>
            );
          case 'html':
            return <Code key={d.key} title={d.label} value={v[d.key] ?? ''} onChange={(x) => set(d.key, x)} rows={5} />;
          case 'bool':
            return <Toggle key={d.key} title={d.label} value={v[d.key] === true || v[d.key] === '1' || v[d.key] === 1} onChange={(x) => set(d.key, x)} />;
          case 'select':
            return <Select key={d.key} title={d.label} value={v[d.key]} options={d.options} onChange={(x) => set(d.key, x ?? '')} />;
          case 'image':
            return <MediaPicker key={d.key} title={d.label} url={imageValue(v[d.key]) || undefined} onSelect={(m) => set(d.key, m.url)} />;
          case 'entry':
            return <EntryField key={d.key} title={d.label} entryType={d.entryType} create={d.create} value={v[d.key]} onChange={(x) => set(d.key, x)} />;
          case 'entries':
            return <EntriesField key={d.key} title={d.label} types={d.types} value={v[d.key]} onChange={(x) => set(d.key, x)} />;
          case 'repeater':
            return <Repeater key={d.key} def={d} value={v[d.key]} onChange={(x) => set(d.key, x)} />;
        }
      })}
    </>
  );
}

/** What to call one item: the definition's itemName, or the label made singular ("Activities": "activity"). */
const itemNoun = (d: Extract<FieldDef, { type: 'repeater' }>) =>
  d.itemName ?? d.label.toLowerCase().replace(/ies$/, 'y').replace(/(?<!s)s$/, '');

/**
 * A list of items, each a collapsible group of fields that can be moved or removed. Items start open
 * (new ones too, so their fields are ready to fill in) and stay as the editor leaves them.
 */
function Repeater({ def: d, value, onChange }: { def: Extract<FieldDef, { type: 'repeater' }>; value: unknown; onChange: (v: Record<string, any>[]) => void }) {
  const rows: Record<string, any>[] = Array.isArray(value) ? value : [];
  // Closed items by position, kept in step when items move or go.
  const [closed, setClosed] = useState<Set<number>>(() => new Set());
  const noun = itemNoun(d);
  const move = (i: number, j: number) => {
    const r = [...rows];
    [r[i], r[j]] = [r[j], r[i]];
    onChange(r);
    setClosed((o) => new Set([...o].map((k) => (k === i ? j : k === j ? i : k))));
  };
  const remove = (i: number) => {
    onChange(rows.filter((_, j) => j !== i));
    setClosed((o) => new Set([...o].filter((k) => k !== i).map((k) => (k > i ? k - 1 : k))));
  };
  const add = () => {
    onChange([...rows, {}]);
    setClosed((o) => new Set([...o].filter((k) => k !== rows.length)));
  };
  return (
    <div className="mb-3">
      <span className="mb-1 block text-xs font-medium text-admin-muted">{d.label}</span>
      {rows.map((row, i) => (
        <details
          key={i}
          open={!closed.has(i)}
          onToggle={(e) => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open;
            setClosed((o) => (o.has(i) === !isOpen ? o : isOpen ? new Set([...o].filter((k) => k !== i)) : new Set(o).add(i)));
          }}
          className="mb-1 rounded border border-admin-ink/10 bg-admin-bg"
        >
          <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm">
            <span className="truncate">{(d.itemLabel && row[d.itemLabel]) || `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${i + 1}`}</span>
            <span className="ml-auto flex gap-1 text-xs text-admin-muted">
              <button type="button" disabled={i === 0} onClick={(e) => { e.preventDefault(); move(i, i - 1); }}>Up</button>
              <button type="button" disabled={i === rows.length - 1} onClick={(e) => { e.preventDefault(); move(i, i + 1); }}>Down</button>
              <button type="button" className="text-[#c4592a]" onClick={(e) => { e.preventDefault(); remove(i); }}>Remove</button>
            </span>
          </summary>
          <div className="border-t border-admin-ink/10 bg-white p-2">
            <FieldsForm defs={d.fields} value={row} onChange={(x) => onChange(rows.map((r, j) => (j === i ? x : r)))} />
          </div>
        </details>
      ))}
      <button type="button" className="mt-1 rounded border border-dashed border-admin-ink/25 px-3 py-1 text-xs text-admin-muted hover:border-admin-accent hover:text-admin-accent" onClick={add}>
        Add {noun}
      </button>
    </div>
  );
}

interface EntryRow { id: number; title: string; slug: string; status: string; fields: Record<string, any> | null }

const summary = (e: EntryRow) => [e.fields?.address, e.fields?.city, e.fields?.state].filter(Boolean).join(', ');

/** A single entry reference (an event's venue): pick one by searching, clear it, or add a new one inline. */
export function EntryField({ title, entryType, create, value, onChange }: { title: string; entryType: string; create?: FieldDef[]; value: unknown; onChange: (v: number | null) => void }) {
  const id = Number(value) || 0;
  const noun = title.toLowerCase();
  const [current, setCurrent] = useState<EntryRow | null>(null);
  const [mode, setMode] = useState<'view' | 'search' | 'create'>('view');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<EntryRow[]>([]);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cols = 'id, title, slug, status, fields';

  useEffect(() => {
    if (!id) return setCurrent(null);
    if (current?.id === id) return;
    browserClient().from('entries').select(cols).eq('id', id).maybeSingle().then(({ data }) => setCurrent((data as EntryRow) ?? null));
  }, [id]);
  useEffect(() => {
    if (mode !== 'search') return;
    let query = browserClient().from('entries').select(cols).eq('type', entryType).neq('status', 'trash').order('title').limit(12);
    if (q.trim()) query = query.ilike('title', `%${q.trim()}%`);
    query.then(({ data }) => setResults((data ?? []) as EntryRow[]));
  }, [q, mode]);

  const pick = (e: EntryRow) => {
    setCurrent(e);
    onChange(e.id);
    setMode('view');
    setQ('');
  };
  const add = async () => {
    const name = String(draft.title ?? '').trim();
    if (!name) return setError('Enter a name.');
    setBusy(true);
    setError('');
    const { title: _t, ...fields } = draft;
    const res = await fetch('/api/admin/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: entryType, title: name, fields, status: 'publish' }) });
    setBusy(false);
    if (!res.ok) return setError(await res.text());
    const row = await res.json();
    pick({ ...row, status: 'publish', fields });
    setDraft({});
  };
  const link = 'text-xs text-admin-muted hover:text-admin-accent';

  return (
    <div className="mb-3">
      <span className="mb-1 block text-xs font-medium text-admin-muted">{title}</span>
      {mode === 'view' && (
        <>
          {current ? (
            <div className="rounded border border-admin-ink/10 bg-admin-bg px-3 py-2 text-sm">
              <div className="font-medium">{current.title}{current.status !== 'publish' && <span className="ml-2 text-xs font-normal text-admin-muted">({current.status})</span>}</div>
              {summary(current) && <div className="text-xs text-admin-muted">{summary(current)}</div>}
              <div className="mt-1.5 flex gap-3">
                <button type="button" className={link} onClick={() => setMode('search')}>Change</button>
                <a className={link} href={`/admin/edit/${current.id}/`} target="_blank" rel="noopener">Edit</a>
                <button type="button" className="ml-auto text-xs text-[#c4592a]" onClick={() => { setCurrent(null); onChange(null); }}>Remove</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button type="button" className="flex-1 rounded border border-dashed border-admin-ink/25 px-3 py-1.5 text-xs text-admin-muted hover:border-admin-accent hover:text-admin-accent" onClick={() => setMode('search')}>Choose {noun}</button>
              {create && <button type="button" className="rounded border border-dashed border-admin-ink/25 px-3 py-1.5 text-xs text-admin-muted hover:border-admin-accent hover:text-admin-accent" onClick={() => setMode('create')}>New {noun}</button>}
            </div>
          )}
        </>
      )}
      {mode === 'search' && (
        <div className="rounded border border-admin-ink/10 bg-white p-2">
          <input autoFocus className={inputClass} placeholder={`Search ${noun}s`} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-1 max-h-60 overflow-auto text-sm">
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" className={`block w-full rounded px-2 py-1 text-left hover:bg-admin-soft${r.id === id ? ' bg-admin-soft' : ''}`} onClick={() => pick(r)}>
                  <span className="block">{r.title}</span>
                  {summary(r) && <span className="block text-xs text-admin-muted">{summary(r)}</span>}
                </button>
              </li>
            ))}
            {!results.length && <li className="px-2 py-1 text-xs text-admin-muted">No {noun}s found.</li>}
          </ul>
          <div className="mt-2 flex gap-3">
            {create && <button type="button" className={link} onClick={() => { setDraft({ title: q }); setMode('create'); }}>New {noun}{q ? ` "${q}"` : ''}</button>}
            <button type="button" className={`${link} ml-auto`} onClick={() => setMode('view')}>Cancel</button>
          </div>
        </div>
      )}
      {mode === 'create' && create && (
        <div className="rounded border border-admin-ink/10 bg-white p-2">
          <Text title="Name" value={draft.title} onChange={(x) => setDraft({ ...draft, title: x })} />
          <FieldsForm defs={create} value={draft} onChange={(x) => setDraft({ ...draft, ...x })} />
          {error && <p className="mb-2 text-xs text-[#c4592a]">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} className="rounded-sm bg-admin-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-admin-accent disabled:opacity-50" onClick={add}>{busy ? 'Adding...' : `Add ${noun}`}</button>
            <button type="button" className={link} onClick={() => { setMode('view'); setError(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** An ordered list of entry references (mega menu featured cards). */
export function EntriesField({ title, types, value, onChange }: { title: string; types: string[]; value: unknown; onChange: (v: number[]) => void }) {
  const ids: number[] = Array.isArray(value) ? value.map(Number) : [];
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: number; title: string; type: string }[]>([]);
  useEffect(() => {
    if (!ids.length) return;
    browserClient().from('entries').select('id, title').in('id', ids).then(({ data }) => setTitles(Object.fromEntries((data ?? []).map((r) => [r.id, r.title]))));
  }, [ids.join(',')]);
  useEffect(() => {
    if (q.length < 2) return setResults([]);
    browserClient().from('entries').select('id, title, type').in('type', types).eq('status', 'publish').ilike('title', `%${q}%`).limit(8).then(({ data }) => setResults((data ?? []) as any));
  }, [q]);
  return (
    <FieldGroup title={title}>
      <ul className="mb-1 space-y-1">
        {ids.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded bg-admin-soft px-2 py-1 text-sm">
            <span className="truncate">{titles[id] ?? `#${id}`}</span>
            <button type="button" className="ml-auto text-xs text-[#c4592a]" onClick={() => onChange(ids.filter((_, j) => j !== i))}>Remove</button>
          </li>
        ))}
      </ul>
      <input className={inputClass} placeholder="Search to add" value={q} onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <ul className="mt-1 rounded border border-admin-ink/10 bg-white text-sm">
          {results.filter((r) => !ids.includes(r.id)).map((r) => (
            <li key={r.id}>
              <button type="button" className="block w-full px-2 py-1 text-left hover:bg-admin-soft" onClick={() => { onChange([...ids, r.id]); setQ(''); }}>
                {r.title} <span className="text-xs text-admin-muted">{r.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </FieldGroup>
  );
}


/** Who may see the entry (fields.access), while Members is on or once set: everyone, or members (of some levels). */
function AccessForm({ fields, onChange }: { fields: Record<string, any>; onChange: (fields: Record<string, any>) => void }) {
  const s = useMemberSettings();
  const a = accessOf(fields);
  if (!s || (!s.enabled && !a.members)) return null;
  const set = (patch: Partial<typeof a>) => {
    const next = { ...a, ...patch };
    const { access: _old, ...rest } = fields;
    onChange(next.members ? { ...rest, access: { members: true, ...(next.levels.length ? { levels: next.levels } : {}) } } : rest);
  };
  return (
    <details open={a.members} className="mt-4 border-t border-admin-ink/10 pt-3">
      <summary className="mb-2 cursor-pointer text-xs font-semibold tracking-wider text-admin-muted uppercase">Members</summary>
      <Toggle title="Members only" value={a.members} onChange={(members) => set({ members })} />
      {a.members && s.levels.length > 1 && (
        <fieldset className="mb-2">
          <legend className="mb-1 text-xs text-admin-muted">Levels (none ticked: all)</legend>
          {s.levels.map((l) => (
            <label key={l.id} className="mr-3 inline-flex items-center gap-1 text-sm">
              <input type="checkbox" checked={a.levels.includes(l.id)} onChange={(e) => set({ levels: e.target.checked ? [...a.levels, l.id] : a.levels.filter((x) => x !== l.id) })} />
              {l.name}
            </label>
          ))}
        </fieldset>
      )}
      <p className="text-xs text-admin-muted">
        {a.members
          ? 'Everyone else sees its title, excerpt and featured image with a sign-in link, and it is left out of lists and search for them. It applies when the page is published.'
          : 'Only members (and editors) can see a members-only page.'}
        {!s.enabled && ' Members is off (Settings > Members): only editors can see it now.'}
      </p>
    </details>
  );
}

export interface EntryState {
  title: string;
  slug: string;
  status: 'publish' | 'draft' | 'private';
  excerpt: string;
  template: string | null;
  featured_image: string | null;
  featured_media_id: number | null;
  fields: Record<string, any>;
  event_start: string | null;
  event_end: string | null;
  event_all_day: boolean | null;
  /** Tag names; sent on save and stored as terms of the `tag` taxonomy. */
  tags?: string[];
  /** The type's other taxonomies: chosen term ids, by taxonomy; sent on save. */
  terms?: Record<string, number[]>;
}

/**
 * An event time for the datetime-local input, in the event's timezone. A time typed in the editor is
 * already wall-clock time (no zone) and is shown as typed, whatever the browser's own timezone; a
 * stored one is a UTC timestamp, shown in `tz`.
 */
const toLocal = (v: string | null, tz: string = SITE_TZ) => {
  if (!v) return '';
  if (!/[zZ]|[+-]\d\d:\d\d$/.test(v)) return v.replace(' ', 'T').slice(0, 16);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(v)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

/** Every IANA timezone the browser knows. */
const TIMEZONES: string[] = (Intl as any).supportedValuesOf?.('timeZone') ?? [SITE_TZ];

/** Compose under the Excerpt: a suggestion from the page as it is in the editor. */
function ExcerptWriter({ type, title, pageItems, onWrite }: { type: string; title: string; pageItems?: () => any[]; onWrite: (excerpt: string) => void }) {
  const [status, setStatus] = useState('');
  const write = async () => {
    setStatus('Writing…');
    const res = await fetch('/api/admin/excerpt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, title, text: itemsText(pageItems?.()) }) });
    if (!res.ok) return setStatus(await res.text());
    onWrite((await res.json()).excerpt);
    setStatus('Excerpt written. Edit it as you like.');
  };
  return (
    <div className="-mt-2 mb-3">
      <button type="button" onClick={write} disabled={status === 'Writing…'} className="rounded-sm border border-admin-ink/20 px-3 py-1.5 text-xs font-semibold hover:border-admin-ink/50 disabled:opacity-50">
        Compose
      </button>
      {status && (
        <p className="mt-1 text-xs text-admin-muted" role="status">
          {status}
        </p>
      )}
    </div>
  );
}

export function EntryForm({ type, value, onChange, templates, pageItems }: { type: string; value: EntryState; onChange: (v: EntryState) => void; templates: TemplateInfo[]; pageItems?: () => any[] }) {
  const set = (patch: Partial<EntryState>) => onChange({ ...value, ...patch });
  const defs = fieldsFor(type);
  const site = useSite();
  const tagsShown = site !== undefined && tagsOn(site, type);
  // An event's own timezone, else the site's.
  const eventTz: string = value.fields?.timezone || SITE_TZ;
  return (
    <div className="px-1">
      <Text
        title="Title"
        value={value.title}
        onChange={(x) => {
          // The address follows the title while it is the "New ..." placeholder or empty, and while an
          // unpublished entry's address is still the one its title gave; a live address stays put.
          const follow = isPlaceholderSlug(value.slug, type) || (value.status !== 'publish' && value.slug === slugify(value.title));
          set({ title: x, ...(follow && slugify(x) ? { slug: slugify(x) } : {}) });
        }}
      />
      <Text title="Slug" value={value.slug} onChange={(x) => set({ slug: x.toLowerCase().replace(/[^a-z0-9-]+/g, '-') })} />
      {!PAGELESS_TYPES.has(type) && (
        <>
          <Select title="Template" value={value.template ?? ''} options={templates.map((t) => [t.slug, templateLabel(t)])} onChange={(x) => set({ template: x ?? null })} />
          {value.template && templates.some((t) => t.slug === value.template && !t.content) && <p className="-mt-2 mb-3 text-xs text-[#b3261e]">{NO_CONTENT_WARNING}</p>}
          {!value.template && <p className="-mt-2 mb-3 text-xs text-admin-muted">Default: the template set for this type under Settings &gt; Types.</p>}
        </>
      )}
      <Row title="Excerpt">
        <textarea className={inputClass} rows={3} value={value.excerpt} onChange={(e) => set({ excerpt: e.target.value })} />
      </Row>
      <ExcerptWriter type={type} title={value.title} pageItems={pageItems} onWrite={(excerpt) => set({ excerpt })} />
      <MediaPicker title="Featured image" url={value.featured_image ?? undefined} onSelect={(m) => set({ featured_image: m.url, featured_media_id: m.id })} />
      {taxonomiesOf(type).map((tax) => (
        <EntryTermsField key={tax} taxonomy={tax} value={value.terms?.[tax] ?? []} onChange={(ids) => set({ terms: { ...(value.terms ?? {}), [tax]: ids } })} />
      ))}
      {/* Tags, unless they're off for this type (Settings > Types); tags it already has are kept as they are. */}
      {tagsShown && <TagsField value={value.tags ?? []} onChange={(tags) => set({ tags })} />}
      {type === 'event' && (
        <>
          <Row title="Starts">
            <input type="datetime-local" className={inputClass} value={toLocal(value.event_start, eventTz)} onChange={(e) => set({ event_start: e.target.value ? `${e.target.value}:00` : null })} />
          </Row>
          <Row title="Ends">
            <input type="datetime-local" className={inputClass} value={toLocal(value.event_end, eventTz)} onChange={(e) => set({ event_end: e.target.value ? `${e.target.value}:00` : null })} />
          </Row>
          <Select
            title="Time zone"
            value={value.fields.timezone ?? ''}
            options={TIMEZONES.map((t) => [t, t.replace(/_/g, ' ')] as [string, string])}
            onChange={(tz) => {
              // The times keep their wall clock (7:00 pm stays 7:00 pm, now in the new zone).
              const fields = { ...value.fields };
              if (tz && tz !== SITE_TZ) fields.timezone = tz;
              else delete fields.timezone;
              set({ fields, event_start: value.event_start ? `${toLocal(value.event_start, eventTz)}:00` : null, event_end: value.event_end ? `${toLocal(value.event_end, eventTz)}:00` : null });
            }}
          />
          <p className="-mt-2 mb-3 text-xs text-admin-muted">Empty: the default time zone under Settings &gt; Events ({SITE_TZ.replace(/_/g, ' ')}). Choose another for this event alone; its times are in that zone, and visitors see its short name beside them.</p>
          <Toggle title="All-day event" value={value.event_all_day} onChange={(x) => set({ event_all_day: x })} />
          <RecurrenceForm
            start={toLocal(value.event_start, eventTz).slice(0, 10) || (value.event_start ?? '').slice(0, 10)}
            value={value.fields[RECURRENCE_KEY] ?? null}
            onChange={(r) => {
              const fields = { ...value.fields };
              if (r) fields[RECURRENCE_KEY] = r;
              else delete fields[RECURRENCE_KEY];
              set({ fields });
            }}
          />
        </>
      )}
      {defs.length > 0 && (
        <details open className="mt-4 border-t border-admin-ink/10 pt-3">
          <summary className="mb-2 cursor-pointer text-xs font-semibold tracking-wider text-admin-muted uppercase">Details</summary>
          <FieldsForm defs={defs} value={value.fields} onChange={(fields) => set({ fields })} />
        </details>
      )}
      {type === 'event' && (
        <details open={!!value.fields?.tickets?.types?.length} className="mt-4 border-t border-admin-ink/10 pt-3">
          <summary className="mb-2 cursor-pointer text-xs font-semibold tracking-wider text-admin-muted uppercase">Tickets</summary>
          <TicketsForm fields={value.fields} onChange={(fields) => set({ fields })} />
        </details>
      )}
      {!PAGELESS_TYPES.has(type) && <AccessForm fields={value.fields} onChange={(fields) => set({ fields })} />}
      {!PAGELESS_TYPES.has(type) && (
        <details open className="mt-4 border-t border-admin-ink/10 pt-3">
          <summary className="mb-2 cursor-pointer text-xs font-semibold tracking-wider text-admin-muted uppercase">SEO</summary>
          <SeoForm type={type} title={value.title} excerpt={value.excerpt} fields={value.fields} path={permalink({ type, slug: value.slug })} pageItems={pageItems} entry onChange={(fields) => set({ fields })} />
        </details>
      )}
    </div>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UNITS: Record<Recurrence['freq'], string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
const ORDINALS = ['first', 'second', 'third', 'fourth', 'last'];

/** Dates list edited as one Y-m-d per line. */
function DateList({ title, value, onChange }: { title: string; value: string[] | undefined; onChange: (v: string[]) => void }) {
  const [text, setText] = useState((value ?? []).join('\n'));
  return (
    <Row title={title}>
      <textarea
        className={inputClass}
        rows={2}
        placeholder="YYYY-MM-DD, one per line"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split(/[\s,]+/).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
        }}
      />
    </Row>
  );
}

/** Repeat rule for an event (stored in fields.recurrence; see lib/recurrence.ts). */
function RecurrenceForm({ start, value, onChange }: { start: string; value: Recurrence | null; onChange: (r: Recurrence | null) => void }) {
  const r = value;
  const set = (patch: Partial<Recurrence>) => onChange({ ...(r as Recurrence), ...patch });
  const first = /^\d{4}-\d{2}-\d{2}$/.test(start) ? new Date(`${start}T00:00:00Z`) : null;
  const ends = r?.until ? 'until' : r?.count ? 'count' : 'never';
  const preview = r && start && first ? occurrenceDates(start, r, `${Number(start.slice(0, 4)) + 3}${start.slice(4)}`) : [];
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <div className="mb-3 rounded border border-admin-ink/10 p-2">
      <Row title="Repeats">
        <select className={inputClass} value={r?.freq ?? ''} onChange={(e) => onChange(e.target.value ? { ...(r ?? {}), freq: e.target.value as Recurrence['freq'] } : null)}>
          <option value="">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </Row>
      {r && (
        <>
          <Row title={`Every how many ${UNITS[r.freq]}s`}>
            <input type="number" min={1} className={inputClass} value={r.interval ?? 1} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} />
          </Row>
          {r.freq === 'weekly' && (
            <div className="mb-3 flex flex-wrap gap-1">
              {WEEKDAYS.map((d, i) => {
                const days = r.byweekday?.length ? r.byweekday : first ? [first.getUTCDay()] : [];
                const on = days.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`rounded border px-2 py-1 text-xs ${on ? 'border-admin-accent bg-admin-accent text-white' : 'border-admin-ink/20'}`}
                    onClick={() => set({ byweekday: on ? days.filter((x) => x !== i) : [...days, i].sort() })}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}
          {r.freq === 'monthly' && first && (
            <Row title="On">
              <select className={inputClass} value={r.monthlyBy ?? 'date'} onChange={(e) => set({ monthlyBy: e.target.value as Recurrence['monthlyBy'] })}>
                <option value="date">Day {first.getUTCDate()} of the month</option>
                <option value="weekday">
                  The {ORDINALS[Math.min(Math.ceil(first.getUTCDate() / 7), 5) - 1]} {WEEKDAYS[first.getUTCDay()]}
                </option>
              </select>
            </Row>
          )}
          <Row title="Ends">
            <select
              className={inputClass}
              value={ends}
              onChange={(e) => {
                const { until: _u, count: _c, ...rest } = r;
                onChange(e.target.value === 'until' ? { ...rest, until: start } : e.target.value === 'count' ? { ...rest, count: 10 } : rest);
              }}
            >
              <option value="never">Never (shows two years ahead)</option>
              <option value="until">On a date</option>
              <option value="count">After a number of times</option>
            </select>
          </Row>
          {ends === 'until' && (
            <Row title="Last date">
              <input type="date" className={inputClass} value={r.until ?? ''} onChange={(e) => set({ until: e.target.value })} />
            </Row>
          )}
          {ends === 'count' && (
            <Row title="Number of times">
              <input type="number" min={1} className={inputClass} value={r.count ?? ''} onChange={(e) => set({ count: Math.max(1, Number(e.target.value) || 1) })} />
            </Row>
          )}
          <DateList title="Skip dates" value={r.exclude} onChange={(exclude) => set({ exclude })} />
          <DateList title="Extra dates" value={r.include} onChange={(include) => set({ include })} />
          {preview.length > 0 && (
            <div className="text-xs text-admin-muted">
              {preview.length} occurrence{preview.length === 1 ? '' : 's'}
              {!r.until && !r.count ? ' in the next three years' : ''}. First: {preview.slice(0, 4).map(fmt).join('; ')}
              {preview.length > 4 ? '; ...' : ''}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export { mediaUrl };

/** Tags: type to find one, Enter or comma to add (new tags are created on save). */
/**
 * Tags as a searchable multi-select: chips and a search input in one box; focusing it lists every tag
 * (typing filters), each with a check, and the list stays open to pick several. Text that isn't a tag
 * yet can be added as a new one (created on save). Arrow keys move, Enter toggles, Escape closes,
 * Backspace in an empty search removes the last tag.
 */
/** An entry's terms of one taxonomy: checkboxes, nested as in Content > Taxonomies, with a filter when there are many. */
export function EntryTermsField({ taxonomy, value, onChange }: { taxonomy: string; value: number[]; onChange: (v: number[]) => void }) {
  const [terms, setTerms] = useState<{ id: number; name: string; depth: number }[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    browserClient()
      .from('terms')
      .select('id, name, parent_id, sort')
      .eq('taxonomy', taxonomy)
      .order('sort')
      .order('name')
      .then(({ data }) => {
        const all = (data ?? []) as { id: number; name: string; parent_id: number | null }[];
        const ids = new Set(all.map((t) => t.id));
        const out: { id: number; name: string; depth: number }[] = [];
        const place = (parent: number | null, depth: number) => all.filter((t) => (t.parent_id && ids.has(t.parent_id) ? t.parent_id : null) === parent).forEach((t) => (out.push({ id: t.id, name: t.name.replace(/&amp;/g, '&'), depth }), place(t.id, depth + 1)));
        place(null, 0);
        setTerms(out);
      });
  }, [taxonomy]);
  const label = taxonomyLabel(taxonomy);
  if (!terms) return null;
  const words = q.trim().toLowerCase();
  const shown = words ? terms.filter((t) => t.name.toLowerCase().includes(words)) : terms;
  const chosen = terms.filter((t) => value.includes(t.id));
  return (
    <fieldset className="mb-3">
      <legend className="mb-1 text-xs font-medium text-admin-muted">{label}</legend>
      {!terms.length && <p className="text-xs text-admin-muted">None yet: add them under Content &gt; Taxonomies.</p>}
      {chosen.length > 0 && <p className="mb-1 text-xs text-admin-ink">{chosen.map((t) => t.name).join(', ')}</p>}
      {terms.length > 12 && <input type="search" className={`${inputClass} mb-1`} placeholder={`Find ${label.toLowerCase()}`} aria-label={`Find ${label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className={terms.length > 12 ? 'max-h-48 overflow-y-auto rounded border border-admin-ink/10 p-1' : ''}>
        {shown.map((t) => (
          <label key={t.id} className="flex items-center gap-2 py-0.5 text-sm" style={{ paddingLeft: words ? 0 : `${t.depth * 1}rem` }}>
            <input type="checkbox" checked={value.includes(t.id)} onChange={(e) => onChange(e.target.checked ? [...value, t.id] : value.filter((id) => id !== t.id))} />
            {t.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function TagsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    browserClient().from('terms').select('name').eq('taxonomy', 'tag').order('name').then(({ data }) => setAll((data ?? []).map((t) => t.name)));
  }, []);
  const key = (n: string) => n.trim().toLowerCase();
  const has = (n: string) => value.some((v) => key(v) === key(n));
  const text = q.trim().replace(/,+$/, '');
  const shown = all.filter((t) => !text || key(t).includes(key(text)));
  const canCreate = !!text && !all.some((t) => key(t) === key(text)) && !has(text);
  // Existing tags first (Enter picks the first match), then creating one from the search text.
  const options: { label: string; name: string; create?: boolean }[] = [...shown.map((t) => ({ label: t, name: t })), ...(canCreate ? [{ label: `Create "${text}"`, name: text, create: true }] : [])];
  const toggle = (name: string) => {
    onChange(has(name) ? value.filter((v) => key(v) !== key(name)) : [...value, name]);
    setQ('');
    setActive(0);
    input.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (options.length ? (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0));
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const pick = open ? options[active] : undefined;
      if (pick) toggle(pick.name);
      else if (text) toggle(text);
    } else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="relative mb-3">
      <label htmlFor={`${id}-q`} className="mb-1 block text-xs font-medium text-admin-muted">
        Tags
      </label>
      <div
        className="flex min-h-[38px] w-full flex-wrap items-center gap-1 rounded border border-admin-ink/15 bg-white px-1.5 py-1 focus-within:border-admin-accent"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            input.current?.focus();
          }
        }}
      >
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-0.5 rounded-full bg-admin-soft py-0.5 pr-0.5 pl-2.5 text-xs">
            {t}
            <button type="button" aria-label={`Remove ${t}`} className="rounded-full px-1.5 leading-none text-[#606f85] hover:text-[#c4592a]" onClick={() => toggle(t)}>
              ×
            </button>
          </span>
        ))}
        <input
          ref={input}
          id={`${id}-q`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${id}-o${active}` : undefined}
          className="min-w-[6rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none"
          placeholder={value.length ? 'Search or add' : 'Search or add tags'}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
        />
      </div>
      {open && options.length > 0 && (
        <ul id={`${id}-list`} role="listbox" aria-multiselectable="true" aria-label="Tags" className="absolute right-0 left-0 z-20 m-0 mt-1 max-h-56 list-none overflow-auto rounded border border-admin-ink/10 bg-white p-1 text-sm shadow-lg">
          {options.map((o, i) => {
            const on = !o.create && has(o.name);
            return (
              <li
                key={`${o.create ? '+' : ''}${o.name}`}
                id={`${id}-o${i}`}
                role="option"
                aria-selected={on}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 ${i === active ? 'bg-admin-soft' : ''}`}
                onMouseEnter={() => setActive(i)}
                // Keep focus in the search so the list stays open for the next pick.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggle(o.name)}
              >
                <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${on ? 'border-admin-ink bg-admin-ink text-white' : 'border-admin-ink/25'}`}>
                  {on ? '✓' : o.create ? '+' : ''}
                </span>
                <span className={o.create ? 'text-[#9c612b]' : ''}>{o.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
