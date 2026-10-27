// Media library detail panel: alt text, title, caption, and the focal point (click or drag on the
// image). Crop previews show how the image fills common shapes; each shape can use another image instead
// (crop_images), shown wherever this one is cropped to that shape; with that shape chosen, clicks set the
// focal point for that use (kept with this image; the other image's own are untouched). Opens on
// `cms:media-open` events.
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserClient } from '../lib/db/browser';
import { mediaUrl } from '../lib/media/image';
import type { Media } from '../lib/types';
import { SHAPES, position, ratioLabel, smallFor, type Point } from '../lib/media/focal';
import { MediaModal } from '../puck/fields';
import { describable } from '../lib/media/alt-text';

const input = 'w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent';
const label = 'mb-1 block text-xs font-medium text-admin-muted';

type Row = Media & { processed_at?: string | null };
/** Another image used for a crop shape, and the focal point for that use. */
type Swap = { id: number; focal?: Point };

export default function MediaDetail() {
  const [m, setM] = useState<Row | null>(null);
  const [draft, setDraft] = useState<{ alt: string; title: string; caption: string; focal: Point | null; crops: Record<string, Point>; swaps: Record<string, Swap> }>({ alt: '', title: '', caption: '', focal: null, crops: {}, swaps: {} });
  // The images other shapes use (for their previews), by id.
  const [others, setOthers] = useState<Record<number, Row>>({});
  // The shape whose other image is being picked.
  const [choosing, setChoosing] = useState<string | null>(null);
  const loadOthers = async (ids: number[]) => {
    if (!ids.length) return;
    const { data } = await browserClient().from('media').select('*').in('id', ids);
    setOthers((o) => ({ ...o, ...Object.fromEntries(((data ?? []) as Row[]).map((r) => [r.id, r])) }));
  };
  // Which point clicks on the image set: the main one, or a crop shape's own.
  const [editing, setEditing] = useState<string>('main');
  const [status, setStatus] = useState('');
  // Alt text from Claude (Generate): under way, or what went wrong.
  const [writing, setWriting] = useState(false);
  const [altNote, setAltNote] = useState('');
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const open = async (e: Event) => {
      const id = (e as CustomEvent<number>).detail;
      setStatus('');
      setAltNote('');
      const { data } = await browserClient().from('media').select('*').eq('id', id).single();
      if (!data) return;
      setM(data as Row);
      setDraft({ alt: data.alt ?? '', title: data.title ?? '', caption: data.caption ?? '', focal: data.focal_point ?? null, crops: data.crop_focals ?? {}, swaps: data.crop_images ?? {} });
      setEditing('main');
      loadOthers(Object.values((data.crop_images ?? {}) as Record<string, Swap>).map((c) => c.id));
    };
    window.addEventListener('cms:media-open', open);
    document.body.dataset.mediaReady = '1';
    return () => window.removeEventListener('cms:media-open', open);
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setM(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const pick = useCallback((e: { clientX: number; clientY: number }) => {
    const r = frame.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const p = { x: +x.toFixed(3), y: +y.toFixed(3) };
    // A shape that uses another image: the point is for that use, kept with the swap.
    setDraft((d) => (editing === 'main' ? { ...d, focal: p } : d.swaps[editing] ? { ...d, swaps: { ...d.swaps, [editing]: { ...d.swaps[editing], focal: p } } } : { ...d, crops: { ...d.crops, [editing]: p } }));
  }, [editing]);

  if (!m) return null;
  const src = mediaUrl((m.sizes?.large ?? m.sizes?.medium_large ?? m).path);
  const focal = draft.focal ?? { x: 0.5, y: 0.5 };
  const pointFor = (key: string) => draft.crops[key] ?? focal;
  const other = (key: string) => (draft.swaps[key] ? others[draft.swaps[key].id] : undefined);
  const otherSrc = (r: Row) => mediaUrl((r.sizes?.large ?? r.sizes?.medium_large ?? r).path);
  /** The focal point for a shape's other image: the one set for this use, else that image's own. */
  const otherPoint = (key: string, r: Row) => draft.swaps[key]?.focal ?? r.crop_focals?.[key] ?? r.focal_point ?? { x: 0.5, y: 0.5 };
  const editingOther = editing !== 'main' ? other(editing) : undefined;
  const marker = editing === 'main' ? focal : editingOther ? otherPoint(editing, editingOther) : pointFor(editing);
  const focusChanged = JSON.stringify(draft.focal) !== JSON.stringify(m.focal_point ?? null) || JSON.stringify(draft.crops) !== JSON.stringify(m.crop_focals ?? {});
  const swapsChanged = JSON.stringify(draft.swaps) !== JSON.stringify(m.crop_images ?? {});
  const changed = draft.alt !== (m.alt ?? '') || draft.title !== (m.title ?? '') || draft.caption !== (m.caption ?? '') || focusChanged || swapsChanged;
  const formats = Object.keys(m.formats ?? {});

  /** Alt text written by Claude from the image, into the form (saved with Save). */
  const generateAlt = async () => {
    if (!m) return;
    setWriting(true);
    setAltNote('');
    const res = await fetch('/api/admin/media/describe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }) }).catch(() => null);
    setWriting(false);
    if (!res?.ok) return setAltNote(res ? await res.text() : 'No connection.');
    const { alt } = await res.json();
    setDraft((d) => ({ ...d, alt }));
    setAltNote('Written by Claude: check it, then Save.');
  };
  const save = async () => {
    setStatus(focusChanged ? 'Saving and re-cropping thumbnails...' : 'Saving...');
    const res = await fetch(`/api/admin/media/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alt: draft.alt, title: draft.title, caption: draft.caption, focal_point: draft.focal, crop_focals: draft.crops, crop_images: draft.swaps }) });
    if (!res.ok) return setStatus(await res.text());
    setM(await res.json());
    setStatus('Saved');
  };

  return (
    <>
    {choosing && (
      <MediaModal
        only="image"
        onClose={() => setChoosing(null)}
        onSelect={(p) => {
          const id = Number(p.id ?? p.mediaId);
          if (id && id !== m.id) {
            setDraft((d) => ({ ...d, swaps: { ...d.swaps, [choosing]: { id } } }));
            loadOthers([id]);
          }
          setChoosing(null);
        }}
      />
    )}
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-admin-ink/50 p-6" onClick={() => setM(null)}>
      <div className="flex max-h-full w-full max-w-5xl overflow-hidden rounded bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-admin-soft p-4">
          {editingOther && (
            <p className="mb-2 rounded bg-white px-2 py-1 text-xs text-admin-muted">
              The {SHAPES.find((x) => x.key === editing)?.name.toLowerCase()} crop uses another image. Click it to set its focal point for this crop; it applies only here.
            </p>
          )}
          <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
            <span className="mr-1 text-admin-muted">Click the image to set the focal point for</span>
            {[{ key: 'main', name: 'All crops' }, ...SHAPES].map((s) => (
              <button key={s.key} type="button" onClick={() => setEditing(s.key)} className={`rounded px-2 py-0.5 ${editing === s.key ? 'bg-admin-ink text-white' : 'bg-white text-admin-ink hover:bg-[#e5e1dc]'}`}>
                {s.name}
                {s.key !== 'main' && <span className="ml-1 opacity-60">{ratioLabel(s.key)}</span>}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center justify-center">
            <div
              ref={frame}
              className="relative cursor-crosshair select-none"
              onMouseDown={(e) => {
                dragging.current = true;
                pick(e);
              }}
              onMouseMove={(e) => dragging.current && pick(e)}
              onMouseUp={() => (dragging.current = false)}
              onMouseLeave={() => (dragging.current = false)}
            >
              <img src={editingOther ? otherSrc(editingOther) : src} alt="" draggable={false} className="block max-h-[50vh] max-w-full" />
              <span
                className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(26,26,46,0.6),inset_0_0_0_2px_rgba(26,26,46,0.6)]"
                style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
              />
            </div>
          </div>
          <div className="mt-4 grid shrink-0 grid-cols-4 items-start gap-3">
            {SHAPES.map((s) => {
              const o = other(s.key);
              // The image that fills this shape (another one, if it uses one), against the shape's best size.
              const used = o ?? m;
              const small = smallFor(s, used.width, used.height);
              return (
                <figure key={s.key} className="m-0">
                  <button type="button" onClick={() => setEditing(s.key)} className={`mx-auto block rounded ${editing === s.key ? 'ring-2 ring-admin-accent ring-offset-2' : ''}`}>
                    <img
                      src={o ? otherSrc(o) : src}
                      alt=""
                      className="block h-24 max-w-full rounded object-cover"
                      style={{ aspectRatio: s.key.replace('/', ' / '), objectPosition: position(o ? otherPoint(s.key, o) : pointFor(s.key)) }}
                    />
                  </button>
                  <figcaption className="mt-1 text-center text-[11px] text-admin-muted">
                    {draft.swaps[s.key] ? (
                      <>
                        {s.name}
                        <button type="button" className="ml-1 underline" onClick={() => setDraft({ ...draft, swaps: Object.fromEntries(Object.entries(draft.swaps).filter(([k]) => k !== s.key)) })}>
                          Remove
                        </button>
                      </>
                    ) : (
                      <>
                        {s.name} · {draft.crops[s.key] ? 'own point' : 'main point'}
                        {draft.crops[s.key] && (
                          <button type="button" className="ml-1 underline" onClick={() => setDraft({ ...draft, crops: Object.fromEntries(Object.entries(draft.crops).filter(([k]) => k !== s.key)) })}>
                            reset
                          </button>
                        )}
                      </>
                    )}
                    <span className={`block ${small ? 'text-[#a3441c]' : ''}`} title={`${s.name} crops are ${ratioLabel(s.key)}. An image at least ${s.best[0]} × ${s.best[1]} fills them sharply.`}>
                      {ratioLabel(s.key)} · {s.best[0]} × {s.best[1]} or larger
                      {small ? ' (this one is smaller)' : ''}
                    </span>
                    <button type="button" className="mt-0.5 block w-full text-admin-accent hover:underline" onClick={() => setChoosing(s.key)}>
                      {draft.swaps[s.key] ? 'Use a different image' : 'Use another image'}
                    </button>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </div>
        <aside className="w-80 shrink-0 overflow-y-auto p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <p className="text-sm font-medium break-all">{m.path.split('/').pop()}</p>
            <button type="button" className="text-sm text-admin-muted hover:text-admin-ink" onClick={() => setM(null)}>
              Close
            </button>
          </div>
          <div className="mb-3">
            <div className="mb-1 flex items-end justify-between gap-2">
              <label htmlFor="media-alt" className="block text-xs font-medium text-admin-muted">
                Alt text (describes the image for screen readers)
              </label>
              {describable(m) && (
                <button type="button" onClick={generateAlt} disabled={writing} className="shrink-0 rounded border border-admin-ink/15 bg-white px-2 py-0.5 text-xs hover:border-admin-accent hover:text-admin-accent disabled:opacity-50" title="Claude looks at the image and writes a description">
                  {writing ? 'Writing…' : 'Generate'}
                </button>
              )}
            </div>
            <textarea id="media-alt" className={input} rows={3} value={draft.alt} onChange={(e) => setDraft({ ...draft, alt: e.target.value })} />
            {altNote && (
              <p className="mt-1 text-xs text-admin-muted" role="status">
                {altNote}
              </p>
            )}
          </div>
          <label className="mb-3 block">
            <span className={label}>Title</span>
            <input className={input} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className="mb-3 block">
            <span className={label}>Caption</span>
            <textarea className={input} rows={2} value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} />
          </label>
          <div className="mb-3 flex items-center justify-between text-xs text-admin-muted">
            <span>Main focal point: {draft.focal ? `${Math.round(focal.x * 100)}%, ${Math.round(focal.y * 100)}%` : 'centre (default)'}</span>
            {draft.focal && (
              <button type="button" className="underline" onClick={() => setDraft({ ...draft, focal: null })}>
                Reset
              </button>
            )}
          </div>
          <button type="button" disabled={!changed || status.startsWith('Saving')} onClick={save} className="w-full rounded bg-admin-accent px-4 py-2 text-sm font-medium text-white hover:bg-admin-accent-dark disabled:opacity-40">
            Save
          </button>
          {status && <p className={`mt-2 text-xs ${status === 'Saved' ? 'text-[#047857]' : 'text-admin-muted'}`}>{status}</p>}
          <dl className="mt-5 space-y-1 border-t border-admin-ink/10 pt-3 text-xs text-admin-muted">
            <div className="flex justify-between">
              <dt>Dimensions</dt>
              <dd>{m.width && m.height ? `${m.width} × ${m.height}` : '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Type</dt>
              <dd>{m.mime_type}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Modern formats</dt>
              <dd>{formats.length ? formats.map((f) => f.toUpperCase()).join(', ') : m.processed_at ? 'Not applicable' : 'Pending'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Sizes</dt>
              <dd>{Object.keys(m.sizes ?? {}).filter((k) => k !== 'original_image').length}</dd>
            </div>
          </dl>
          <a href={mediaUrl(m.path)} target="_blank" className="mt-3 inline-block text-xs text-admin-muted underline hover:text-admin-accent">
            Open original
          </a>
        </aside>
      </div>
    </div>
    </>
  );
}
