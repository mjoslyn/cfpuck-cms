// Form markup. Fields sit on a 12-column grid; groups of inputs (names, choices, consent) are
// fieldsets; errors are tied to inputs with aria-describedby and summarised at the top. The browser
// script (public/assets/js/forms.js) applies conditional logic, formats phone numbers and counts
// characters, and keeps the total of a form that takes payment; without it the form still works and
// the server validates (and prices) everything.
import type { Field, FormDef, FormState, NamePart, ProductValue, Value, Values } from '../../lib/forms/types';
import { HONEYPOT, NAME_LABELS, formatMoney, isProduct, logicOf, toMinor, visibleNameParts, WIDTH_SPANS } from '../../lib/forms/logic';
import { MAX_QUANTITY, currencyOf, defaultProductValue, lineItems, productsOf, totalOf } from '../../lib/forms/payment';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Ctx {
  form: FormDef;
  uid: string;
  state?: FormState;
}

const val = (c: Ctx, f: Field): Value | undefined => (c.state ? c.state.values[f.id] : f.type === 'product' ? defaultProductValue(f) : f.default);
const text = (v: Value | undefined) => (typeof v === 'string' ? v : '');
const err = (c: Ctx, f: Field) => c.state?.errors[f.id];

function describedBy(c: Ctx, f: Field) {
  const ids = [f.description ? `${c.uid}-${f.id}-desc` : '', err(c, f) ? `${c.uid}-${f.id}-error` : ''].filter(Boolean);
  return ids.length ? ` aria-describedby="${ids.join(' ')}"` : '';
}

const aria = (c: Ctx, f: Field) => `${f.required ? ' required aria-required="true"' : ''}${err(c, f) ? ' aria-invalid="true"' : ''}${describedBy(c, f)}`;

function input(c: Ctx, f: Field): string {
  const id = `${c.uid}-${f.id}`;
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  const v = val(c, f);
  switch (f.type) {
    case 'text':
    case 'email':
    case 'url':
    case 'number':
    case 'date':
    case 'phone': {
      const type = f.type === 'phone' ? 'tel' : f.type;
      const extra = [
        f.maxLength ? ` maxlength="${f.maxLength}" data-count` : '',
        f.type === 'number' && f.min != null ? ` min="${f.min}"` : '',
        f.type === 'number' && f.max != null ? ` max="${f.max}"` : '',
        f.type === 'number' ? ' step="any" inputmode="decimal"' : '',
        f.type === 'phone' && f.phoneFormat !== 'any' ? ' data-mask="us-phone" inputmode="tel"' : '',
        f.type === 'email' ? ' autocomplete="email"' : f.type === 'phone' ? ' autocomplete="tel"' : f.type === 'url' ? ' autocomplete="url"' : '',
      ].join('');
      return `<input class="c-input" id="${id}" name="${f.id}" type="${type}" value="${esc(text(v))}"${ph}${extra}${aria(c, f)} />`;
    }
    case 'textarea':
      return `<textarea class="c-input" id="${id}" name="${f.id}" rows="6"${ph}${f.maxLength ? ` maxlength="${f.maxLength}" data-count` : ''}${aria(c, f)}>${esc(text(v))}</textarea>`;
    case 'select': {
      const current = text(v) || (c.state ? '' : f.choices?.find((x) => x.selected)?.value ?? '');
      const opts = (f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : '') + (f.choices ?? []).map((ch) => `<option value="${esc(ch.value)}"${ch.value === current ? ' selected' : ''}>${esc(ch.label)}</option>`).join('');
      return `<select class="c-input" id="${id}" name="${f.id}"${aria(c, f)}>${opts}</select>`;
    }
    case 'radio':
    case 'checkbox': {
      const current = f.type === 'checkbox' ? (Array.isArray(v) ? v : c.state ? [] : (f.choices ?? []).filter((x) => x.selected).map((x) => x.value)) : [text(v) || (c.state ? '' : f.choices?.find((x) => x.selected)?.value ?? '')];
      const name = f.type === 'checkbox' ? `${f.id}[]` : f.id;
      return `<div class="c-choices">${(f.choices ?? [])
        .map((ch, i) => `<label class="c-choice" for="${id}-${i}"><input id="${id}-${i}" type="${f.type}" name="${name}" value="${esc(ch.value)}"${current.includes(ch.value) ? ' checked' : ''}${i === 0 ? describedBy(c, f) : ''} /><span>${ch.label}</span></label>`)
        .join('')}</div>`;
    }
    case 'name': {
      const parts = typeof v === 'object' && !Array.isArray(v) ? (v as Partial<Record<NamePart, string>>) : {};
      const bad = err(c, f);
      return `<div class="c-field__row">${visibleNameParts(f)
        .map((p) => {
          const required = f.required && (p === 'first' || p === 'last');
          const auto = { prefix: 'honorific-prefix', first: 'given-name', middle: 'additional-name', last: 'family-name', suffix: 'honorific-suffix' }[p];
          return `<div class="c-subfield is-${p}"><input class="c-input" id="${id}-${p}" name="${f.id}[${p}]" type="text" value="${esc(parts[p] ?? '')}" autocomplete="${auto}"${required ? ' required aria-required="true"' : ''}${bad && required && !parts[p] ? ' aria-invalid="true"' : ''}${describedBy(c, f)} /><label class="c-subfield__label" for="${id}-${p}">${esc(f.nameParts?.[p]?.label || NAME_LABELS[p])}</label></div>`;
        })
        .join('')}</div>`;
    }
    case 'consent':
      return `<label class="c-choice" for="${id}"><input id="${id}" type="checkbox" name="${f.id}" value="1"${text(v) === '1' ? ' checked' : ''}${aria(c, f)} /><span>${f.consentText ?? ''}</span></label>`;
    case 'hidden':
      return `<input type="hidden" name="${f.id}" value="${esc(text(v))}" />`;
    case 'product':
      return product(c, f, isProduct(v) ? v : {});
    default:
      return '';
  }
}

