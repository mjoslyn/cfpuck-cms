// What a form charges: its Product fields' answers as line items and their total. Shared by the
// renderer (the total under the fields), the submit handler (the charge) and the builder. The browser
// works the total out the same way for display (public/assets/js/forms.js); the server's is the charge.
import type { Field, FormDef, ProductValue, Values } from './types';
import { isFieldHidden, isProduct } from './logic';
import { toMinor } from '../payments/money';

/** No form takes more than this in one checkout. */
export const MAX_CHARGE = 99_999_999;
export const MAX_QUANTITY = 100;

export interface LineItem {
  fieldId: string;
  name: string;
  /** Price of one, in minor units. */
  unit: number;
  quantity: number;
}

export const currencyOf = (def: FormDef) => def.payment?.currency || 'USD';
export const productsOf = (def: FormDef) => def.fields.filter((f) => f.type === 'product');

/** The quantity a product shows before the visitor changes it: one of a required product or a choice, else none. */
export const defaultQuantity = (f: Field) => (f.required || f.priceMode === 'choice' ? 1 : 0);

/** A product's answer before the visitor changes it (the builder preview and the first render). */
export function defaultProductValue(f: Field): ProductValue {
  const mode = f.priceMode ?? 'fixed';
  const out: ProductValue = {};
  if (mode === 'choice') {
    const c = f.choices?.find((x) => x.selected);
    if (c) out.value = c.value;
  } else if (mode === 'amount' && f.default) out.value = f.default;
  out.qty = String(f.quantity ? defaultQuantity(f) : 1);
  return out;
}

function item(f: Field, v: ProductValue): LineItem | null {
  const mode = f.priceMode ?? 'fixed';
  const quantity = f.quantity && mode !== 'amount' ? Math.floor(Number(v.qty) || 0) : 1;
  if (quantity <= 0) return null;
  let unit = 0;
  let name = f.label || 'Item';
  if (mode === 'fixed') unit = toMinor(f.price);
  else if (mode === 'amount') unit = toMinor(v.value);
  else {
    const c = f.choices?.find((x) => x.value.trim() === String(v.value ?? '').trim());
    if (!c) return null;
    unit = toMinor(c.price);
    name = `${name}: ${c.label}`;
  }
  return unit > 0 ? { fieldId: f.id, name, unit, quantity } : null;
}

/** The products answered, leaving out those conditional logic hides. */
export function lineItems(def: FormDef, values: Values): LineItem[] {
  const out: LineItem[] = [];
  for (const f of productsOf(def)) {
    const v = values[f.id];
    if (!isProduct(v) || isFieldHidden(def, f, values)) continue;
    const it = item(f, v);
    if (it) out.push(it);
  }
  return out;
}

export const totalOf = (items: LineItem[]) => items.reduce((sum, it) => sum + it.unit * it.quantity, 0);
