// Conditional logic, value formatting and helpers shared by the renderer, the submit handler, the
// builder and the submissions screen. The browser runs the same rules (public/assets/js/forms.js).
import type { Field, FormDef, Logic, NamePart, ProductValue, Rule, Value, Values } from './types';

export const HONEYPOT = '_hp';

/** Types that collect input (sections and HTML blocks don't). */
export const INPUT_TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'url', 'select', 'radio', 'checkbox', 'name', 'date', 'consent', 'product', 'hidden'];

export const NAME_PARTS: NamePart[] = ['prefix', 'first', 'middle', 'last', 'suffix'];
export const NAME_LABELS: Record<NamePart, string> = { prefix: 'Prefix', first: 'First', middle: 'Middle', last: 'Last', suffix: 'Suffix' };

/** Name parts shown for a field: first and last always, the others when switched on. */
export const visibleNameParts = (f: Field): NamePart[] => NAME_PARTS.filter((p) => p === 'first' || p === 'last' || f.nameParts?.[p]?.show);

export const logicOf = (f: Field): Logic | null => (f.logic?.rules?.length ? f.logic : null);
export const hasLogic = (form: FormDef) => form.fields.some((f) => logicOf(f));

/** A product's answer (names are the other value with parts). */
export const isProduct = (v: Value | undefined): v is ProductValue => !!v && typeof v === 'object' && !Array.isArray(v) && ('value' in v || 'qty' in v);

/** A field's value(s) as text, for comparing in rules. */
function ruleValues(v: Value | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  // A product compares its choice or amount.
  if (isProduct(v)) return v.value ? [v.value] : [];
  if (typeof v === 'object') return [NAME_PARTS.map((p) => v[p]).filter(Boolean).join(' ')];
  return [v];
}

function matches(op: Rule['op'], actual: string, target: string) {
  // Trimmed: a choice saved with a trailing space still matches what the browser sends.
  const a = actual.trim().toLowerCase();
  const t = String(target ?? '').trim().toLowerCase();
  switch (op) {
    case 'is': return a === t;
    case 'isnot': return a !== t;
    case '>': return Number(actual) > Number(target);
    case '<': return Number(actual) < Number(target);
    case 'contains': return a.includes(t);
    case 'starts_with': return a.startsWith(t);
    case 'ends_with': return a.endsWith(t);
    default: return false;
  }
}

export function ruleMatches(rule: Rule, values: Values) {
  const vals = ruleValues(values[rule.field]);
  // Checkboxes: "is" matches any checked value; "is not" requires that none match.
  if (rule.op === 'isnot') return vals.length ? vals.every((v) => matches('isnot', v, rule.value)) : String(rule.value ?? '') !== '';
  return vals.length ? vals.some((v) => matches(rule.op, v, rule.value)) : matches(rule.op, '', rule.value);
}

/** Whether a field is hidden by its conditional logic or by the section it sits in. */
export function isFieldHidden(form: FormDef, field: Field, values: Values, seen = new Set<string>()): boolean {
  if (seen.has(field.id)) return false;
  seen.add(field.id);
  const logic = logicOf(field);
  if (logic) {
    const results = logic.rules.map((r) => ruleMatches(r, values));
    const pass = logic.match === 'any' ? results.some(Boolean) : results.every(Boolean);
    if ((logic.action === 'show') !== pass) return true;
  }
  if (field.type !== 'section') {
    const i = form.fields.findIndex((f) => f.id === field.id);
    for (let j = i - 1; j >= 0; j--) if (form.fields[j].type === 'section') return isFieldHidden(form, form.fields[j], values, seen);
  }
  return false;
}

const choiceLabel = (f: Field, v: string) => f.choices?.find((c) => c.value.trim() === v.trim())?.label ?? v;

/** Amounts in the form's currency, e.g. $25.00 (amounts in minor units: cents). */
export function formatMoney(minor: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

/** A price in the form's currency as minor units (12.5 -> 1250). */
export const toMinor = (n: unknown) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) : 0);

/** A product's answer as text: "Gold member ($100.00) x 2", "$25.00". */
function productText(f: Field, v: ProductValue, currency: string): string {
  const mode = f.priceMode ?? 'fixed';
  const qty = f.quantity ? Number(v.qty) || 0 : 1;
  if (!qty) return '';
  const times = f.quantity ? ` x ${qty}` : '';
  if (mode === 'amount') return v.value ? formatMoney(toMinor(v.value), currency) : '';
  if (mode === 'choice') {
    const c = f.choices?.find((x) => x.value.trim() === String(v.value ?? '').trim());
    return c ? `${c.label} (${formatMoney(toMinor(c.price), currency)})${times}` : '';
  }
  return `${formatMoney(toMinor(f.price), currency)}${times}`;
}

/** A field's submitted value as text (emails, CSV, the submissions screen). */
export function displayValue(f: Field, values: Values, currency = 'USD'): string {
  const v = values[f.id];
  if (f.type === 'product') return isProduct(v) ? productText(f, v, currency) : '';
  if (v == null || v === '') return '';
  switch (f.type) {
    case 'name':
      return typeof v === 'object' && !Array.isArray(v) ? NAME_PARTS.map((p) => (v as Partial<Record<NamePart, string>>)[p]).filter(Boolean).join(' ') : String(v);
    case 'checkbox':
      return (Array.isArray(v) ? v : [String(v)]).map((x) => choiceLabel(f, x)).join(', ');
    case 'consent':
      return v === '1' ? 'Agreed' : '';
    case 'select':
    case 'radio':
      return choiceLabel(f, String(v));
    case 'date': {
      const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }) : String(v);
    }
    default:
      return String(v);
  }
}

/** form_submissions.payment.status, as the admin shows it. */
export const PAYMENT_STATUS: Record<string, string> = { pending: 'Unpaid', processing: 'Processing', paid: 'Paid', failed: 'Failed', cancelled: 'Cancelled' };

/** Width of a field on the 12-column grid. */
export const WIDTH_SPANS: Record<string, number> = { full: 12, 'three-quarters': 9, 'two-thirds': 8, half: 6, third: 4, quarter: 3 };
