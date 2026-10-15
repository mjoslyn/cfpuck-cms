// The email builder's kit for a form notification (src/forms/EmailBuilder.tsx): the Form field block
// shows answers, merge tags are the form's, and the preview renders on the server for a stored
// submission or sample answers (/api/admin/forms/<id>/notification-preview). The Payment block shows
// one of each product in the canvas.
import type { EmailContext, EmailPayment } from '../lib/forms/email';
import { INPUT_TYPES } from '../lib/forms/logic';
import { toMinor } from '../lib/payments/money';
import { currencyOf, productsOf } from '../lib/forms/payment';
import type { FormDef, Notification } from '../lib/forms/types';
import type { EmailKit } from './EmailBuilder';
import { mergeTagOptions } from './rich-message';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fieldsOf = (form: FormDef) => form.fields.filter((f) => INPUT_TYPES.includes(f.type) && f.type !== 'hidden');

/** A payment for the canvas: one of each product at its price (the first choice; 25 for an amount). */
function samplePayment(form: FormDef): EmailPayment {
  const items = productsOf(form).map((f) => {
    const mode = f.priceMode ?? 'fixed';
    const choice = f.choices?.[0];
    const unit = mode === 'fixed' ? toMinor(f.price) : mode === 'amount' ? 2500 : toMinor(choice?.price);
    return { name: mode === 'choice' && choice ? `${f.label}: ${choice.label}` : f.label || 'Item', unit, quantity: 1 };
  });
  if (!items.length) items.push({ name: 'Product', unit: 2500, quantity: 1 });
  return {
    items,
    amount: items.reduce((s, it) => s + it.unit * it.quantity, 0),
    currency: currencyOf(form),
    status: 'Paid',
    method: form.payment?.provider === 'square' ? 'Square' : 'Stripe',
    id: 'the payment ID',
    date: new Date().toLocaleDateString('en-US', { dateStyle: 'long' }),
  };
}

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
    payment: samplePayment(form),
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
    payment: { note: form.payment ? 'Shows the submission’s payment. In the canvas, one of each product stands in for it.' : 'This form doesn’t take payment (its Payment tab), so the block shows nothing in sent emails.' },
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
