// Puck field UIs for block attributes. Everything edits the block's `attrs` object; the
// Advanced tab edits the raw JSON so no attribute is out of reach.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PRESETS as themeJson } from '../lib/site';
import { browserClient } from '../lib/db/browser';
import { mediaUrl } from '../lib/media/image';
import type { Media } from '../lib/types';

type Attrs = Record<string, any>;
type Set = (patch: Attrs) => void;

const input = 'w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent';
const label = 'mb-1 block text-xs font-medium text-admin-muted';

export function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className={label}>{title}</span>
      {children}
    </label>
  );
}

/**
 * A titled group of controls. Not a <label>: a label hands clicks to its first control, so with a
 * toolbar or several buttons inside, clicking the text box would press the first button instead.
 */
export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3 block" role="group" aria-label={title}>
      <span className={label}>{title}</span>
      {children}
    </div>
  );
}

export function Text({ title, value, onChange, placeholder }: { title: string; value: any; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Row title={title}>
      <input className={input} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Row>
  );
}

export function Num({ title, value, onChange, min, max }: { title: string; value: any; onChange: (v: number | undefined) => void; min?: number; max?: number }) {
  return (
    <Row title={title}>
      <input type="number" className={input} value={value ?? ''} min={min} max={max} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    </Row>
  );
}

export function Select({ title, value, onChange, options }: { title: string; value: any; onChange: (v: string | undefined) => void; options: [string, string][] }) {
  return (
    <Row title={title}>
      <select className={input} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Default</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Row>
  );
}

/** A few mutually exclusive choices shown as a row of buttons. */
export function Segmented({ title, value, onChange, options }: { title: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <FieldGroup title={title}>
      <div className="flex overflow-hidden rounded border border-admin-ink/15">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            className={`flex-1 border-l border-admin-ink/15 px-2 py-1.5 text-xs first:border-l-0 ${value === v ? 'bg-admin-ink text-white' : 'bg-white hover:text-admin-accent'}`}
            onClick={() => onChange(v)}
          >
            {l}
          </button>
        ))}
      </div>
    </FieldGroup>
  );
}

export function Toggle({ title, value, onChange }: { title: string; value: any; onChange: (v: boolean) => void }) {
  return (
    <label className="mb-3 flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      {title}
    </label>
  );
}

const colors = themeJson.colors.map((c) => [c.slug, c.name] as [string, string]);
const fontSizes = themeJson.fontSizes.map((f) => [f.slug, f.name] as [string, string]);
const spacing = themeJson.spacing.map((s) => [`var:preset|spacing|${s.slug}`, `${s.name} (${s.size})`] as [string, string]);

export function ColorPicker({ title, value, onChange }: { title: string; value: any; onChange: (v: string | undefined) => void }) {
  return (
    <FieldGroup title={title}>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onChange(undefined)} className={`h-6 w-6 rounded-full border text-[10px] ${!value ? 'ring-2 ring-admin-accent' : 'border-admin-ink/20'}`} title="Default">
          /
        </button>
        {themeJson.colors.map((c) => (
          <button key={c.slug} type="button" title={c.name} onClick={() => onChange(c.slug)} className={`h-6 w-6 rounded-full border border-admin-ink/20 ${value === c.slug ? 'ring-2 ring-admin-accent ring-offset-1' : ''}`} style={{ background: c.color }} />
        ))}
      </div>
    </FieldGroup>
  );
}

