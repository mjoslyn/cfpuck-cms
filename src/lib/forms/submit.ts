// Form submissions: validate against the form (skipping fields conditional logic hides), store the
// entry, send notifications, and work out the confirmation. A form that takes payment sends the
// visitor to checkout instead, and notifies once paid (./checkout.ts).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Field, FormDef, FormResult, FormRow, NamePart, Notification, ProductValue, SubmissionPayment, Values } from './types';
import { HONEYPOT, INPUT_TYPES, NAME_LABELS, displayValue, formatMoney, isFieldHidden, isProduct, visibleNameParts } from './logic';
import { MAX_QUANTITY, currencyOf, lineItems, totalOf } from './payment';
import { startCheckout } from './checkout';
import { sendMail, textVersion } from './mail';
import { renderEmail } from './email';
import { Loader } from '../data';
import { permalink } from '../permalink';
import { serviceClient } from '../supabase';
import { SITE_TZ, site } from '../site';

const env = (k: string) => (import.meta.env?.[k] as string | undefined) ?? process.env[k];
const REQUIRED = 'This field is required.';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Limits no real answer reaches: an answer's length, and one form's submissions in a minute (all
// visitors together; a flood would otherwise fill the table and the notification inboxes).
const MAX_ANSWER = 10_000;
const MAX_PER_MINUTE = 20;
/** The most a visitor can enter as an amount. */
const MAX_AMOUNT = 100_000;
const answer = (v: unknown, max = MAX_ANSWER) => String(v ?? '').trim().slice(0, max);

/** Posted values: "f1", "f1[]" (checkboxes), "f1[first]" (name parts). */
function collect(data: FormData, def: FormDef): Values {
  const values: Values = {};
  for (const f of def.fields) {
    if (!INPUT_TYPES.includes(f.type)) continue;
    if (f.type === 'checkbox') {
      const list = data.getAll(`${f.id}[]`).slice(0, 200).map((s) => answer(s)).filter(Boolean);
      if (list.length) values[f.id] = list;
    } else if (f.type === 'name') {
      const parts: Partial<Record<NamePart, string>> = {};
      for (const p of visibleNameParts(f)) {
        const v = answer(data.get(`${f.id}[${p}]`));
        if (v) parts[p] = v;
      }
      if (Object.keys(parts).length) values[f.id] = parts;
    } else if (f.type === 'product') {
      // The choice or amount, and the quantity; a fixed price without a quantity is one of it.
      const mode = f.priceMode ?? 'fixed';
      const p: ProductValue = {};
      const v = answer(data.get(f.id), 40);
      if (v && mode !== 'fixed') p.value = v;
      const qty = f.quantity && mode !== 'amount' ? answer(data.get(`${f.id}[qty]`), 6) : '1';
      if (qty) p.qty = qty;
      if (p.value || mode === 'fixed') values[f.id] = p;
    } else {
      const v = answer(data.get(f.id), f.maxLength || MAX_ANSWER);
      if (v) values[f.id] = v;
    }
  }
  return values;
}

function validateProduct(f: Field, v: ProductValue | undefined, missing: string): string {
  const mode = f.priceMode ?? 'fixed';
  const value = v?.value ?? '';
  if (mode === 'choice') {
    if (!value) return f.required ? missing : '';
    if (!(f.choices ?? []).some((c) => c.value.trim() === value)) return 'Choose one of the options.';
  }
  if (mode === 'amount') {
    if (!value) return f.required ? missing : '';
    const min = Math.max(f.min ?? 0, 0);
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return f.errorMessage || 'Enter an amount, like 25 or 25.50.';
    const n = Number(value);
    if (n < min || (f.required && n <= 0)) return f.errorMessage || `Enter an amount of at least ${min || 0.01}.`;
    if (n > (f.max ?? MAX_AMOUNT)) return f.errorMessage || `Enter an amount no more than ${f.max ?? MAX_AMOUNT}.`;
  }
  if (f.quantity && mode !== 'amount') {
    const max = f.maxQuantity || MAX_QUANTITY;
    const q = v?.qty ?? '';
    if (q && (!/^\d+$/.test(q) || Number(q) > max)) return `Enter a quantity from 0 to ${max}.`;
    if (f.required && !(Number(q) >= 1)) return f.errorMessage || 'Choose a quantity of at least 1.';
  }
  return '';
}

function validate(f: Field, values: Values): string {
  const v = values[f.id];
  const missing = f.errorMessage || REQUIRED;
  if (f.type === 'product') return validateProduct(f, isProduct(v) ? v : undefined, missing);
  if (f.type === 'name') {
    const parts = (v ?? {}) as Partial<Record<NamePart, string>>;
    const absent = (['first', 'last'] as NamePart[]).filter((p) => !parts[p]);
    return f.required && absent.length ? `${missing} Please add ${absent.map((p) => (f.nameParts?.[p]?.label || NAME_LABELS[p]).toLowerCase()).join(' and ')} name.` : '';
  }
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return f.required ? missing : '';
  const s = String(v);
  switch (f.type) {
    case 'email':
      return EMAIL.test(s) ? '' : f.errorMessage || 'Enter an email address like name@example.com.';
    case 'url':
      return /^https?:\/\/[^\s.]+\.\S+$/i.test(s) ? '' : f.errorMessage || 'Enter a web address starting with https://.';
    case 'phone':
      return f.phoneFormat === 'any' || s.replace(/\D/g, '').length === 10 ? '' : f.errorMessage || 'Enter a 10-digit phone number.';
    case 'number': {
      const n = Number(s);
      if (isNaN(n)) return f.errorMessage || 'Enter a number.';
      if (f.min != null && n < f.min) return f.errorMessage || `Enter a number of at least ${f.min}.`;
      if (f.max != null && n > f.max) return f.errorMessage || `Enter a number no more than ${f.max}.`;
      return '';
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? '' : f.errorMessage || 'Enter a valid date.';
    case 'select':
    case 'radio':
      // Submitted values are trimmed; so are choices here (one saved with a trailing space still counts).
      return (f.choices ?? []).some((c) => c.value.trim() === s) ? '' : 'Choose one of the options.';
    case 'checkbox':
      return (v as string[]).every((x) => (f.choices ?? []).some((c) => c.value.trim() === x)) ? '' : 'Choose from the options.';
  }
  return '';
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * A notification's message as the email body. Messages from the rich text editor are HTML; older ones
 * are plain text, where line breaks become <br>.
 */
function emailBody(written: string, merged: string): string {
  // Decided on the message as written: field tags like {all_fields} expand to HTML either way.
  const html = /<(p|br|div|ul|ol|li|strong|b|em|i|a|h[1-6])\b/i.test(written) ? merged : merged.replace(/\n/g, '<br />\n');
  return html.replace(/<\s*(script|style|iframe)[\s\S]*?<\/\s*\1\s*>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
}

/**
 * Merge tags: {all_fields}, {form_title}, {admin_email}, {date}, {Label:f3}, {Label:f1.first}, and on a
 * form that takes payment {payment_total} and {payment_id}.
 */
export function mergeTags(text: string, row: FormRow, values: Values, opts: { html: boolean; adminEmail: string; payment?: SubmissionPayment | null }): string {
  const fields = row.definition.fields;
  const out = (s: string) => (opts.html ? escHtml(s).replace(/\n/g, '<br />') : s);
  return text.replace(/\{([^{}]*?)\}/g, (tag, inner: string) => {
    if (inner === 'all_fields') return allFields(row.definition, values, opts.html);
    if (inner === 'payment_total') return out(formatMoney(opts.payment?.amount ?? totalOf(lineItems(row.definition, values)), opts.payment?.currency ?? currencyOf(row.definition)));
    if (inner === 'payment_id') return out(opts.payment?.payment_id ?? '');
    if (inner === 'form_title') return out(row.title);
    if (inner === 'admin_email') return opts.adminEmail;
    if (inner === 'date' || inner === 'date_mdy') return new Intl.DateTimeFormat('en-US', { timeZone: SITE_TZ, dateStyle: 'long' }).format(new Date());
    const m = inner.match(/^(?:[^:]*):(f\d+)(?:\.(\w+))?$/);
    if (!m) return tag;
    const f = fields.find((x) => x.id === m[1]);
    if (!f) return '';
    if (m[2]) {
      const parts = values[f.id];
      return out(parts && typeof parts === 'object' && !Array.isArray(parts) ? (parts as Record<string, string>)[m[2]] ?? '' : '');
    }
    return out(displayValue(f, values));
  });
}

function allFields(def: FormDef, values: Values, html: boolean): string {
  const rows: (readonly [string, string])[] = def.fields
    .filter((f) => INPUT_TYPES.includes(f.type) && f.type !== 'hidden' && !isFieldHidden(def, f, values))
    .map((f) => [f.label, displayValue(f, values, currencyOf(def))] as const)
    .filter(([, v]) => v);
  const total = def.payment ? totalOf(lineItems(def, values)) : 0;
  if (total) rows.push(['Total', formatMoney(total, currencyOf(def))]);
  if (!html) return rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  return (
    `<table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">` +
    rows.map(([k, v]) => `<tr><td style="background:#f5f3f0;font-weight:600;border-bottom:1px solid #e5e1dc">${escHtml(k)}</td></tr><tr><td style="padding-bottom:14px;border-bottom:1px solid #e5e1dc">${escHtml(v).replace(/\n/g, '<br />')}</td></tr>`).join('') +
    `</table>`
  );
}

/** One field's answer as email HTML: its label in bold above it, or the answer alone. */
function fieldHtml(def: FormDef, values: Values, id: string, showLabel: boolean): string {
  if (id === 'all') return allFields(def, values, true);
  const f = def.fields.find((x) => x.id === id);
  if (!f || isFieldHidden(def, f, values)) return '';
  const v = escHtml(displayValue(f, values, currencyOf(def))).replace(/\n/g, '<br />');
  if (!v) return '';
  return showLabel ? `<p style="margin:0 0 4px 0;font-weight:600">${escHtml(f.label)}</p><p style="margin:0">${v}</p>` : `<p style="margin:0">${v}</p>`;
}

/** A notification as it would be sent for these values: recipients, reply-to, subject, HTML and text. */
export function renderNotification(row: FormRow, n: Notification, values: Values, origin: string, payment?: SubmissionPayment | null) {
  const adminEmail = env('FORMS_ADMIN_EMAIL') || site.adminEmail;
  const tags = { adminEmail, payment };
  const visitorEmail = row.definition.fields.find((f) => f.type === 'email' && typeof values[f.id] === 'string');
  const to = mergeTags(n.to, row, values, { ...tags, html: false })
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => EMAIL.test(s));
  const replyTo = n.replyTo ? mergeTags(n.replyTo, row, values, { ...tags, html: false }) : visitorEmail ? String(values[visitorEmail.id]) : undefined;
  const subject = mergeTags(n.subject || `New submission: ${row.title}`, row, values, { ...tags, html: false });
  // The builder's design; a notification from before it sends its message as it always has.
  const html = n.design
    ? renderEmail(
        n.design,
        {
          merge: (text, html) => mergeTags(text, row, values, { ...tags, html }),
          field: (id, showLabel) => fieldHtml(row.definition, values, id, showLabel),
          origin,
        },
        subject,
      )
    : emailBody(n.message || '{all_fields}', mergeTags(n.message || '{all_fields}', row, values, { ...tags, html: true }));
  const text = n.text?.trim() ? mergeTags(n.text, row, values, { ...tags, html: false }) : textVersion(html);
  return { to, replyTo: replyTo && EMAIL.test(replyTo) ? replyTo : undefined, subject, html, text, fromName: n.fromName || undefined };
}

export async function notify(row: FormRow, values: Values, origin: string, payment?: SubmissionPayment | null) {
  for (const n of (row.notifications ?? []) as Notification[]) {
    if (n.active === false) continue;
    const mail = renderNotification(row, n, values, origin, payment);
    if (!mail.to.length) continue;
    try {
      await sendMail(mail);
    } catch (e) {
      // The submission is stored either way; a mail outage shouldn't lose it or show the visitor an error.
      console.error(`form ${row.id}: notification "${n.name}" failed`, e);
    }
  }
}

export async function handleFormPost(data: FormData, request: Request): Promise<FormResult | null> {
  const formId = Number(data.get('_form'));
  if (!formId) return null;
  const db: SupabaseClient = serviceClient();
  const { data: row, error } = await db.from('forms').select('*').eq('id', formId).eq('is_active', true).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const form = row as FormRow;
  const def = form.definition;
  const confirmation = def.confirmation ?? { type: 'message', message: 'Thanks for contacting us! We will get in touch with you shortly.' };

  // A filled-in honeypot: act as if it worked, keep nothing.
  if (def.honeypot && String(data.get(HONEYPOT) ?? '').trim()) return { formId, ok: true, message: confirmation.message ?? '', errors: {}, values: {} };

  const values = collect(data, def);
  const errors: Record<string, string> = {};
  for (const f of def.fields) {
    if (!INPUT_TYPES.includes(f.type) || isFieldHidden(def, f, values)) continue;
    const message = validate(f, values);
    if (message) errors[f.id] = message;
  }
  if (Object.keys(errors).length) return { formId, ok: false, message: '', errors, values };

  // Fields hidden by logic aren't part of the entry.
  const entry: Values = Object.fromEntries(Object.entries(values).filter(([id]) => {
    const f = def.fields.find((x) => x.id === id);
    return f && !isFieldHidden(def, f, values);
  }));
  const { count, error: countError } = await db.from('form_submissions').select('id', { count: 'exact', head: true }).eq('form_id', formId).gte('created_at', new Date(Date.now() - 60_000).toISOString());
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_PER_MINUTE) return { formId, ok: false, busy: true, message: '', errors: {}, values };
  const labelled = Object.fromEntries(def.fields.filter((f) => INPUT_TYPES.includes(f.type) && entry[f.id] != null).map((f) => [f.label, displayValue(f, entry, currencyOf(def))]));
  const stored = { entry, values: labelled, referrer: request.headers.get('referer')?.slice(0, 500), user_agent: request.headers.get('user-agent')?.slice(0, 500) };

  // A total to pay: stored as pending and off to checkout; notifications wait for the payment.
  const items = def.payment ? lineItems(def, entry) : [];
  if (def.payment && totalOf(items)) {
    const started = await startCheckout(db, form, stored, items, request);
    if ('error' in started) return { formId, ok: false, message: '', errors: {}, notice: started.error, values };
    return { formId, ok: true, message: '', errors: {}, values: {}, redirect: started.url };
  }

  const { error: insertError } = await db.from('form_submissions').insert({ form: form.title, form_id: formId, data: stored });
  if (insertError) throw insertError;
  await notify(form, entry, new URL(request.url).origin);
  return confirmationResult(db, form, entry);
}

/** What the visitor sees once the form is sent (and paid for): its message, or a page or address to go to. */
export async function confirmationResult(db: SupabaseClient, form: FormRow, entry: Values, payment?: SubmissionPayment | null): Promise<FormResult> {
  const formId = form.id;
  const confirmation = form.definition.confirmation ?? { type: 'message', message: '' };
  const tags = { adminEmail: env('FORMS_ADMIN_EMAIL') || site.adminEmail, payment };
  if (confirmation.type === 'redirect' && confirmation.url) return { formId, ok: true, message: '', errors: {}, values: {}, redirect: mergeTags(confirmation.url, form, entry, { ...tags, html: false }) };
  if (confirmation.type === 'page' && confirmation.pageId) {
    const page = await new Loader(db).entryById(Number(confirmation.pageId));
    if (page) return { formId, ok: true, message: '', errors: {}, values: {}, redirect: permalink(page) };
  }
  return { formId, ok: true, message: mergeTags(confirmation.message || 'Thanks for contacting us! We will get in touch with you shortly.', form, entry, { ...tags, html: true }), errors: {}, values: {} };
}
