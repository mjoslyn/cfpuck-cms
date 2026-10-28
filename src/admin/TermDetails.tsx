// Content > Taxonomies: a term's details, opened by its Details button: description, featured image,
// the taxonomy's own fields (site config) and SEO. Compose (/api/admin/meta-compose) fills the
// description, SEO and the fields with a `compose` hint for review. Saved with PUT /api/admin/terms.
import { useEffect, useRef, useState } from 'react';
import { FieldsForm } from '../puck/entry-fields';
import { MediaPicker, inputClass } from '../puck/fields';
import { SeoForm } from '../puck/SeoForm';
import { termFieldsFor } from '../lib/page-meta';
import { taxonomySingular } from '../lib/site';

interface TermRow {
  id: number;
  taxonomy: string;
  name: string;
  slug: string;
  description: string;
  fields: Record<string, any>;
  link: string | null;
}

export default function TermDetails({ taxonomy }: { taxonomy: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  // The term last asked for: a slower answer for an earlier click is dropped.
  const wanted = useRef('');
  const [term, setTerm] = useState<TermRow | null>(null);
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [writing, setWriting] = useState(false);
  const defs = termFieldsFor(taxonomy);

  // Any Details button on the page opens its term.
  useEffect(() => {
    const open = async (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-term-details]');
      if (!btn) return;
      const id = btn.dataset.termDetails ?? '';
      wanted.current = id;
      setStatus('');
      setNotes('');
      setTerm(null);
      if (!ref.current?.open) ref.current?.showModal();
      const res = await fetch(`/api/admin/terms?id=${id}`);
      const body = res.ok ? await res.json() : await res.text();
      if (wanted.current !== id) return;
      if (!res.ok) return setStatus(body);
      setTerm(body);
    };
    document.addEventListener('click', open);
    return () => document.removeEventListener('click', open);
  }, []);

  const set = (patch: Partial<TermRow>) => term && setTerm({ ...term, ...patch });
  // Fill the form from Claude: description, search title and meta description, composable fields.
  const write = async () => {
    if (!term) return;
    const id = String(term.id);
    setWriting(true);
    setStatus('Writing…');
    try {
      const res = await fetch('/api/admin/meta-compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taxonomy, id: term.id, notes, current: { description: term.description } }) });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      if (wanted.current !== id) return;
      setTerm((t) => {
        if (!t) return t;
        const f = t.fields ?? {};
        const seo = { ...(f.seo ?? {}), ...(out.seo.title ? { title: out.seo.title } : {}), ...(out.seo.description ? { description: out.seo.description } : {}) };
        delete seo.generated;
        return { ...t, description: out.description || t.description, fields: { ...f, ...out.fields, seo } };
      });
      setStatus('Filled in by Claude: check it, then Save.');
    } catch (e) {
      setStatus(`Not written: ${(e as Error).message}`);
    }
    setWriting(false);
  };
  const save = async () => {
    if (!term) return;
    setStatus('Saving…');
    const f = term.fields ?? {};
    const res = await fetch('/api/admin/terms', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: term.id, taxonomy, description: term.description, image: f.image, image_url: f.image_url, seo: f.seo, fields: f }),
    });
    if (!res.ok) return setStatus(`Not saved: ${await res.text()}`);
    setStatus('Saved.');
    ref.current?.close();
  };

  const f = term?.fields ?? {};
  return (
    <dialog ref={ref} aria-labelledby="term-details-title" className="m-auto max-h-[90vh] w-[min(40rem,95vw)] rounded-sm p-0 shadow-xl backdrop:bg-black/40">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-admin-ink/10 bg-white px-5 py-3">
        <h2 id="term-details-title" className="truncate text-base font-semibold">
          {term ? term.name.replace(/&#8217;/g, '’').replace(/&#038;|&amp;/g, '&') : taxonomySingular(taxonomy)}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {status && (
            <span className="text-xs text-admin-muted" role="status">
              {status}
            </span>
          )}
          <button type="button" onClick={() => ref.current?.close()} className="rounded-sm border border-admin-ink/20 px-3 py-1 text-xs">
            Cancel
          </button>
          <button type="button" disabled={!term} onClick={save} className="rounded-sm bg-admin-ink px-3 py-1 text-xs font-semibold tracking-wider text-white uppercase hover:bg-admin-accent disabled:opacity-40">
            Save
          </button>
        </div>
      </div>
      {!term ? (
        <p className="p-5 text-sm text-admin-muted">{status || 'Loading…'}</p>
      ) : (
        <div className="space-y-5 p-5 text-sm">
          <section className="rounded-sm border border-admin-ink/10 bg-[#f8fafc] p-3">
            <label className="mb-1 block text-xs font-semibold tracking-wider text-admin-muted uppercase" htmlFor="term-notes">
              Compose
            </label>
            <textarea id="term-notes" rows={2} className={inputClass} placeholder="Anything Claude should know (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="mt-2 flex items-center gap-3">
              <button type="button" disabled={writing} onClick={write} className="shrink-0 rounded-sm border border-admin-ink/20 bg-white px-3 py-1.5 text-xs font-semibold whitespace-nowrap hover:border-admin-ink/50 disabled:opacity-40">
                {writing ? 'Writing…' : 'Compose'}
              </button>
              <span className="text-xs text-admin-muted">Fills in the description, search title, meta description{defs.some((d) => 'compose' in d && d.compose) ? ' and fields' : ''} from the {taxonomySingular(taxonomy).toLowerCase()}'s name and what is filed under it. Nothing is saved until you Save.</span>
            </div>
          </section>
          <section>
            <label className="mb-1 block text-xs font-semibold tracking-wider text-admin-muted uppercase" htmlFor="term-description">
              Description
            </label>
            <textarea id="term-description" rows={4} className={inputClass} value={term.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
            <p className="mt-1 text-xs text-admin-muted">Shown by the Excerpt block on its page, and the meta description when SEO has none.</p>
          </section>
          <section>
            <MediaPicker title="Featured image" url={f.image_url} onSelect={(m) => set({ fields: { ...f, image: m.id ?? m.mediaId ?? undefined, image_url: m.url } })} />
            <p className="-mt-2 text-xs text-admin-muted">Shown by the Featured image block on its page, and when it is shared. Without one, the taxonomy's (Settings &gt; Types) is used.</p>
            {!!f.image && (
              <button type="button" className="mt-1 text-xs text-[#b3261e]" onClick={() => set({ fields: { ...f, image: undefined, image_url: undefined } })}>
                Remove featured image
              </button>
            )}
          </section>
          {defs.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wider text-admin-muted uppercase">Fields</h3>
              <FieldsForm defs={defs} value={f} onChange={(v) => set({ fields: v })} />
            </section>
          )}
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-admin-muted uppercase">SEO</h3>
            <SeoForm type={taxonomySingular(taxonomy)} title={term.name} excerpt={term.description ?? ''} fields={f} path={term.link ?? ''} onChange={(v) => set({ fields: v })} />
            <p className="mt-1 text-xs text-admin-muted">When empty: the search title is the taxonomy's (Settings &gt; Types), else the term's name; the meta description is the term's description, else the taxonomy's; the share image is the term's featured image, else the taxonomy's.</p>
          </section>
        </div>
      )}
    </dialog>
  );
}