/** A product: its price, choices or amount, and a quantity. Prices ride along as data-price for the total. */
function product(c: Ctx, f: Field, v: ProductValue): string {
  const id = `${c.uid}-${f.id}`;
  const cur = currencyOf(c.form);
  const money = (n: unknown) => formatMoney(toMinor(n), cur);
  const mode = f.priceMode ?? 'fixed';
  let main = '';
  if (mode === 'fixed') main = `<p class="c-product__price" data-price="${toMinor(f.price)}">${money(f.price)}</p>`;
  else if (mode === 'amount') {
    const min = f.min != null && f.min > 0 ? ` min="${f.min}"` : ' min="0"';
    const max = f.max != null ? ` max="${f.max}"` : '';
    const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
    main = `<div class="c-product__amount"><span class="c-product__currency" aria-hidden="true">${esc(money(0).replace(/[\d.,\s]/g, '') || cur)}</span><input class="c-input" id="${id}" name="${f.id}" type="number" step="0.01"${min}${max} inputmode="decimal" value="${esc(v.value ?? '')}" data-amount${ph}${aria(c, f)} /></div>`;
  } else if (f.choiceDisplay === 'radio') {
    main = `<div class="c-choices">${(f.choices ?? [])
      .map((ch, i) => `<label class="c-choice" for="${id}-${i}"><input id="${id}-${i}" type="radio" name="${f.id}" value="${esc(ch.value)}" data-price="${toMinor(ch.price)}"${ch.value === v.value ? ' checked' : ''}${i === 0 ? describedBy(c, f) : ''} /><span>${esc(ch.label)} <span class="c-product__price">${money(ch.price)}</span></span></label>`)
      .join('')}</div>`;
  } else {
    const opts = (f.placeholder ? `<option value="" data-price="0">${esc(f.placeholder)}</option>` : '') + (f.choices ?? []).map((ch) => `<option value="${esc(ch.value)}" data-price="${toMinor(ch.price)}"${ch.value === v.value ? ' selected' : ''}>${esc(ch.label)} (${money(ch.price)})</option>`).join('');
    main = `<select class="c-input" id="${id}" name="${f.id}"${aria(c, f)}>${opts}</select>`;
  }
  if (!f.quantity || mode === 'amount') return main;
  // A fixed price's quantity is its input (the label points to it); otherwise it sits beside the choice.
  const qid = mode === 'fixed' ? id : `${id}-qty`;
  const qty = `<input class="c-input c-product__qty" id="${qid}" name="${f.id}[qty]" type="number" min="0" max="${f.maxQuantity || MAX_QUANTITY}" step="1" inputmode="numeric" value="${esc(v.qty ?? '')}" data-qty${mode === 'fixed' ? aria(c, f) : ''} />`;
  return `<div class="c-product__row">${main}<div class="c-subfield is-qty">${qty}<label class="c-subfield__label" for="${qid}">Quantity</label></div></div>`;
}

/** Products shown as a group of inputs (radio choices) or with no input (one price) take a legend. */
const productGroup = (f: Field) => (f.priceMode === 'choice' ? f.choiceDisplay === 'radio' : (f.priceMode ?? 'fixed') === 'fixed' && !f.quantity);

/** The total under the fields: worked out here for the first render, kept by forms.js after. */
function totalLine(form: FormDef, state?: FormState): string {
  if (!form.payment || !productsOf(form).length) return '';
  const values: Values = state?.values ?? Object.fromEntries(productsOf(form).map((f) => [f.id, defaultProductValue(f)]));
  const total = totalOf(lineItems(form, values));
  return `<p class="c-form__total">Total <output data-total data-currency="${esc(currencyOf(form))}" aria-live="polite">${formatMoney(total, currencyOf(form))}</output></p>`;
}

const GROUPS = new Set(['radio', 'checkbox', 'name', 'consent']);

