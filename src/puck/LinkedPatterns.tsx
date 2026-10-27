// Editor pieces for patterns made from the page: Save as pattern (a copy to reuse, or a linked pattern
// whose layout and style stay shared), the content-only panel of a block inside a linked pattern, and
// the linked pattern's own panel (edit the pattern, detach).
import { useState } from 'react';
import { useGetPuck, type Data } from '@puckeditor/core';
import { LinkInput, MediaPicker, RichText, Text, inputClass, type Attrs } from './fields';
import { CONTENT_FIELDS, expandLinked, unmark } from '../lib/content/linked-patterns';
import { findInDoc as findInData, replaceInDoc as replaceInData } from '../lib/puck/tree';
import type { PuckItem } from '../lib/puck/types';
import { reId } from './patterns';

type Set = (patch: Attrs) => void;

/** A block inside a linked pattern: only its content can change here; the rest is the pattern's. */
export function LinkedContentPanel({ type, a, set }: { type: string; a: Attrs; set: Set }) {
  const fields = CONTENT_FIELDS[type] ?? [];
  return (
    <div>
      <p className="mb-3 rounded bg-admin-soft px-2 py-1.5 text-xs text-admin-muted">Part of a linked pattern: change its content here. Layout and style are set in the pattern.</p>
      {!fields.length && <p className="mb-2 text-xs text-admin-muted">This block has no content of its own to change.</p>}
      {fields.map((f) =>
        f.kind === 'rich' ? (
          <RichText key={f.key} title={f.label} value={a[f.key] ?? ''} onChange={(v) => set({ [f.key]: v || undefined })} />
        ) : f.kind === 'media' ? (
          <MediaPicker key={f.key} title={f.label} url={a.src} onSelect={(m) => set({ mediaId: m.mediaId ?? m.id ?? undefined, src: m.url, alt: a.alt || m.alt || undefined })} />
        ) : f.kind === 'link' ? (
          <LinkInput key={f.key} title={f.label} value={a[f.key]} placeholder="https://" onChange={(v) => set({ [f.key]: v || undefined })} />
        ) : (
          <Text key={f.key} title={f.label} value={a[f.key]} onChange={(v) => set({ [f.key]: v || undefined })} />
        ),
      )}
    </div>
  );
}

/** The linked pattern itself: where it comes from, and Detach (keep its blocks as an ordinary copy). */
export function LinkedPatternPanel({ a }: { a: Attrs }) {
  const getPuck = useGetPuck();
  const detach = () => {
    const { appState, dispatch, selectedItem } = getPuck();
    const id = (selectedItem?.props as any)?.id as string | undefined;
    if (!id) return;
    const item = findInData(appState.data as Data, id);
    if (!item) return;
    dispatch({ type: 'setData', data: replaceInData(appState.data as Data, id, unmark(item.props.children ?? [])), recordHistory: true });
  };
  return (
    <div className="mb-3 text-xs text-admin-muted">
      <p className="mb-2">
        Linked pattern <strong className="text-admin-ink">{a.slug}</strong>. Change the content of its blocks here; their layout and style come from the pattern, so editing{' '}
        <a href={`/admin/templates/pattern/${a.slug}/`} target="_blank" rel="noopener" className="text-admin-accent underline">
          the pattern
        </a>{' '}
        changes every page that uses it.
      </p>
      <button type="button" className="rounded border border-admin-ink/15 bg-white px-3 py-1.5 text-xs text-admin-ink hover:border-admin-accent" onClick={detach}>
        Detach (make an ordinary copy)
      </button>
    </div>
  );
}

/** Save the selected block (and everything in it) as a pattern; a linked one replaces the block. */
export function SaveAsPattern() {
  const getPuck = useGetPuck();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [linked, setLinked] = useState(false);
  const [status, setStatus] = useState('');
  const save = async () => {
    const { appState, dispatch, selectedItem } = getPuck();
    const id = (selectedItem?.props as any)?.id as string | undefined;
    const item = id ? findInData(appState.data as Data, id) : null;
    if (!item || !title.trim()) return;
    setStatus('Saving…');
    // The pattern's own copy: fresh ids, no editor markers.
    const blocks = reId(unmark([item]), `p${Date.now().toString(36)}`);
    const res = await fetch('/api/admin/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-pattern', title: title.trim(), linked, content: blocks }) });
    if (!res.ok) return setStatus(`Not saved: ${await res.text()}`);
    const { slug } = (await res.json()) as { slug: string };
    if (linked) {
      const instance: PuckItem = { type: 'pattern', props: { id: `lp${Date.now().toString(36)}`, attrs: { slug, linked: true } } };
      const selector = appState.ui.itemSelector;
      dispatch({ type: 'setData', data: replaceInData(appState.data as Data, id!, [expandLinked(instance, blocks)]), recordHistory: true });
      // The linked pattern takes the block's place: keep it selected, so its panel says what it is.
      if (selector) dispatch({ type: 'setUi', ui: { itemSelector: selector } });
      return;
    }
    setStatus(linked ? `Saved "${title.trim()}" as a linked pattern; this block now uses it.` : `Saved "${title.trim()}" as a pattern. Insert it from the Patterns tab.`);
    setTitle('');
    setOpen(false);
  };
  return (
    <div className="mt-4 border-t border-admin-ink/10 pt-3">
      {!open ? (
        <button type="button" className="text-xs text-admin-muted hover:text-admin-accent" onClick={() => (setOpen(true), setStatus(''))}>
          Save as pattern…
        </button>
      ) : (
        <div className="text-xs">
          <label className="mb-2 block text-admin-muted">
            Pattern name
            <input className={`${inputClass} mt-1`} value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          </label>
          <fieldset className="mb-2">
            <legend className="mb-1 text-admin-muted">When placed on a page</legend>
            <label className="mb-1 flex items-start gap-2">
              <input type="radio" name="pattern-kind" checked={!linked} onChange={() => setLinked(false)} />
              <span>
                <strong>Copy</strong>: each page gets its own blocks to change freely.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="pattern-kind" checked={linked} onChange={() => setLinked(true)} />
              <span>
                <strong>Linked</strong>: pages change only the content; layout and style stay the pattern's, and editing the pattern updates every page. This block becomes the first use.
              </span>
            </label>
          </fieldset>
          <div className="flex gap-2">
            <button type="button" disabled={!title.trim()} className="rounded bg-admin-ink px-3 py-1.5 font-semibold text-white disabled:opacity-40" onClick={save}>
              Save pattern
            </button>
            <button type="button" className="px-2 text-admin-muted" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {status && (
        <p className="mt-2 text-xs text-[#3f7a3f]" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
