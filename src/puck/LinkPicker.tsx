// Choosing a link's address: the site's own entries (searched by title), a file from the media
// library, or an address typed in (web, email, phone, a path on the site). Used by rich text toolbars
// (page blocks and emails) and link fields; `linkSelection` applies it to a contentEditable's selection.
import { useEffect, useRef, useState } from 'react';
import { browserClient } from '../lib/db/browser';
import { permalink } from '../lib/permalink';
import { PAGELESS_TYPES, site, typeLabel } from '../lib/site';
import { MediaModal } from './fields';
import { isExternal, typedAddress } from '../lib/link-address';

/** Types with pages of their own: what a link can lead to. */
const linkable = () => site.types.filter((t) => !PAGELESS_TYPES.has(t.type)).map((t) => t.type);

const input = 'w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent';

interface Found {
  id: number;
  title: string;
  type: string;
  slug: string;
  status: string;
}

export interface Picked {
  url: string;
  /** Text for a link made where nothing was selected: the entry's title or the file's name. */
  text?: string;
  newTab: boolean;
}

export function LinkPicker({ initial = '', initialNewTab, newTabOption = true, absolute, onPick, onRemove, onClose }: {
  initial?: string;
  initialNewTab?: boolean;
  /** Offer "Open in a new tab" (rich text); link fields have their own setting or none. */
  newTabOption?: boolean;
  /** Site addresses as full URLs (emails). */
  absolute?: boolean;
  onPick: (p: Picked) => void;
  /** Shown when editing a link that exists. */
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(initial);
  const [found, setFound] = useState<Found[]>([]);
  const [active, setActive] = useState(0);
  const [newTab, setNewTab] = useState<boolean | undefined>(initialNewTab);
  const [media, setMedia] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.select(), []);
  useEffect(() => {
    const term = q.trim();
    if (typedAddress(term)) return setFound([]);
    const t = setTimeout(async () => {
      let query = browserClient().from('entries').select('id, title, type, slug, status').in('type', linkable()).in('status', ['publish', 'draft', 'future', 'private']).limit(8);
      query = term ? query.ilike('title', `%${term}%`).order('title') : query.order('updated_at', { ascending: false });
      const { data } = await query;
      setFound(((data ?? []) as Found[]).filter((e) => e.slug));
      setActive(0);
    }, 150);
    return () => clearTimeout(t);
  }, [q]);
  const full = (url: string) => (absolute && url.startsWith('/') ? `${location.origin}${url}` : url);
  const typed = typedAddress(q);
  const options: { url: string; text?: string; label: string; meta: string }[] = [
    ...(typed ? [{ url: full(typed), label: typed, meta: 'Link to this address' }] : []),
    ...found.map((e) => ({ url: full(permalink(e)), text: e.title, label: e.title || '(untitled)', meta: `${typeLabel(e.type)}${e.status === 'publish' ? '' : ' (not published)'} · ${permalink(e)}` })),
  ];
  const pick = (o: { url: string; text?: string }) => onPick({ url: o.url, text: o.text, newTab: newTabOption ? (newTab ?? isExternal(o.url)) : false });
  return (
    <div
      className="mt-1.5 rounded border border-admin-ink/15 bg-white p-2 shadow-sm"
      role="dialog"
      aria-label="Link"
      onKeyDown={(e) => {
        if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onClose());
      }}
    >
      <input
        ref={box}
        className={input}
        value={q}
        placeholder="Search pages, or paste a link"
        aria-label="Search pages, or paste a link"
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls="link-picker-options"
        aria-activedescendant={options[active] ? `link-option-${active}` : undefined}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, options.length - 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (options[active]) pick(options[active]);
          }
        }}
      />
      {options.length > 0 && (
        <ul id="link-picker-options" role="listbox" className="m-0 mt-1 max-h-56 list-none overflow-auto p-0">
          {options.map((o, i) => (
            <li
              key={`${o.url}-${i}`}
              id={`link-option-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer rounded px-2 py-1 ${i === active ? 'bg-admin-soft' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => (e.preventDefault(), pick(o))}
            >
              <span className="block truncate text-sm">{o.label}</span>
              <span className="block truncate text-xs text-admin-muted">{o.meta}</span>
            </li>
          ))}
        </ul>
      )}
      {!options.length && q.trim() && <p className="px-2 py-1 text-xs text-admin-muted">Nothing found. Type a full address (https://…) to link to another site.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-admin-ink/10 pt-2 text-xs">
        <button type="button" className="rounded border border-admin-ink/15 px-2 py-1 hover:border-admin-accent hover:text-admin-accent" onClick={() => setMedia(true)}>
          Media library
        </button>
        {newTabOption && (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={newTab ?? (typed ? isExternal(full(typed)) : false)} onChange={(e) => setNewTab(e.target.checked)} />
            Open in a new tab
          </label>
        )}
        <span className="ml-auto flex gap-2">
          {onRemove && (
            <button type="button" className="text-admin-muted underline hover:text-admin-accent" onClick={onRemove}>
              Remove link
            </button>
          )}
          <button type="button" className="text-admin-muted underline hover:text-admin-accent" onClick={onClose}>
            Cancel
          </button>
        </span>
      </div>
      {media && <MediaModal only="all" onClose={() => setMedia(false)} onSelect={(m) => (setMedia(false), pick({ url: full(m.url), text: m.name }))} />}
    </div>
  );
}

/**
 * The selection in a contentEditable (`root`) to link: kept when the picker opens, since focus moves to
 * it. Inside a link it covers that whole link, whose address and target come back for editing.
 */
export function selectionToLink(root: HTMLElement): { range: Range; href?: string; newTab?: boolean } {
  const sel = window.getSelection();
  let range: Range;
  if (sel?.rangeCount && root.contains(sel.anchorNode)) range = sel.getRangeAt(0).cloneRange();
  else {
    // No cursor in the text: link at its end.
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }
  const node = range.commonAncestorContainer;
  const link = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('a');
  if (link && root.contains(link)) {
    range.selectNode(link);
    return { range, href: link.getAttribute('href') ?? '', newTab: link.getAttribute('target') === '_blank' };
  }
  return { range };
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Links the kept selection to the picked address: the selected words, or, with nothing selected, the
 * entry's title or the file's name (else the address) as new linked text.
 */
export function linkSelection(root: HTMLElement, range: Range, p: Picked): void {
  root.focus();
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  // A placeholder address finds the links just made (several when the selection spans paragraphs).
  const mark = `#link-${Math.random().toString(36).slice(2)}`;
  if (range.collapsed) document.execCommand('insertHTML', false, `<a href="${mark}">${escHtml(p.text || p.url.replace(/^(mailto|tel):/, ''))}</a>`);
  else {
    document.execCommand('unlink');
    document.execCommand('createLink', false, mark);
  }
  root.querySelectorAll(`a[href="${mark}"]`).forEach((a) => {
    a.setAttribute('href', p.url);
    if (p.newTab) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    } else {
      a.removeAttribute('target');
      a.removeAttribute('rel');
    }
  });
}

/** Takes the link off the kept selection. */
export function unlinkSelection(root: HTMLElement, range: Range): void {
  root.focus();
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('unlink');
}
