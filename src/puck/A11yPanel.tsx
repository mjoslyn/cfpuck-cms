// Left rail: accessibility check of the page as rendered in the canvas (what visitors get): alt text,
// headings, link and button names, embedded frames and colour contrast (WCAG AA). Each problem selects
// its block; problems in the template (header, footer) are listed without one. Automated checks find
// common problems only, so the panel says so. Problems a person has to judge (warnings, and text over
// an image, whose contrast can't be measured) can be marked as checked: the marks are kept in the
// document's root props (`a11y`, saved with the page or template) and lapse when what they were about
// changes (the issue's `sig`). With Settings > Accessibility's gate on, the editor runs `openIssues`
// before publishing and holds the publish while any problem is left open.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createUsePuck, useGetPuck, type Data } from '@puckeditor/core';

const usePuck = createUsePuck();
const NO_MARKS: Record<string, Mark> = {};

/** Where marks are saved as they are made (the editor provides it: the entry or the template). */
export const A11yMarksContext = createContext<{ save: (marks: Record<string, unknown>) => Promise<string | null>; quiet: () => void; gate?: boolean } | null>(null);

/** A person's judgement of an issue: who, when, a note, and what the issue looked like then. */
interface Mark {
  sig: string;
  by: string;
  at: string;
  note?: string;
}

type Level = 'error' | 'warning';
interface Issue {
  level: Level;
  rule: string;
  message: string;
  /** Text or markup that shows where it is. */
  sample?: string;
  blockId?: string;
  el: Element;
  /** Can be marked as checked (a person has to judge it). */
  review?: boolean;
  /** Stable name of the issue, and a fingerprint of what it is about (a mark lapses when it changes). */
  key?: string;
  sig?: string;
}

const VAGUE = new Set(['click here', 'here', 'read more', 'more', 'learn more', 'link', 'this', 'go', 'details', 'more info']);

/** Puck's canvas frame (other iframes can come and go in the editor). */
const canvasDoc = () => (document.getElementById('preview-frame') as HTMLIFrameElement | null)?.contentDocument ?? null;

const visible = (el: Element) => {
  if (!(el as HTMLElement).getClientRects().length) return false;
  const s = el.ownerDocument.defaultView!.getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
};

/** Editor-only markup (Puck's overlays and notes) is not part of the page. */
const editorOnly = (el: Element) => !!el.closest('[data-puck-overlay], .cms-editor-note, [class*="_DraggableComponent-overlay"]');

const blockOf = (el: Element) => el.closest('[data-puck-component]')?.getAttribute('data-puck-component') ?? undefined;

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Accessible name, roughly: aria-label, aria-labelledby, text, image alt, title. */
function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label')?.trim();
  if (label) return label;
  const by = el.getAttribute('aria-labelledby');
  if (by) return by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ').trim();
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  const alt = [...el.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt')!.trim()).filter(Boolean).join(' ');
  return alt || el.getAttribute('title')?.trim() || '';
}

// Colour contrast -----------------------------------------------------------------------------

