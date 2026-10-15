// Rich text for email messages (with "Insert field value"), used by the form builder and the email
// builder's Text block, and the merge tags a form offers. The tags offered are the caller's: a form's
// fields, or a ticket order's details.
import { useEffect, useRef } from 'react';
import { INPUT_TYPES } from '../lib/forms/logic';
import type { FormDef } from '../lib/forms/types';

const labelCls = 'mb-1 block text-xs font-medium text-admin-muted';

// Merge tags ----------------------------------------------------------------------------------

export function mergeTagOptions(form: FormDef): [string, string][] {
  return [
    ['{all_fields}', 'All fields'],
    ['{form_title}', 'Form title'],
    ['{admin_email}', 'Chamber email'],
    ['{date}', 'Date'],
    ...(form.payment ? ([['{payment_total}', 'Payment total'], ['{payment_id}', 'Payment ID'], ['{payment_summary}', 'Payment summary']] as [string, string][]) : []),
    ...form.fields.filter((f) => INPUT_TYPES.includes(f.type)).map((f) => [`{${f.label}:${f.id}}`, f.label] as [string, string]),
  ];
}

/** Older notification messages are plain text; shown as paragraphs and line breaks in the editor. */
export const messageHtml = (v: string) =>
  /<(p|br|div|ul|ol|li|strong|b|em|i|a|h[1-6])\b/i.test(v)
    ? v
    : v
        .split(/\n{2,}/)
        .map((para) => `<p>${para.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`)
        .join('');

/**
 * Rich text for email messages: paragraphs, bold, italic, links, bulleted lists, and field tags
 * inserted where the cursor is. Stores HTML. Not inside a <label> (it would hand clicks to the first
 * toolbar button).
 */
export function RichMessage({ label, value, tags, onChange }: { label: string; value: string | undefined; tags: [string, string][]; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  useEffect(() => {
    const html = messageHtml(value ?? '');
    if (ref.current && ref.current.innerHTML !== html) ref.current.innerHTML = html;
  }, [value]);
  const emit = () => onChange(ref.current?.innerHTML ?? '');
  const keepRange = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && ref.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  };
  const cmd = (c: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.execCommand(c, false, arg);
    emit();
  };
  const insertTag = (tag: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection()!;
    if (range.current) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    } else {
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }
    document.execCommand('insertText', false, tag);
    keepRange();
    emit();
  };
  const tool = 'rounded px-2 py-0.5 hover:bg-admin-soft';
  return (
    <div className="mb-3" role="group" aria-label={label}>
      <span className={labelCls}>{label}</span>
      <div className="rounded border border-admin-ink/15 bg-white focus-within:border-admin-accent">
        <div className="flex flex-wrap items-center gap-1 border-b border-admin-ink/10 px-1 py-1 text-xs">
          <button type="button" className={`${tool} font-bold`} onMouseDown={(e) => (e.preventDefault(), cmd('bold'))} title="Bold" aria-label="Bold">B</button>
          <button type="button" className={`${tool} italic`} onMouseDown={(e) => (e.preventDefault(), cmd('italic'))} title="Italic" aria-label="Italic">I</button>
          <button type="button" className={tool} onMouseDown={(e) => (e.preventDefault(), cmd('insertUnorderedList'))} title="Bulleted list" aria-label="Bulleted list">List</button>
          <button type="button" className={`${tool} underline`} onMouseDown={(e) => { e.preventDefault(); keepRange(); const url = prompt('Link address'); if (url) { const sel = window.getSelection(); if (range.current) { sel?.removeAllRanges(); sel?.addRange(range.current); } cmd('createLink', url); } }} title="Link" aria-label="Link">Link</button>
          <button type="button" className={tool} onMouseDown={(e) => (e.preventDefault(), cmd('unlink'))} title="Remove link" aria-label="Remove link">Unlink</button>
          <span className="ml-auto">
            <MergeTags tags={tags} onInsert={insertTag} />
          </span>
        </div>
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          className="email-message min-h-36 cursor-text px-3 py-2 text-sm outline-none"
          onInput={emit}
          onKeyUp={keepRange}
          onMouseUp={keepRange}
          onBlur={keepRange}
        />
      </div>
    </div>
  );
}

export function MergeTags({ tags, onInsert }: { tags: [string, string][]; onInsert: (tag: string) => void }) {
  return (
    <select className="mb-1 rounded border border-admin-ink/15 bg-white px-1.5 py-0.5 text-xs text-admin-muted" value="" onChange={(e) => e.target.value && onInsert(e.target.value)}>
      <option value="">Insert field value…</option>
      {tags.map(([tag, l]) => (
        <option key={tag} value={tag}>
          {l}
        </option>
      ))}
    </select>
  );
}