/** Minimal rich text: contentEditable with bold / italic / link. Stores inline HTML. */
export function RichText({ title, value, onChange }: { title: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value ?? '')) ref.current.innerHTML = value ?? '';
  }, [value]);
  const cmd = (c: string, arg?: string) => {
    document.execCommand(c, false, arg);
    onChange(ref.current?.innerHTML ?? '');
  };
  return (
    <FieldGroup title={title}>
      <div
        className="rounded border border-admin-ink/15 bg-white focus-within:border-admin-accent"
        // Clicking anywhere in the box (not a toolbar button) puts the cursor in the text.
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            ref.current?.focus();
          }
        }}
      >
        <div className="flex gap-1 border-b border-admin-ink/10 px-1 py-1 text-xs">
          <button type="button" className="rounded px-2 py-0.5 font-bold hover:bg-admin-soft" onMouseDown={(e) => (e.preventDefault(), cmd('bold'))}>B</button>
          <button type="button" className="rounded px-2 py-0.5 italic hover:bg-admin-soft" onMouseDown={(e) => (e.preventDefault(), cmd('italic'))}>I</button>
          <button type="button" className="rounded px-2 py-0.5 underline hover:bg-admin-soft" onMouseDown={(e) => { e.preventDefault(); const url = prompt('Link URL'); if (url) cmd('createLink', url); }}>Link</button>
          <button type="button" className="rounded px-2 py-0.5 hover:bg-admin-soft" onMouseDown={(e) => (e.preventDefault(), cmd('unlink'))}>Unlink</button>
        </div>
        <div ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={title} className="min-h-16 cursor-text px-2 py-1.5 text-sm outline-none" onInput={() => onChange(ref.current?.innerHTML ?? '')} />
      </div>
    </FieldGroup>
  );
}

export function Code({ title, value, onChange, rows = 8 }: { title: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <Row title={title}>
      <textarea className={`${input} font-mono text-xs`} rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </Row>
  );
}

