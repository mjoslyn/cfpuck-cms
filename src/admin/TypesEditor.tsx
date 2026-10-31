// The types editor (Settings > Types): every content type, with its address, listing page and fields.
// Types defined in the site's code (src/site/config.ts) open read-only, with a note that they are changed
// there; the code's win over one made here with the same name. Admins add types and change or delete the
// ones made here (POST /api/admin/types, saved at once; the page reloads to use them).
import { useState } from 'react';
import { CODE_TYPES, CONTENT_TYPES, MADE_TYPES, taxonomiesOf, taxonomyLabel, typeDef } from '../lib/site';
import { FIELD_KINDS, type FieldKind } from '../lib/site/type-settings';
import { showsType } from '../lib/events/on';
import type { FieldDef } from '../lib/site';

/** A field as the form edits it: select options as lines. */
interface FieldRow {
  key?: string;
  label: string;
  type: FieldKind;
  options: string;
  compose: boolean;
}
interface Draft {
  type?: string;
  label: string;
  singular: string;
  record: boolean;
  base: string;
  archive: string;
  describe: string;
  order: 'date' | 'title';
  fields: FieldRow[];
}

const blank: Draft = { label: '', singular: '', record: false, base: '', archive: '', describe: '', order: 'date', fields: [] };
const kindLabel = (k: string) => FIELD_KINDS.find(([v]) => v === k)?.[1] ?? k;
const trim = (s?: string) => (s ?? '').replace(/^\/+|\/+$/g, '');

function draftOf(type: string): Draft {
  const t = MADE_TYPES.find((m) => m.type === type);
  if (!t) return blank;
  return {
    type: t.type,
    label: t.label,
    singular: t.singular,
    record: !!t.record,
    base: t.base ?? '',
    archive: t.archive ?? '',
    describe: t.describe ?? '',
    order: t.order ?? 'date',
    fields: t.fields.map((f) => ({ key: f.key, label: f.label, type: f.type as FieldKind, options: f.type === 'select' ? f.options.map(([v, l]) => (v === l ? v : `${v} | ${l}`)).join('\n') : '', compose: 'compose' in f && !!f.compose })),
  };
}

/** What the API takes: select options from their lines ("value" or "value | label"). */
const payload = (d: Draft) => ({
  ...d,
  fields: d.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    compose: f.compose ? f.label.toLowerCase() : undefined,
    options: f.type === 'select' ? f.options.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter(([v]) => v).map(([v, l]) => [v, l || v]) : undefined,
  })),
});