type RGBA = [number, number, number, number];
const parse = (c: string): RGBA | null => {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
};
const over = (top: RGBA, under: RGBA): RGBA => {
  const a = top[3] + under[3] * (1 - top[3]);
  if (!a) return [255, 255, 255, 0];
  return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a) as RGBA;
};
const luminance = ([r, g, b]: RGBA) => {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const ratio = (a: RGBA, b: RGBA) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const hex = ([r, g, b]: RGBA) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * An image or video (not inside `el`) under the middle of `el` within `scope`: one whose box holds that
 * point, however the layers are made (an image laid behind the text, or the text laid over an image).
 * Lazy images in an absolutely positioned layer without a size yet count too.
 */
function overImage(el: Element, scope: Element): Element | null {
  const win = el.ownerDocument.defaultView!;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const inside = (b: DOMRect) => b.width > 0 && b.height > 0 && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  for (const m of scope.querySelectorAll('img, video')) {
    if (el.contains(m)) continue;
    if (inside(m.getBoundingClientRect())) return m;
    for (let n: Element | null = m; n && n !== scope; n = n.parentElement) {
      if (/absolute|fixed/.test(win.getComputedStyle(n).position)) {
        const b = n.getBoundingClientRect();
        if (!b.width || !b.height || inside(b)) return m;
        break;
      }
    }
  }
  return null;
}

/** Where an image comes from, for telling whether it changed. */
const imageSource = (m: Element | null | undefined) => (m ? (m as HTMLImageElement).currentSrc || m.getAttribute('src') || '' : '').split('?')[0];

/** What is behind an element: a solid colour, or an image (with the see-through colour layers over it). */
type Behind = { color: RGBA } | { image: string; layers: RGBA[] };

function backgroundOf(el: Element): Behind {
  const layers: RGBA[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    const s = n.ownerDocument.defaultView!.getComputedStyle(n);
    const c = parse(s.backgroundColor);
    // An opaque colour hides whatever is further back, image or not.
    if (c && c[3] >= 1) return { color: layers.reduceRight<RGBA>((under, top) => over(top, under), c) };
    if (s.backgroundImage !== 'none') return { image: s.backgroundImage, layers };
    if (n.matches('.c-cover, .c-hero')) return { image: imageSource(n.querySelector('img, video')), layers };
    const m = n !== el ? overImage(el, n) : null;
    if (m) return { image: imageSource(m), layers };
    if (c && c[3] > 0) layers.push(c);
  }
  return { color: layers.reduceRight<RGBA>((under, top) => over(top, under), [255, 255, 255, 1]) };
}

// Checks --------------------------------------------------------------------------------------

function check(doc: Document): Issue[] {
  const out: Issue[] = [];
  const add = (level: Level, rule: string, message: string, el: Element, sample?: string, extra: Partial<Issue> = {}) => {
    const blockId = blockOf(el);
    // Warnings are judgements too: each can be marked as checked.
    const review = extra.review ?? level === 'warning';
    out.push({ level, rule, message, el, sample, blockId, review, key: review ? `${rule}|${blockId ?? 'template'}|${message}` : undefined, sig: sample ?? '', ...extra });
  };
  const all = (sel: string) => [...doc.body.querySelectorAll(sel)].filter((el) => !editorOnly(el) && visible(el));

  for (const img of all('img')) {
    const link = img.closest('a');
    if (!img.hasAttribute('alt')) add('error', 'Image', 'Image has no alt text.', img, img.getAttribute('src') ?? undefined);
    else if (!img.getAttribute('alt')!.trim() && link && !nameOf(link)) add('error', 'Image', 'Linked image has no alt text, so the link has no name.', img, link.getAttribute('href') ?? undefined);
    else if (!img.getAttribute('alt')!.trim() && img.closest('.c-image, .c-media-text__media')) add('warning', 'Image', 'Image has empty alt text: fine only if it is decorative.', img, img.getAttribute('src')?.split('/').pop());
  }

  const headings = all('h1, h2, h3, h4, h5, h6');
  const h1s = headings.filter((h) => h.tagName === 'H1');
  if (!h1s.length) out.push({ level: 'warning', rule: 'Headings', message: 'The page has no main heading (h1).', el: doc.body, review: true, key: 'Headings|page|no-h1', sig: '' });
  for (const h of h1s.slice(1)) add('warning', 'Headings', 'More than one main heading (h1).', h, clip(nameOf(h)));
  let prev = 0;
  for (const h of headings) {
    const level = Number(h.tagName[1]);
    if (!nameOf(h)) add('error', 'Headings', `Empty heading (h${level}).`, h);
    else if (prev && level > prev + 1) add('warning', 'Headings', `Heading skips a level (h${prev} to h${level}).`, h, clip(nameOf(h)));
    prev = level;
  }

  for (const a of all('a[href]')) {
    const name = nameOf(a);
    const href = a.getAttribute('href')!.trim();
    if (!name) add('error', 'Links', 'Link has no text or label.', a, href);
    else if (VAGUE.has(name.toLowerCase().replace(/[^\w\s]/g, '').trim())) add('warning', 'Links', `Link text "${clip(name, 30)}" doesn't say where it goes.`, a, href);
    if (href === '#' || href === '') add('warning', 'Links', 'Link goes nowhere (#).', a, clip(name));
  }
  // Puck marks every block in the canvas role="button" (to drag it); those aren't the page's.
  for (const b of all('button, [role="button"]:not([data-puck-dnd])')) if (!nameOf(b)) add('error', 'Buttons', 'Button has no text or label.', b);

  for (const f of all('iframe')) if (!f.getAttribute('title')?.trim()) add('error', 'Embeds', 'Embedded frame has no title.', f, f.getAttribute('src') ?? undefined);

  // Contrast: elements with their own text, once per block and colour pair.
  const seen = new Set<string>();
  for (const el of all('body *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    if (!own) continue;
    const s = doc.defaultView!.getComputedStyle(el);
    const fg = parse(s.color);
    if (!fg) continue;
    const behind = backgroundOf(el);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const alpha = fg[3] * Number(s.opacity || 1);
    if ('image' in behind) {
      // Contrast over an image can't be measured: always a problem until someone checks it by eye and
      // marks it (the mark lapses when the text or the image changes).
      const block = blockOf(el) ?? 'template';
      const key = `contrast-image|${block}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = clip((el.textContent ?? '').replace(/\s+/g, ' ').trim());
      add('error', 'Contrast', "Text over an image: its contrast can't be measured. Check by eye that it stays readable on every part of the image (a darker overlay or a text shadow helps), then mark it as checked.", el, text, { review: true, key, sig: `${text}|${behind.image}` });
      continue;
    }
    const bg = behind.color;
    const color = over([fg[0], fg[1], fg[2], alpha], bg);
    const r = Math.floor(ratio(color, bg) * 100) / 100;
    if (r >= need) continue;
    const key = `${blockOf(el) ?? 'template'}|${hex(color)}|${hex(bg)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    add('error', 'Contrast', `Text contrast ${r.toFixed(2)}:1 (needs ${need}:1): ${hex(color)} on ${hex(bg)}.`, el, clip((el.textContent ?? '').replace(/\s+/g, ' ').trim()));
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

/** A problem marked as checked, as it still is (a mark lapses when what it was about changes). */
const checkedBy = (marks: Record<string, Mark>, i: Issue) => !!(i.review && i.key && marks[i.key] && marks[i.key].sig === (i.sig ?? ''));

/**
 * The canvas checked now, and what is left open given the document's marks: for the editor to run
 * before publishing. Null when the canvas isn't there to check.
 */
export async function openIssues(marks: Record<string, unknown> | undefined): Promise<{ errors: number; warnings: number } | null> {
  // The canvas draws the latest edit on the next frame.
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const doc = canvasDoc();
  if (!doc?.body?.querySelector('[data-puck-component]')) return null;
  const open = check(doc).filter((i) => !checkedBy((marks ?? NO_MARKS) as Record<string, Mark>, i));
  const errors = open.filter((i) => i.level === 'error').length;
  return { errors, warnings: open.length - errors };
}

export function A11yPanel() {
  const getPuck = useGetPuck();
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [me, setMe] = useState('');
  const [noting, setNoting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saveNote, setSaveNote] = useState('');
  const saveMarks = useContext(A11yMarksContext);
  const lastDoc = useRef<Document | null>(null);
  // The stored object itself (a new `{}` per read would re-render without end); empty when none.
  const stored = usePuck((s) => (s.appState.data.root?.props as Record<string, unknown> | undefined)?.a11y as Record<string, Mark> | undefined);
  const marks = stored ?? NO_MARKS;

  useEffect(() => {
    fetch('/api/admin/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.name && setMe(String(d.name)))
      .catch(() => {});
  }, []);

  const run = useCallback(() => {
    const doc = canvasDoc();
    if (doc?.body) setIssues(check(doc));
  }, []);

  // Check now and whenever the canvas changes. The canvas frame is recreated when the side panels
  // change, so poll its document and size instead of observing one document.
  useEffect(() => {
    let last = '';
    const tick = () => {
      const doc = canvasDoc();
      const body = doc?.body;
      if (!body?.querySelector('[data-puck-component]')) return;
      const sig = `${body.innerHTML.length}`;
      if (doc !== lastDoc.current || sig !== last) {
        lastDoc.current = doc;
        last = sig;
        run();
      }
    };
    tick();
    const id = window.setInterval(tick, 1500);
    return () => window.clearInterval(id);
  }, [run]);

  const select = (i: Issue) => {
    i.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (!i.blockId) return;
    const { dispatch, getSelectorForId } = getPuck();
    const selector = getSelectorForId(i.blockId);
    if (selector) dispatch({ type: 'setUi', ui: { itemSelector: selector } });
  };

  /** Change the marks in the document (saved with it, like any edit). */
  const setMarks = (next: Record<string, Mark>) => {
    const { appState, dispatch } = getPuck();
    const data = appState.data as Data;
    const props = { ...((data.root?.props ?? {}) as Record<string, unknown>) };
    if (Object.keys(next).length) props.a11y = next;
    else delete props.a11y;
    // Not an edit of the page: the editor doesn't count it as unsaved.
    saveMarks?.quiet();
    dispatch({ type: 'setData', data: { ...data, root: { ...data.root, props } } });
    // Saved at once, on their own: other unsaved edits stay unsaved.
    if (saveMarks) {
      setSaveNote('Saving…');
      saveMarks.save(next).then((err) => setSaveNote(err ? `Not saved: ${err}` : 'Saved'));
    }
  };
  const mark = (i: Issue) => {
    setMarks({ ...marks, [i.key!]: { sig: i.sig ?? '', by: me || 'an editor', at: new Date().toISOString(), ...(note.trim() ? { note: note.trim() } : {}) } });
    setNoting(null);
    setNote('');
  };
  const unmark = (i: Issue) => {
    const { [i.key!]: _gone, ...rest } = marks;
    setMarks(rest);
  };

  if (!issues) return <p className="p-4 text-sm text-admin-muted">Checking…</p>;
  const isChecked = (i: Issue) => checkedBy(marks, i);
  const lapsed = (i: Issue) => !!(i.review && i.key && marks[i.key] && marks[i.key].sig !== (i.sig ?? ''));
  const open = issues.filter((i) => !isChecked(i));
  const checked = issues.filter(isChecked);
  const errors = open.filter((i) => i.level === 'error').length;
  const warnings = open.length - errors;
  const when = (at: string) => new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

  const item = (i: Issue, n: number, done: boolean) => (
    <li key={`${done ? 'c' : 'o'}${n}`} className={`px-3 py-2 ${done ? 'opacity-70' : ''}`}>
      <div className="flex items-baseline gap-2">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${done ? 'bg-[#6db56d]/15 text-[#3f7a3f]' : i.level === 'error' ? 'bg-[#c4592a]/15 text-[#a3441c]' : 'bg-[#e6a817]/20 text-[#7a5a08]'}`}>{done ? 'Checked' : i.level === 'error' ? 'Problem' : 'Warning'}</span>
        <span className="text-xs text-admin-muted">{i.rule}</span>
      </div>
      <p className="mt-1">{i.message}</p>
      {i.sample && <p className="mt-0.5 truncate font-mono text-[11px] text-admin-muted">{i.sample}</p>}
      {done && (
        <p className="mt-1 text-xs text-[#3f7a3f]">
          Checked by {marks[i.key!].by}, {when(marks[i.key!].at)}
          {marks[i.key!].note ? `: ${marks[i.key!].note}` : ''}
        </p>
      )}
      {!done && lapsed(i) && <p className="mt-1 text-xs text-[#7a5a08]">Marked as checked before, but it has changed since: check it again.</p>}
      <div className="mt-1 flex flex-wrap gap-3 text-xs">
        <button type="button" className="text-admin-muted underline hover:text-admin-accent" onClick={() => select(i)}>
          {i.blockId ? 'Select the block' : 'Show (in the template)'}
        </button>
        {done && (
          <button type="button" className="text-admin-muted underline hover:text-admin-accent" onClick={() => unmark(i)}>
            Unmark
          </button>
        )}
        {!done && i.review && noting !== i.key && (
          <button type="button" className="text-admin-muted underline hover:text-admin-accent" onClick={() => (setNoting(i.key!), setNote(''))}>
            Mark as checked
          </button>
        )}
      </div>
      {!done && i.review && noting === i.key && (
        <div className="mt-2">
          <label className="block text-xs text-admin-muted">
            Note (optional)
            <input className="mt-1 w-full rounded border border-admin-ink/15 bg-white px-2 py-1 text-xs" value={note} autoFocus placeholder="e.g. the overlay keeps it readable" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && mark(i)} />
          </label>
          <div className="mt-1.5 flex gap-2 text-xs">
            <button type="button" className="rounded bg-admin-ink px-2.5 py-1 font-semibold text-white" onClick={() => mark(i)}>
              Mark as checked
            </button>
            <button type="button" className="px-1 text-admin-muted" onClick={() => setNoting(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );

  return (
    <div className="text-sm">
      <div className="border-b border-admin-ink/10 p-3">
        <p className="font-medium">{open.length ? `${errors} ${errors === 1 ? 'problem' : 'problems'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : 'No problems found'}</p>
        <p className="mt-1 text-xs text-admin-muted">Checks the page as visitors see it (at this canvas width). Automated checks find common problems only; also try the page with a keyboard. Marking something as checked saves straight away.</p>
        {saveMarks?.gate && <p className="mt-1 text-xs text-admin-muted">This site checks pages before publishing: fix each problem or mark it as checked, or publish anyway with a reason, kept in Revisions.</p>}
        {saveNote && (
          <p className={`mt-1 text-xs ${saveNote.startsWith('Not') ? 'text-[#b3261e]' : 'text-[#3f7a3f]'}`} role="status">
            {saveNote}
          </p>
        )}
        <button type="button" className="mt-2 rounded border border-admin-ink/15 bg-white px-2.5 py-1 text-xs hover:border-admin-accent hover:text-admin-accent" onClick={run}>
          Check again
        </button>
      </div>
      <ul className="m-0 list-none divide-y divide-admin-ink/10 p-0">{open.map((i, n) => item(i, n, false))}</ul>
      {checked.length > 0 && (
        <details className="border-t border-admin-ink/10">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-admin-muted">Checked ({checked.length})</summary>
          <ul className="m-0 list-none divide-y divide-admin-ink/10 p-0">{checked.map((i, n) => item(i, n, true))}</ul>
        </details>
      )}
    </div>
  );
}
