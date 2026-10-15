// Settings for a collection, in plain terms: what to show, how to lay it out, which card design, and
// how to page through it. The card design and pagination replace the collection's child blocks
// (see resolveCollection in config.tsx), so editors never assemble item/pagination blocks by hand.
import { useEffect, useState, type ReactNode } from 'react';
import { Row, Select, Text, Toggle, inputClass, type Attrs } from './fields';
import { EntriesField } from './entry-fields';
import { Group, Space, StyleControls } from './panels';
import { browserClient } from '../lib/supabase-browser';
import { CARD_PRESETS } from '../lib/content/card-presets';
import { LISTABLE_TYPES, taxonomiesOf, taxonomyLabel, typeDef } from '../lib/site';

type SetFn = (patch: Attrs) => void;

const TYPES: [string, string][] = [...LISTABLE_TYPES, 'page'].map((t) => [t, typeDef(t)?.label ?? t]);
const PICKABLE = TYPES.map(([t]) => t);

const ORDERS: [string, string, Attrs][] = [
  ['newest', 'Newest first', { orderBy: 'date', order: 'desc' }],
  ['oldest', 'Oldest first', { orderBy: 'date', order: 'asc' }],
  ['az', 'Title A to Z', { orderBy: 'title', order: 'asc' }],
  ['za', 'Title Z to A', { orderBy: 'title', order: 'desc' }],
  ['menu', 'Manual order', { orderBy: 'menu_order_title', order: 'asc' }],
  ['rand', 'Random', { orderBy: 'rand', order: 'desc' }],
];
const orderKey = (q: Attrs) => ORDERS.find(([, , o]) => o.orderBy === (q.orderBy ?? 'date') && (o.orderBy === 'rand' || o.orderBy === 'menu_order_title' || o.order === (q.order ?? 'desc')))?.[0] ?? 'newest';