/** JSON editor for the full attribute object; applies only when valid. */
export function JsonAttrs({ value, onChange }: { value: Attrs; onChange: (v: Attrs) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState('');
  useEffect(() => setText(JSON.stringify(value ?? {}, null, 2)), [value]);
  return (
    <details open className="mt-4 border-t border-admin-ink/10 pt-3">
      <summary className="cursor-pointer text-xs font-medium text-admin-muted">Advanced: all attributes (JSON)</summary>
      <textarea
        className={`${input} mt-2 font-mono text-xs`}
        rows={14}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setError('');
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
      {error && <p className="mt-1 text-xs text-[#c4592a]">{error}</p>}
    </details>
  );
}

// Media ----------------------------------------------------------------------------------------

export function MediaPicker({ title, url, onSelect, fit = 'cover' }: { title: string; url?: string; fit?: 'cover' | 'contain'; onSelect: (m: { url: string; id: number | null; mediaId?: number; alt: string; width?: number | null; height?: number | null }) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <FieldGroup title={title}>
      <div className="flex items-center gap-2">
        {url ? <img src={url} alt="" className={`h-14 w-20 rounded border border-admin-ink/10 ${fit === 'contain' ? 'object-contain p-1' : 'object-cover'}`} /> : <div className="h-14 w-20 rounded border border-dashed border-admin-ink/20" />}
        <button type="button" className="rounded border border-admin-ink/15 bg-white px-3 py-1.5 text-xs hover:border-admin-accent" onClick={() => setOpen(true)}>
          {url ? 'Replace' : 'Choose'}
        </button>
      </div>
      {open && <MediaModal onClose={() => setOpen(false)} onSelect={(m) => { onSelect(m); setOpen(false); }} />}
    </FieldGroup>
  );
}

type Picked = { url: string; id: number | null; mediaId?: number; alt: string; width?: number | null; height?: number | null; kind?: 'image' | 'video'; name?: string };

/**
 * The media library. One click picks an image (onSelect); with `multiple`, tiles toggle a selection
 * (images and videos, or `only` one kind) confirmed with "Add" (onSelectMany).
 */
export function MediaModal({ onClose, onSelect, multiple, onSelectMany, only }: { onClose: () => void; onSelect?: (m: Picked) => void; multiple?: boolean; onSelectMany?: (list: Picked[]) => void; only?: 'image' | 'video' }) {
  const [items, setItems] = useState<Media[]>([]);
  const [picked, setPicked] = useState<Media[]>([]);
  const asPicked = (m: Media): Picked => ({ url: mediaUrl(m.path), id: m.id, mediaId: m.id, alt: m.alt, width: m.width, height: m.height, kind: m.mime_type.startsWith('video/') ? 'video' : 'image', name: m.title || m.path.split('/').pop() });
  const toggle = (m: Media) => setPicked((p) => (p.some((x) => x.id === m.id) ? p.filter((x) => x.id !== m.id) : [...p, m]));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    let query = browserClient().from('media').select('*').order('created_at', { ascending: false }).limit(multiple ? 200 : 120);
    query = multiple && !only ? query.or('mime_type.like.image/%,mime_type.like.video/%') : query.like('mime_type', `${only ?? 'image'}/%`);
    if (q) query = query.or(`title.ilike.%${q}%,path.ilike.%${q}%,alt.ilike.%${q}%`);
    const { data } = await query;
    setItems((data as Media[]) ?? []);
  };
  useEffect(() => {
    load();
  }, [q]);
  const upload = async (file: File) => {
    setBusy(true);
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/admin/media', { method: 'POST', body });
    setBusy(false);
    if (res.ok) load();
    else alert(await res.text());
  };
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-admin-ink/50 p-8" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-4xl flex-col rounded bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-admin-ink/10 p-3">
          <input className={`${input} max-w-xs`} placeholder="Search media" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="cursor-pointer rounded-sm bg-admin-ink px-3 py-1.5 text-xs font-semibold tracking-wider text-white uppercase hover:bg-admin-accent">
            {busy ? 'Uploading…' : 'Upload'}
            <input type="file" accept={only === 'video' ? 'video/mp4,video/webm,video/quicktime' : multiple && !only ? 'image/*,video/mp4,video/webm,video/quicktime' : 'image/*'} multiple={multiple} className="hidden" onChange={(e) => e.target.files && Array.from(e.target.files).forEach(upload)} />
          </label>
          {multiple && (
            <button type="button" disabled={!picked.length} className="ml-auto rounded-sm bg-admin-accent px-3 py-1.5 text-xs font-semibold tracking-wider text-white uppercase disabled:opacity-40" onClick={() => onSelectMany?.(picked.map(asPicked))}>
              Add {picked.length || ''} selected
            </button>
          )}
          <button type="button" className={`${multiple ? '' : 'ml-auto '}text-sm text-admin-muted hover:text-admin-ink`} onClick={onClose}>Close</button>
        </div>
        <div className="grid grid-cols-6 gap-2 overflow-auto p-3">
          {items.map((m) => {
            const video = m.mime_type.startsWith('video/');
            const thumb = mediaUrl((m.sizes?.thumbnail ?? m.sizes?.medium ?? m).path);
            const on = picked.some((x) => x.id === m.id);
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={multiple ? on : undefined}
                className="group relative text-left"
                onClick={() => (multiple ? toggle(m) : onSelect?.(asPicked(m)))}
              >
                {video ? (
                  <span className={`flex aspect-square w-full items-center justify-center rounded bg-admin-ink text-[10px] font-semibold tracking-wider text-white ring-admin-accent group-hover:ring-2 ${on ? 'ring-4' : ''}`}>VIDEO</span>
                ) : (
                  <img src={thumb} alt="" loading="lazy" className={`aspect-square w-full rounded object-cover ring-admin-accent group-hover:ring-2 ${on ? 'ring-4' : ''}`} />
                )}
                {multiple && on && <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-admin-accent text-[11px] font-semibold text-white">{picked.findIndex((x) => x.id === m.id) + 1}</span>}
                <span className="mt-1 block truncate text-[11px] text-admin-muted">{m.path.split('/').pop()}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { colors, fontSizes, spacing, input as inputClass };
export type { Attrs, Set };