function field(c: Ctx, f: Field, section: string | null): string {
  const span = WIDTH_SPANS[f.width ?? 'full'] ?? 12;
  const attrs = `data-field="${f.id}"${section ? ` data-section="${section}"` : ''}${logicOf(f) ? ' data-logic' : ''}`;
  const cls = ['c-field', `is-${f.type}`, span < 12 ? `span-${span}` : '', err(c, f) ? 'has-error' : '', f.className ?? ''].filter(Boolean).join(' ');
  if (f.type === 'hidden') return `<div class="${cls} is-hidden-input" ${attrs} hidden>${input(c, f)}</div>`;
  if (f.type === 'section') return `<div class="${cls}" ${attrs}><h3 class="c-form__section">${esc(f.label)}</h3>${f.description ? `<p class="c-field__desc">${f.description}</p>` : ''}</div>`;
  if (f.type === 'html') return `<div class="${cls}" ${attrs}>${f.html ?? ''}</div>`;
  const group = GROUPS.has(f.type) || (f.type === 'product' && productGroup(f));
  const req = f.required ? ' <span class="c-field__req">(Required)</span>' : '';
  const label = group ? `<legend class="c-field__label">${esc(f.label)}${req}</legend>` : `<label class="c-field__label" for="${c.uid}-${f.id}">${esc(f.label)}${req}</label>`;
  const desc = f.description ? `<p class="c-field__desc" id="${c.uid}-${f.id}-desc">${f.description}</p>` : '';
  const counter = f.maxLength && (f.type === 'text' || f.type === 'textarea') ? `<p class="c-field__count" aria-live="polite" data-count-for="${c.uid}-${f.id}"></p>` : '';
  const error = err(c, f) ? `<p class="c-field__error" id="${c.uid}-${f.id}-error">${err(c, f)}</p>` : '';
  const body = `${label}${f.descriptionAbove ? desc : ''}${input(c, f)}${counter}${f.descriptionAbove ? '' : desc}${error}`;
  const tag = group ? 'fieldset' : 'div';
  return `<${tag} class="${cls}" ${attrs}>${body}</${tag}>`;
}

export interface RenderOptions {
  /** Where the form posts back to (the page it is on). */
  action: string;
  title?: boolean;
  description?: boolean;
  state?: FormState;
}

export function renderForm(form: FormDef, opts: RenderOptions): string {
  const uid = `form-${form.id}`;
  const c: Ctx = { form, uid, state: opts.state };
  const errors = opts.state ? Object.keys(opts.state.errors).length : 0;
  const notice = !errors && opts.state?.notice ? opts.state.notice : '';
  // Fields after a section heading belong to it (and hide with it).
  let section: string | null = null;
  const fields = form.fields
    .map((f) => {
      if (f.type === 'section') section = f.id;
      return field(c, f, f.type === 'section' ? null : section);
    })
    .join('');
  const logic = Object.fromEntries(form.fields.filter((f) => logicOf(f)).map((f) => [f.id, f.logic]));
  const honeypot = form.honeypot
    ? `<div class="c-field is-hp" aria-hidden="true"><label for="${uid}-hp">Leave this empty</label><input id="${uid}-hp" name="${HONEYPOT}" type="text" tabindex="-1" autocomplete="off" /></div>`
    : '';
  return (
    `<div class="c-form${form.labelPlacement === 'left' ? ' is-labels-left' : ''}${form.className ? ` ${esc(form.className)}` : ''}" id="${uid}">` +
    (opts.title ? `<h2 class="c-form__title">${esc(form.title)}</h2>` : '') +
    (opts.description && form.description ? `<p class="c-form__desc">${form.description}</p>` : '') +
    (errors ? `<div class="c-form__errors" role="alert" tabindex="-1" data-focus>There was a problem with your submission. Please check the ${errors === 1 ? 'highlighted field' : `${errors} highlighted fields`}.${opts.state?.notice ? ` ${esc(opts.state.notice)}` : ''}</div>` : '') +
    (notice ? `<div class="c-form__errors" role="alert" tabindex="-1" data-focus>${esc(notice)}</div>` : '') +
    `<form class="c-form__form" method="post" action="${esc(opts.action)}#${uid}" novalidate${Object.keys(logic).length ? ` data-logic="${esc(JSON.stringify(logic))}"` : ''}>` +
    `<input type="hidden" name="_form" value="${form.id}" />` +
    `<div class="c-form__fields">${fields}${honeypot}</div>` +
    `<div class="c-form__footer">${totalLine(form, opts.state)}<button type="submit" class="c-button__link c-form__submit">${esc(form.submitLabel || 'Submit')}</button></div>` +
    `</form></div>`
  );
}

export function renderConfirmation(form: FormDef, messageHtml: string): string {
  return `<div class="c-form is-done" id="form-${form.id}"><div class="c-form__confirmation" role="status" tabindex="-1" data-focus>${messageHtml}</div></div>`;
}

export const FORM_SCRIPT = '<script src="/assets/js/forms.js" defer></script>';