export default function TypesEditor({ events }: { events: boolean }) {
  const [open, setOpen] = useState<{ type?: string; code: boolean } | null>(null);
  const isCode = (type: string) => CODE_TYPES.some((t) => t.type === type);
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Content types</h3>
        <button type="button" className="rounded border border-admin-ink/15 bg-white px-3 py-1 text-xs hover:border-admin-accent" onClick={() => setOpen({ code: false })}>
          Add a type
        </button>
      </div>
      <p className="mb-3 text-xs text-admin-muted">The kinds of content the site has. Types defined in the site's code are changed there; add your own here, with the details each entry keeps.</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-admin-muted">
            <th className="py-1 pr-4 font-normal">Type</th>
            <th className="py-1 pr-4 font-normal">Address</th>
            <th className="py-1 pr-4 font-normal">Details</th>
            <th className="py-1 font-normal"><span className="sr-only">Edit</span></th>
          </tr>
        </thead>
        <tbody>
          {CONTENT_TYPES.filter((t) => showsType(t.type, events)).map((t) => {
            const code = isCode(t.type);
            return (
              <tr key={t.type} className="border-t border-admin-ink/10 align-top">
                <td className="py-2 pr-4">
                  <span className="font-medium">{t.label}</span>
                  <span className="block text-xs text-admin-muted">{code ? 'Defined in the site’s code' : 'Made here'}</span>
                </td>
                <td className="py-2 pr-4 text-xs text-admin-muted">
                  {t.record || t.pageless ? 'No pages (data only)' : <span className="font-mono">{t.base ? `/${t.base}/<slug>/` : '/<slug>/'}</span>}
                  {t.archive && <span className="block">Listing: <span className="font-mono">{t.archive}</span></span>}
                </td>
                <td className="py-2 pr-4 text-xs text-admin-muted">{(t.fields ?? []).map((f) => f.label).join(', ') || 'None'}</td>
                <td className="py-2 text-right">
                  <button type="button" className="text-xs text-admin-ink hover:text-admin-accent" onClick={() => setOpen({ type: t.type, code })}>
                    {code ? 'View' : 'Edit'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {open && (open.code ? <CodeType type={open.type!} onClose={() => setOpen(null)} /> : <TypeForm initial={open.type ? draftOf(open.type) : blank} onClose={() => setOpen(null)} />)}
    </section>
  );
}

function Dialog({ title, onClose, children, onSubmit }: { title: string; onClose: () => void; children: React.ReactNode; onSubmit?: (e: React.FormEvent) => void }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-admin-ink/40 p-4 sm:items-center" onClick={onClose}>
      <form className="w-[min(40rem,100%)] rounded bg-white p-5 text-left text-sm shadow-xl" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()} onSubmit={onSubmit ?? ((e) => e.preventDefault())}>
        <h2 className="mb-3 text-base font-medium">{title}</h2>
        {children}
      </form>
    </div>
  );
}

/** A type the site's code defines: shown as it is, with where to change it. */
function CodeType({ type, onClose }: { type: string; onClose: () => void }) {
  const t = typeDef(type)!;
  const fields: FieldDef[] = t.fields ?? [];
  return (
    <Dialog title={t.label} onClose={onClose}>
      <p className="mb-3 rounded bg-admin-soft px-3 py-2 text-xs text-admin-ink" role="note">
        This type is defined in the site’s code (<span className="font-mono">src/site/config.ts</span>), so it can’t be changed here. Ask whoever builds the site to change it. A type made here with the same name is left out.
      </p>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-admin-muted">Name in the code</dt><dd className="font-mono">{t.type}</dd>
        <dt className="text-admin-muted">One of them</dt><dd>{t.singular}</dd>
        <dt className="text-admin-muted">Address</dt><dd className="font-mono">{t.record || t.pageless ? 'No pages (data only)' : t.base ? `/${t.base}/<slug>/` : '/<slug>/'}</dd>
        {t.archive && (<><dt className="text-admin-muted">Listing page</dt><dd className="font-mono">{t.archive}</dd></>)}
        {taxonomiesOf(t.type).length > 0 && (<><dt className="text-admin-muted">Taxonomies</dt><dd>{taxonomiesOf(t.type).map(taxonomyLabel).join(', ')}</dd></>)}
        {t.describe && (<><dt className="text-admin-muted">For Compose</dt><dd>{t.describe}</dd></>)}
      </dl>
      <h3 className="mt-4 mb-1 text-xs font-semibold tracking-wider text-admin-muted uppercase">Details</h3>
      {fields.length ? (
        <ul className="text-xs">{fields.map((f) => <li key={f.key}>{f.label} <span className="text-admin-muted">({kindLabel(f.type)})</span></li>)}</ul>
      ) : (
        <p className="text-xs text-admin-muted">None.</p>
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" className="rounded border border-admin-ink/15 px-3 py-1.5 text-xs" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

/** Add a type, or change one made here. */
function TypeForm({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setField = (i: number, patch: Partial<FieldRow>) => set({ fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const move = (i: number, by: number) => {
    const next = [...d.fields];
    const [f] = next.splice(i, 1);
    next.splice(i + by, 0, f);
    set({ fields: next });
  };
  const post = async (body: unknown) => {
    setBusy(true);
    setError('');
    const res = await fetch('/api/admin/types', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (res?.ok) return location.reload();
    setError((res && ((await res.json().catch(() => null))?.error as string)) || 'Couldn’t save it. Try again.');
  };
  const field = 'w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent';
  const label = 'mb-1 block text-xs font-medium text-admin-muted';
  return (
    <Dialog title={initial.type ? `Edit ${initial.label}` : 'Add a type'} onClose={onClose} onSubmit={(e) => (e.preventDefault(), post({ action: 'save', ...payload(d) }))}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className={label}>Name (plural)</span><input className={field} required autoFocus value={d.label} placeholder="Products" onChange={(e) => set({ label: e.target.value })} /></label>
        <label><span className={label}>One of them</span><input className={field} required value={d.singular} placeholder="Product" onChange={(e) => set({ singular: e.target.value })} /></label>
      </div>
      <fieldset className="mt-3">
        <legend className={label}>Pages</legend>
        <label className="mr-4 inline-flex items-center gap-1.5"><input type="radio" checked={!d.record} onChange={() => set({ record: false })} /> Each has a page</label>
        <label className="inline-flex items-center gap-1.5"><input type="radio" checked={d.record} onChange={() => set({ record: true })} /> Data only, no pages (like venues)</label>
      </fieldset>
      {!d.record && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>
            <span className={label}>Address its pages start with</span>
            <input className={`${field} font-mono`} value={d.base} placeholder="products" onChange={(e) => set({ base: e.target.value })} onBlur={() => set({ base: trim(d.base) })} />
            <span className="mt-1 block text-xs text-admin-muted">{trim(d.base) ? `/${trim(d.base)}/<slug>/` : 'Empty: /<slug>/, like pages.'}</span>
          </label>
          <label>
            <span className={label}>Listing page (optional)</span>
            <input className={`${field} font-mono`} value={d.archive} placeholder="all-products" onChange={(e) => set({ archive: e.target.value })} onBlur={() => set({ archive: trim(d.archive) })} />
            <span className="mt-1 block text-xs text-admin-muted">{trim(d.archive) ? `/${trim(d.archive)}/ lists them all.` : 'Empty: no listing page.'}</span>
          </label>
        </div>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_12rem]">
        <label><span className={label}>What one is, for Compose (optional)</span><input className={field} value={d.describe} placeholder="a product we sell, with its price and sizes" onChange={(e) => set({ describe: e.target.value })} /></label>
        <label>
          <span className={label}>Listed</span>
          <select className={field} value={d.order} onChange={(e) => set({ order: e.target.value as Draft['order'] })}>
            <option value="date">Newest first</option>
            <option value="title">By name</option>
          </select>
        </label>
      </div>

      <h3 className="mt-5 mb-1 text-xs font-semibold tracking-wider text-admin-muted uppercase">Details each one keeps</h3>
      <p className="mb-2 text-xs text-admin-muted">Shown under Details in each entry’s settings, and by the Field block on its pages and cards.</p>
      {d.fields.map((f, i) => (
        <div key={i} className="mb-2 rounded border border-admin-ink/10 p-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
            <input className={field} aria-label="Field name" placeholder="Price" required value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
            <select className={field} aria-label="Kind" value={f.type} onChange={(e) => setField(i, { type: e.target.value as FieldKind })}>
              {FIELD_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="flex items-center gap-2 text-xs">
              <button type="button" disabled={i === 0} className="text-admin-muted disabled:opacity-30" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
              <button type="button" disabled={i === d.fields.length - 1} className="text-admin-muted disabled:opacity-30" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="text-[#c4592a]" onClick={() => set({ fields: d.fields.filter((_, j) => j !== i) })}>Remove</button>
            </span>
          </div>
          {f.type === 'select' && <textarea className={`${field} mt-2`} rows={3} required aria-label="Choices" placeholder={'One choice a line\nsmall\nlarge | Large (12 oz)'} value={f.options} onChange={(e) => setField(i, { options: e.target.value })} />}
          <label className="mt-1 flex items-center gap-1.5 text-xs text-admin-muted"><input type="checkbox" checked={f.compose} onChange={(e) => setField(i, { compose: e.target.checked })} /> Compose may fill it from the materials it is given</label>
          {f.key && <span className="block text-xs text-admin-muted">Kept as <span className="font-mono">{f.key}</span></span>}
        </div>
      ))}
      <button type="button" className="rounded border border-admin-ink/15 bg-white px-3 py-1 text-xs hover:border-admin-accent" onClick={() => set({ fields: [...d.fields, { label: '', type: 'text', options: '', compose: false }] })}>Add a detail</button>
      <p className="mt-3 text-xs text-admin-muted">Taxonomies for it are chosen under Content &gt; Taxonomies; Featured, its templates and listing page further down this screen.</p>

      {error && <p className="mt-3 rounded bg-admin-soft px-2 py-1.5 text-xs text-admin-ink" role="alert">{error}</p>}
      <div className="mt-4 flex items-center justify-between gap-3">
        {initial.type ? (
          <button type="button" disabled={busy} className="text-xs text-[#c4592a] hover:underline" onClick={() => window.confirm(`Delete the type "${initial.label}"? Only a type no entry uses can be deleted.`) && post({ action: 'delete', type: initial.type })}>Delete this type</button>
        ) : <span />}
        <span className="flex gap-2">
          <button type="button" className="rounded border border-admin-ink/15 px-3 py-1.5 text-xs" onClick={onClose}>Cancel</button>
          <button disabled={busy} className="rounded-sm bg-admin-ink px-4 py-2 text-xs font-semibold tracking-wider text-white uppercase hover:bg-admin-accent disabled:opacity-50">{busy ? 'Saving…' : initial.type ? 'Save' : 'Add type'}</button>
        </span>
      </div>
    </Dialog>
  );
}