/** Buttons for a small set of choices. */
function Choice({ title, value, options, onChange }: { title: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="mb-3">
      <span className="mb-1 block text-xs font-medium text-admin-muted">{title}</span>
      <div className="flex overflow-hidden rounded border border-admin-ink/15">
        {options.map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange(v)} className={`flex-1 px-2 py-1.5 text-xs ${value === v ? 'bg-admin-ink text-white' : 'bg-white text-admin-ink hover:bg-admin-soft'}`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A titled group of controls (not a <label>: it holds several inputs). */
function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <span className="mb-1 block text-xs font-medium text-admin-muted">{title}</span>
      {children}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="-mt-2 mb-3 text-[11px] text-admin-muted">{children}</p>;
}

/** Terms of some taxonomies, as checkboxes (selected ids in `value`). */
export function TermPicker({ title, taxonomies, value, onChange }: { title: string; taxonomies: string[]; value: number[]; onChange: (v: number[]) => void }) {
  const [terms, setTerms] = useState<{ id: number; name: string }[]>([]);
  const key = taxonomies.join(',');
  useEffect(() => {
    if (!taxonomies.length) return setTerms([]);
    browserClient().from('terms').select('id, name').in('taxonomy', taxonomies).order('name').then(({ data }) => setTerms((data ?? []) as any));
  }, [key]);
  if (!terms.length) return null;
  const decode = (s: string) => s.replace(/&amp;/g, '&');
  return (
    <Field title={title}>
      <div className="max-h-40 overflow-auto rounded border border-admin-ink/10 bg-white p-1.5">
        {terms.map((t) => (
          <label key={t.id} className="flex items-center gap-2 py-0.5 text-sm">
            <input type="checkbox" checked={value.includes(t.id)} onChange={(e) => onChange(e.target.checked ? [...value, t.id] : value.filter((v) => v !== t.id))} />
            {decode(t.name)}
          </label>
        ))}
      </div>
    </Field>
  );
}

export function CollectionPanel({ a, set }: { a: Attrs; set: SetFn }) {
  const q: Attrs = a.query ?? {};
  const setQ = (patch: Attrs) => set({ query: { ...q, ...patch } });
  const source = q.inherit ? 'page' : Array.isArray(q.include) && q.include.length ? 'picked' : a.source === 'picked' ? 'picked' : 'latest';
  const types: string[] = Array.isArray(q.postType) ? q.postType : [q.postType ?? 'post'];
  const tax: Record<string, number[]> = q.taxQuery && !Array.isArray(q.taxQuery) && !q.taxQuery.clauses ? q.taxQuery : {};
  const setTax = (taxonomy: string, ids: number[]) => {
    const next = { ...tax, [taxonomy]: ids };
    if (!ids.length) delete next[taxonomy];
    setQ({ taxQuery: next });
  };
  const categoryTax = [...new Set(types.flatMap((t) => taxonomiesOf(t)))];
  // What renders: a grid needs a column count; without one the cards stack as a list.
  const display = a.display === 'slider' || a.variant === 'slider' ? 'slider' : a.display === 'list' || !a.columns ? 'list' : 'grid';
  const card = a.card ?? 'custom';
  const shuffled = a.shuffle === true;

  return (
    <div className="px-1">
      <Group title="Content" open>
        <Choice
          title="Show"
          value={source}
          options={[['latest', 'Latest'], ['picked', 'Hand-picked'], ['page', "Page's list"]]}
          onChange={(v) => {
            if (v === 'page') set({ source: undefined, query: { ...q, inherit: true, include: undefined } });
            else if (v === 'picked') set({ source: 'picked', query: { ...q, inherit: false } });
            else set({ source: undefined, query: { ...q, inherit: false, include: undefined } });
          }}
        />
        {source === 'page' && <Hint>Lists what the page is showing: an archive, a category or tag, or search results.</Hint>}
        {source === 'picked' && <EntriesField title="Entries, in order" types={PICKABLE} value={q.include} onChange={(ids) => setQ({ include: ids })} />}
        {source === 'latest' && (
          <>
            <Field title="Content types">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {TYPES.map(([t, l]) => (
                  <label key={t} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={types.includes(t)}
                      onChange={(e) => {
                        const next = e.target.checked ? [...types, t] : types.filter((x) => x !== t);
                        if (next.length) setQ({ postType: next.length === 1 ? next[0] : next });
                      }}
                    />
                    {l}
                  </label>
                ))}
              </div>
            </Field>
            {categoryTax.map((taxonomy) => (
              <TermPicker key={taxonomy} title={`${taxonomyLabel(taxonomy)} (any of)`} taxonomies={[taxonomy]} value={tax[taxonomy] ?? []} onChange={(ids) => setTax(taxonomy, ids)} />
            ))}
            <TermPicker title="Tagged with (any of)" taxonomies={['tag']} value={tax.tag ?? []} onChange={(ids) => setTax('tag', ids)} />
            {types.length === 1 && types[0] === 'event' && <Toggle title="Upcoming events only (soonest first)" value={q.upcoming} onChange={(v) => setQ({ upcoming: v || undefined })} />}
            <Select title="Order" value={orderKey(q)} options={ORDERS.map(([k, l]) => [k, l])} onChange={(v) => setQ({ ...(ORDERS.find(([k]) => k === (v ?? 'newest'))![2]) })} />
            <div className="grid grid-cols-2 gap-2">
              <Text title="How many" value={q.perPage} placeholder="10" onChange={(v) => setQ({ perPage: Number(v) || undefined })} />
              <Text title="Skip the first" value={q.offset} placeholder="0" onChange={(v) => setQ({ offset: Number(v) || undefined })} />
            </div>
          </>
        )}
        {source !== 'page' && (
          <>
            <Toggle
              title="Shuffle on each visit"
              value={shuffled}
              onChange={(v) => set({ shuffle: v || undefined })}
            />
            {shuffled && <Hint>{source === 'picked' ? 'The picked entries show in a random order.' : `Shows ${q.perPage || 10} picked at random from the first 48 matching entries, different on each visit.`}</Hint>}
          </>
        )}
      </Group>

      <Group title="Layout" open>
        <Choice title="Display" value={display} options={[['grid', 'Grid'], ['list', 'List'], ['slider', 'Slider']]} onChange={(v) => set({ display: v, variant: undefined, ...(v !== 'list' && !a.columns ? { columns: 3 } : {}) })} />
        {display !== 'list' && (
          <div className="grid grid-cols-3 gap-2">
            <Text title={display === 'slider' ? 'Per view' : 'Columns'} value={a.columns} placeholder="3" onChange={(v) => set({ columns: Number(v) || undefined })} />
            {display === 'grid' && <Text title="Tablet" value={a.columnsTablet} placeholder={String(a.columns ?? 3)} onChange={(v) => set({ columnsTablet: Number(v) || undefined })} />}
            {display === 'grid' && <Text title="Phone" value={a.columnsMobile} placeholder="1" onChange={(v) => set({ columnsMobile: Number(v) || undefined })} />}
          </div>
        )}
        {display !== 'slider' && <Space title="Space between cards" value={a.itemGap} onChange={(v) => set({ itemGap: v })} />}
        {display === 'grid' && <Toggle title="Cards in a row as tall as the tallest" value={a.equalHeight !== false} onChange={(v) => set({ equalHeight: v ? undefined : false })} />}
      </Group>

      <Group title="Card" open>
        <Row title="Card design">
          <select className={inputClass} value={card} onChange={(e) => set({ card: e.target.value })}>
            {CARD_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom (edit the card's blocks)</option>
          </select>
        </Row>
        <Hint>{card === 'custom' ? 'Select the blocks inside the first card on the page to change them; every card follows.' : CARD_PRESETS.find((p) => p.id === card)?.description}</Hint>
      </Group>

      {display !== 'slider' && (
        <Group title="Paging" open>
          {!shuffled && <Select title="Pagination" value={a.pagination ?? 'none'} options={[['none', 'None'], ['numbers', 'Page numbers'], ['prev-next', 'Previous and next'], ['load-more', 'Load more button']]} onChange={(v) => set({ pagination: v === 'none' ? undefined : v })} />}
          <Text title="Message when there is nothing to show" value={a.emptyText} placeholder="(nothing)" onChange={(v) => set({ emptyText: v || undefined })} />
        </Group>
      )}

      <Group title="Appearance">
        <StyleControls a={a} set={set} />
      </Group>
    </div>
  );
}
