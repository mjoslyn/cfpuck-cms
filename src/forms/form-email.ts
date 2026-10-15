// The email builder's kit for a form notification (src/forms/EmailBuilder.tsx): the Form field block
// shows answers, merge tags are the form's, and the preview renders on the server for a stored
// submission or sample answers (/api/admin/forms/<id>/notification-preview).
import type { EmailContext } from '../lib/forms/email';
import { INPUT_TYPES } from '../lib/forms/logic';
import type { FormDef, Notification } from '../lib/forms/types';
import type { EmailKit } from './EmailBuilder';
import { mergeTagOptions } from './rich-message';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fieldsOf = (form: FormDef) => form.fields.filter((f) => INPUT_TYPES.includes(f.type) && f.type !== 'hidden');

/** The canvas's stand-ins for what a submission fills in: tags shown as written, answers as their labels. */
function canvasContext(form: FormDef): EmailContext {
  const answer = (label: string) => `<span style="background:#fef3c7;color:#7a4a00;padding:0 3px;border-radius:2px">${esc(label)}</span>`;
  return {
    merge: (text) => text,
    field: (id, showLabel) => {
      if (id === 'all')
        return `<table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">${fieldsOf(form)
          .map((f) => `<tr><td style="background:#f5f3f0;font-weight:600;border-bottom:1px solid #e5e1dc">${esc(f.label)}</td></tr><tr><td style="padding-bottom:14px;border-bottom:1px solid #e5e1dc">${answer(`${f.label} answer`)}</td></tr>`)
          .join('') || '<tr><td>(The form has no fields yet.)</td></tr>'}</table>`;
      const f = form.fields.find((x) => x.id === id);
      if (!f) return '<p style="margin:0;color:#b3261e">Choose a field.</p>';
      return showLabel ? `<p style="margin:0 0 4px 0;font-weight:600">${esc(f.label)}</p><p style="margin:0">${answer(`${f.label} answer`)}</p>` : `<p style="margin:0">${answer(`${f.label} answer`)}</p>`;
    },
    origin: typeof window === 'undefined' ? '' : window.location.origin,
  };
}

/** `notification`: read when the preview renders, so it shows the notification's current settings. */
export function formEmailKit(formId: number, form: FormDef, notification: () => Notification): EmailKit {
  const json = async (r: Response) => (r.ok ? r.json() : Promise.reject(new Error(await r.text())));
  const when = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return {
    dataBlock: { label: 'Form field', options: [['all', 'All fields (a table)'], ...fieldsOf(form).map((f) => [f.id, f.label || f.id] as [string, string])] },
    tags: mergeTagOptions(form),
    canvas: canvasContext(form),
    textField: (id, showLabel) => {
      if (id === 'all') return '{all_fields}';
      const f = form.fields.find((x) => x.id === id);
      return f ? `<p>${showLabel ? `${esc(f.label)}: ` : ''}{${esc(f.label)}:${f.id}}</p>` : '';
    },
    preview: {
      pickLabel: 'Answers from',
      sampleLabel: 'Sample answers',
      choices: () =>
        fetch(`/api/admin/forms/${formId}/notification-preview`)
          .then(json)
          .then((subs: { id: number; created_at: string; summary: string }[]) => subs.map((s) => ({ id: String(s.id), label: `${when(s.created_at)}${s.summary ? ` — ${s.summary}` : ''}` }))),
      render: ({ design, text }, pick) =>
        fetch(`/api/admin/forms/${formId}/notification-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notification: { ...notification(), design, text }, definition: form, submissionId: pick ? Number(pick) : null }),
        }).then(json),
    },
  };
}
