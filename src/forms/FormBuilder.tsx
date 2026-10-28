// Form builder (/admin/forms/<id>/). The preview is the real form markup from the site renderer, shown
// in an iframe with the site stylesheet: click a field to edit it, drag fields to reorder, drag or
// click palette items to add. Fields, settings, confirmation, payment and notifications save together.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { browserClient } from '../lib/db/browser';
import { defaultTemplate } from '../lib/email-templates';
import { renderForm } from '../render/forms/form';
import { INPUT_TYPES, NAME_LABELS, NAME_PARTS, logicOf } from '../lib/forms/logic';
import { FIELD_TYPES, defaultNotification, newField } from '../lib/forms/defaults';
import type { Choice, Confirmation, Field, FieldType, FormDef, Logic, Notification, Operator, PaymentProvider, PaymentSettings, PriceMode, Width } from '../lib/forms/types';
import { MAX_QUANTITY, productsOf } from '../lib/forms/payment';
import { CURRENCIES } from '../lib/payments/money';
import type { ProviderStatus } from '../lib/payments';
import siteCss from '../styles/site.css?url';
import { site, typeDef } from '../lib/site';
import { MergeTags, mergeTagOptions } from './rich-message';
import EmailBuilder from './EmailBuilder';
import { formEmailKit } from './form-email';
import ComposeForm, { type ComposeAsk, type Composed } from './ComposeForm';
import { defaultEmail, emailFromMessage, type EmailDoc } from '../lib/forms/email';

const input = 'w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent';
const labelCls = 'mb-1 block text-xs font-medium text-admin-muted';
const btn = 'rounded border border-admin-ink/15 bg-white px-2.5 py-1 text-xs hover:border-admin-accent hover:text-admin-accent disabled:opacity-40';

interface Row {
  id: number;
  title: string;
  definition: FormDef;
  notifications: Notification[];
  is_active: boolean;
}

type Tab = 'build' | 'settings' | 'confirmation' | 'payment' | 'notifications';

type Providers = Record<PaymentProvider, ProviderStatus>;

// Small controls ---------------------------------------------------------------------------

function Labelled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[#94a3b8]">{hint}</span>}
    </label>
  );
}

function TextIn({ label, value, onChange, placeholder, hint }: { label: string; value: unknown; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <Labelled label={label} hint={hint}>
      <input className={input} value={String(value ?? '')} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Labelled>
  );
}

function Area({ label, value, onChange, rows = 3, mono, hint }: { label: string; value: unknown; onChange: (v: string) => void; rows?: number; mono?: boolean; hint?: string }) {
  return (
    <Labelled label={label} hint={hint}>
      <textarea className={`${input} ${mono ? 'font-mono text-xs' : ''}`} rows={rows} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    </Labelled>
  );
}

function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T | undefined; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <Labelled label={label}>
      <select className={input} value={value ?? options[0][0]} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Labelled>
  );
}

function Check({ label, value, onChange }: { label: string; value: unknown; onChange: (v: boolean) => void }) {
  return (
    <label className="mb-3 flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open className="border-t border-admin-ink/10 py-3">
      <summary className="mb-2 cursor-pointer text-[11px] font-semibold tracking-wider text-admin-muted uppercase">{title}</summary>
      {children}
    </details>
  );
}

const num = (v: string) => (v.trim() === '' || isNaN(Number(v)) ? undefined : Number(v));

// Choices -----------------------------------------------------------------------------------------

function ChoicesEditor({ form, field, onChange }: { form: FormDef; field: Field; onChange: (patch: Partial<Field>) => void }) {
  /** The fields whose conditions test this field for a value. */
  const usedBy = (value: string) => form.fields.filter((f) => logicOf(f)?.rules.some((r) => r.field === field.id && String(r.value).trim() === value.trim())).map((f) => f.label || f.id);
  const remove = (i: number) => {
    const users = usedBy(choices[i].value);
    if (users.length && !confirm(`${users.join(', ')} ${users.length === 1 ? 'shows or hides' : 'show or hide'} based on "${choices[i].label}". Remove the choice anyway?`)) return;
    commit(choices.filter((_, j) => j !== i));
  };
  const choices: Choice[] = field.choices ?? [];
  const [bulk, setBulk] = useState<string | null>(null);
  const multi = field.type === 'checkbox';
  // A product's choices carry prices ("Label | 25" as a list) and store their labels.
  const priced = field.type === 'product';
  const commit = (next: Choice[]) => onChange({ choices: next });
  const set = (i: number, patch: Partial<Choice>) =>
    commit(
      choices.map((c, j) => {
        if (j === i) {
          const merged = { ...c, ...patch };
          // Without separate values, the value follows the label.
          if (patch.label != null && !field.choiceValues) merged.value = patch.label;
          return merged;
        }
        // Single-choice fields have at most one preselected option.
        return patch.selected && !multi ? { ...c, selected: false } : c;
      }),
    );
  const move = (i: number, d: number) => {
    const next = [...choices];
    const [c] = next.splice(i, 1);
    next.splice(i + d, 0, c);
    commit(next);
  };
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className={labelCls}>Choices</span>
        <button type="button" className="text-xs text-admin-muted underline" onClick={() => setBulk(bulk == null ? choices.map((c) => (priced ? `${c.label} | ${c.price ?? 0}` : field.choiceValues && c.value !== c.label ? `${c.label} | ${c.value}` : c.label)).join('\n') : null)}>
          {bulk == null ? 'Edit as list' : 'Cancel'}
        </button>
      </div>
      {bulk != null ? (
        <>
          <textarea className={input} rows={6} value={bulk} onChange={(e) => setBulk(e.target.value)} />
          {priced ? <p className="mt-1 text-xs text-admin-muted">One per line, as "Label | price".</p> : field.choiceValues && <p className="mt-1 text-xs text-admin-muted">One per line; "Label | value" for a value different from the label.</p>}
          <button
            type="button"
            className={`${btn} mt-1`}
            onClick={() => {
              // One choice per line ("Label | value" with separate values); a choice already there keeps its
              // value and default selection.
              commit(
                bulk
                  .split('\n')
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .map((line) => {
                    if (priced) {
                      const [label, price] = line.split('|', 2).map((x) => x.trim());
                      const had = choices.find((c) => c.label === label);
                      return { ...had, label, value: label, price: num(String(price ?? '').replace(/^\$/, '')) ?? had?.price ?? 0 };
                    }
                    const [label, value] = field.choiceValues && line.includes('|') ? line.split('|', 2).map((x) => x.trim()) : [line, undefined];
                    const had = choices.find((c) => c.label === label);
                    return { ...had, label, value: value || (field.choiceValues ? had?.value : undefined) || label };
                  }),
              );
              setBulk(null);
            }}
          >
            Apply
          </button>
        </>
      ) : (
        <div className="space-y-1">
          {choices.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <input type={multi ? 'checkbox' : 'radio'} title="Selected by default" checked={!!c.selected} onChange={(e) => set(i, { selected: e.target.checked || undefined })} onClick={() => !multi && c.selected && set(i, { selected: undefined })} />
              <input className={`${input} py-1`} value={c.label} onChange={(e) => set(i, { label: e.target.value })} onBlur={() => c.label !== c.label.trim() && set(i, { label: c.label.trim() })} />
              {priced && <input className={`${input} w-20 py-1`} type="number" min="0" step="0.01" title="Price" placeholder="Price" value={c.price ?? ''} onChange={(e) => set(i, { price: num(e.target.value) })} />}
              {field.choiceValues && !priced && <input className={`${input} w-24 py-1`} placeholder="Value" value={c.value} onChange={(e) => set(i, { value: e.target.value })} onBlur={() => c.value !== c.value.trim() && set(i, { value: c.value.trim() })} />}
              <button type="button" className="px-1 text-xs text-admin-muted disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                Up
              </button>
              <button type="button" className="px-1 text-xs text-admin-muted disabled:opacity-30" disabled={i === choices.length - 1} onClick={() => move(i, 1)} title="Move down">
                Dn
              </button>
              <button type="button" className="px-1 text-xs text-[#b91c1c]" onClick={() => remove(i)} title="Remove">
                x
              </button>
            </div>
          ))}
          <button type="button" className={btn} onClick={() => commit([...choices, { label: `Choice ${choices.length + 1}`, value: `Choice ${choices.length + 1}`, ...(priced ? { price: 0 } : {}) }])}>
            Add choice
          </button>
        </div>
      )}
      {!priced && (
        <div className="mt-2">
          <Check label="Store different values from the labels (e.g. codes)" value={field.choiceValues} onChange={(v) => onChange({ choiceValues: v || undefined })} />
        </div>
      )}
    </div>
  );
}

// Conditional logic --------------------------------------------------------------------------------

const OPERATORS: [Operator, string][] = [
  ['is', 'is'],
  ['isnot', 'is not'],
  ['contains', 'contains'],
  ['starts_with', 'starts with'],
  ['ends_with', 'ends with'],
  ['>', 'greater than'],
  ['<', 'less than'],
];

function LogicEditor({ form, field, onChange }: { form: FormDef; field: Field; onChange: (logic: Logic | null) => void }) {
  const logic = logicOf(field);
  const sources = form.fields.filter((f) => f.id !== field.id && INPUT_TYPES.includes(f.type) && f.type !== 'hidden');
  if (!sources.length) return <p className="text-xs text-[#94a3b8]">Add another field to show or hide this one based on its answer.</p>;
  if (!logic) {
    return (
      <button type="button" className={btn} onClick={() => onChange({ action: 'show', match: 'all', rules: [{ field: sources[0].id, op: 'is', value: '' }] })}>
        Show or hide based on answers
      </button>
    );
  }
  const set = (patch: Partial<Logic>) => onChange({ ...logic, ...patch });
  const setRule = (i: number, patch: Partial<Logic['rules'][number]>) => set({ rules: logic.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-1">
        <select className={`${input} w-auto py-1`} value={logic.action} onChange={(e) => set({ action: e.target.value as Logic['action'] })}>
          <option value="show">Show</option>
          <option value="hide">Hide</option>
        </select>
        <span>this field if</span>
        <select className={`${input} w-auto py-1`} value={logic.match} onChange={(e) => set({ match: e.target.value as Logic['match'] })}>
          <option value="all">all</option>
          <option value="any">any</option>
        </select>
        <span>of these match:</span>
      </div>
      {logic.rules.map((r, i) => {
        const src = sources.find((f) => f.id === r.field);
        const opts = src?.choices?.length ? src.choices : null;
        return (
          <div key={i} className="rounded border border-admin-ink/10 bg-admin-bg p-2">
            <select className={`${input} mb-1 py-1`} value={r.field} onChange={(e) => setRule(i, { field: e.target.value, value: '' })}>
              {sources.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label || f.id}
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              <select className={`${input} w-auto py-1`} value={r.op} onChange={(e) => setRule(i, { op: e.target.value as Operator })}>
                {OPERATORS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              {opts && (r.op === 'is' || r.op === 'isnot') ? (
                <select className={`${input} py-1`} value={r.value} onChange={(e) => setRule(i, { value: e.target.value })}>
                  <option value="">(empty)</option>
                  {opts.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input className={`${input} py-1`} value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} />
              )}
              <button type="button" className="px-1 text-xs text-[#b91c1c]" onClick={() => (logic.rules.length > 1 ? set({ rules: logic.rules.filter((_, j) => j !== i) }) : onChange(null))}>
                x
              </button>
            </div>
          </div>
        );
      })}
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={() => set({ rules: [...logic.rules, { field: sources[0].id, op: 'is', value: '' }] })}>
          Add rule
        </button>
        <button type="button" className={btn} onClick={() => onChange(null)}>
          Always show
        </button>
      </div>
    </div>
  );
}

// Field settings -------------------------------------------------------------------------------------

const WIDTHS: [Width, string][] = [
  ['full', 'Full width'],
  ['three-quarters', 'Three quarters'],
  ['two-thirds', 'Two thirds'],
  ['half', 'Half'],
  ['third', 'One third'],
  ['quarter', 'One quarter'],
];

function FieldSettings({ form, field, onChange }: { form: FormDef; field: Field; onChange: (patch: Partial<Field>) => void }) {
  const t = field.type;
  const takesInput = INPUT_TYPES.includes(t);
  const mode = field.priceMode ?? 'fixed';
  const hasPlaceholder = ['text', 'textarea', 'email', 'phone', 'number', 'url', 'select'].includes(t) || (t === 'product' && (mode === 'amount' || (mode === 'choice' && field.choiceDisplay !== 'radio')));
  const hasDefault = ['text', 'textarea', 'email', 'phone', 'number', 'url', 'hidden', 'date'].includes(t) || (t === 'product' && mode === 'amount');
  return (
    <div>
      {t !== 'html' && <TextIn label={t === 'hidden' ? 'Name (only you see this)' : t === 'section' ? 'Heading' : 'Label'} value={field.label} onChange={(v) => onChange({ label: v })} />}
      {t === 'html' && <Area label="HTML" value={field.html} rows={8} mono onChange={(v) => onChange({ html: v })} />}
      {t !== 'hidden' && t !== 'html' && <Area label={t === 'section' ? 'Text under the heading' : 'Description'} value={field.description} rows={2} onChange={(v) => onChange({ description: v || undefined })} />}
      {t === 'consent' && <Area label="Checkbox text" value={field.consentText} rows={2} onChange={(v) => onChange({ consentText: v })} />}
      {(t === 'select' || t === 'radio' || t === 'checkbox') && <ChoicesEditor form={form} field={field} onChange={onChange} />}
      {t === 'product' && (
        <>
          {!form.payment && <p className="mb-3 rounded bg-admin-soft p-2 text-xs text-admin-muted">This form doesn't take payment yet: choose how in the Payment tab.</p>}
          <Pick<PriceMode>
            label="Price"
            value={mode}
            options={[['fixed', 'One price'], ['choice', 'A choice of prices'], ['amount', 'An amount the visitor enters']]}
            onChange={(v) =>
              onChange({
                priceMode: v,
                ...(v === 'choice' && !field.choices?.length ? { choices: [['Option one', 10], ['Option two', 20]].map(([label, price]) => ({ label: String(label), value: String(label), price: Number(price) })) } : {}),
                ...(v === 'amount' ? { quantity: undefined } : {}),
              })
            }
          />
          {mode === 'fixed' && <TextIn label="Price" value={field.price} placeholder="25.00" onChange={(v) => onChange({ price: num(v.replace(/^\$/, '')) })} />}
          {mode === 'choice' && (
            <>
              <Pick label="Show as" value={field.choiceDisplay ?? 'select'} options={[['select', 'Dropdown'], ['radio', 'Multiple choice']]} onChange={(v) => onChange({ choiceDisplay: v === 'select' ? undefined : v })} />
              <ChoicesEditor form={form} field={field} onChange={onChange} />
            </>
          )}
          {mode === 'amount' && (
            <div className="grid grid-cols-2 gap-2">
              <TextIn label="Smallest amount" value={field.min} onChange={(v) => onChange({ min: num(v) })} />
              <TextIn label="Largest amount" value={field.max} onChange={(v) => onChange({ max: num(v) })} />
            </div>
          )}
          {mode !== 'amount' && <Check label="The visitor chooses a quantity" value={field.quantity} onChange={(v) => onChange({ quantity: v || undefined })} />}
          {mode !== 'amount' && field.quantity && <TextIn label="Most they can choose" value={field.maxQuantity} placeholder={String(MAX_QUANTITY)} onChange={(v) => onChange({ maxQuantity: num(v) })} />}
          <p className="mb-3 text-[11px] text-[#94a3b8]">
            {mode === 'fixed' && !field.quantity
              ? 'Charged whenever this field shows (conditional logic can hide it).'
              : field.required
                ? 'Required: the visitor must choose something here.'
                : 'Optional: nothing is charged for it unless the visitor chooses.'}
          </p>
        </>
      )}
      {t === 'name' && (
        <div className="mb-3">
          <span className={labelCls}>Parts (and their labels)</span>
          {NAME_PARTS.map((p) => {
            const fixed = p === 'first' || p === 'last';
            const part = field.nameParts?.[p] ?? {};
            const setPart = (patch: { show?: boolean; label?: string }) => {
              const next = { ...part, ...patch };
              for (const k of Object.keys(next) as (keyof typeof next)[]) if (!next[k]) delete next[k];
              onChange({ nameParts: { ...(field.nameParts ?? {}), [p]: next } });
            };
            return (
              <div key={p} className="mb-1 flex items-center gap-2">
                <input type="checkbox" disabled={fixed} checked={fixed || !!part.show} onChange={(e) => setPart({ show: e.target.checked || undefined })} />
                <input className={`${input} py-1`} value={part.label ?? ''} placeholder={NAME_LABELS[p]} onChange={(e) => setPart({ label: e.target.value || undefined })} />
              </div>
            );
          })}
        </div>
      )}
      {takesInput && t !== 'hidden' && !(t === 'product' && mode === 'fixed' && !field.quantity) && <Check label="Required" value={field.required} onChange={(v) => onChange({ required: v || undefined })} />}

      {(hasPlaceholder || hasDefault) && (
        <Section title="Input">
          {hasPlaceholder && <TextIn label={t === 'select' ? 'First option (placeholder)' : 'Placeholder'} value={field.placeholder} onChange={(v) => onChange({ placeholder: v || undefined })} />}
          {hasDefault && <TextIn label="Default value" value={field.default} placeholder={t === 'date' ? 'YYYY-MM-DD' : undefined} onChange={(v) => onChange({ default: v || undefined })} />}
          {(t === 'text' || t === 'textarea') && <TextIn label="Maximum characters" value={field.maxLength} onChange={(v) => onChange({ maxLength: num(v) })} />}
          {t === 'number' && (
            <div className="grid grid-cols-2 gap-2">
              <TextIn label="Minimum" value={field.min} onChange={(v) => onChange({ min: num(v) })} />
              <TextIn label="Maximum" value={field.max} onChange={(v) => onChange({ max: num(v) })} />
            </div>
          )}
          {t === 'phone' && <Pick label="Format" value={field.phoneFormat ?? 'us'} options={[['us', 'US: (###) ###-####'], ['any', 'Any']]} onChange={(v) => onChange({ phoneFormat: v })} />}
        </Section>
      )}

      {t !== 'hidden' && (
        <Section title="Layout">
          <Pick label="Width" value={field.width ?? 'full'} options={WIDTHS} onChange={(v) => onChange({ width: v === 'full' ? undefined : v })} />
          {t !== 'section' && t !== 'html' && <Check label="Description above the input" value={field.descriptionAbove} onChange={(v) => onChange({ descriptionAbove: v || undefined })} />}
          <TextIn label="CSS class" value={field.className} onChange={(v) => onChange({ className: v || undefined })} />
        </Section>
      )}

      {takesInput && t !== 'hidden' && (
        <Section title="Validation">
          <TextIn label="Error message" value={field.errorMessage} placeholder="This field is required." onChange={(v) => onChange({ errorMessage: v || undefined })} />
        </Section>
      )}

      {t !== 'hidden' && (
        <Section title="Conditional logic">
          <LogicEditor form={form} field={field} onChange={(logic) => onChange({ logic })} />
        </Section>
      )}
    </div>
  );
}

// Preview --------------------------------------------------------------------------------------------

const PREVIEW_CSS = `
body{margin:0;padding:32px 24px 120px;background:#fff}
.cms-preview{max-width:760px;margin:0 auto}
.c-field{cursor:pointer;position:relative;border-radius:4px;transition:box-shadow .1s}
.c-field *{pointer-events:none}
.c-field:hover{box-shadow:0 0 0 1px rgba(184,115,51,.45),0 0 0 6px rgba(184,115,51,.06)}
.c-field.is-selected{box-shadow:0 0 0 2px #b87333,0 0 0 8px rgba(184,115,51,.08)}
.c-field.drop-before{box-shadow:0 -3px 0 0 #b87333}
.c-field.drop-after{box-shadow:0 3px 0 0 #b87333}
.c-field.drop-left{box-shadow:-3px 0 0 0 #b87333}
.c-field.drop-right{box-shadow:3px 0 0 0 #b87333}
.c-field[hidden]{display:block!important}
.c-field.is-hidden-input{display:block!important;padding:6px 10px;border:1px dashed #cbd5e1;color:#64748b;font:12px system-ui}
.c-field.is-hidden-input::before{content:'Hidden field: ' attr(data-label)}
.c-field[data-logic]::after{content:'Conditional';position:absolute;top:-9px;right:6px;background:#1a1a2e;color:#fff;font:600 10px/1 system-ui;padding:3px 6px;border-radius:3px;letter-spacing:.04em}
.c-form__footer button{pointer-events:none}
.cms-empty{padding:48px;border:2px dashed #e5e1dc;border-radius:8px;text-align:center;color:#94a3b8;font:14px system-ui}
`;

function Preview({
  form,
  selected,
  onSelect,
  onMove,
  onAdd,
  onSave,
}: {
  form: FormDef;
  selected: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, targetId: string, after: boolean) => void;
  onAdd: (type: FieldType, targetId: string | null, after: boolean) => void;
  onSave: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const handlers = useRef({ onSelect, onMove, onAdd, onSave });
  handlers.current = { onSelect, onMove, onAdd, onSave };
  const [ready, setReady] = useState(false);

  const srcDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&family=Work+Sans:wght@300;400;500;600&display=swap">` +
      `<link rel="stylesheet" href="${siteCss}"><style>${PREVIEW_CSS}</style></head><body><div class="cms-preview" id="root"></div></body></html>`,
    [],
  );

  // Event wiring inside the iframe (delegated, installed once per document).
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onLoad = () => {
      const doc = el.contentDocument!;
      const fieldOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.('[data-field]') as HTMLElement | null;
      const idOf = (g: HTMLElement) => g.dataset.field!;
      const clear = () => doc.querySelectorAll('.drop-before,.drop-after,.drop-left,.drop-right').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-left', 'drop-right'));
      const side = (g: HTMLElement, e: DragEvent) => {
        const r = g.getBoundingClientRect();
        const narrow = r.width < doc.getElementById('root')!.getBoundingClientRect().width * 0.9;
        return narrow ? { after: e.clientX > r.left + r.width / 2, cls: e.clientX > r.left + r.width / 2 ? 'drop-right' : 'drop-left' } : { after: e.clientY > r.top + r.height / 2, cls: e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before' };
      };
      doc.addEventListener('click', (e) => {
        e.preventDefault();
        const g = fieldOf(e.target);
        if (g) handlers.current.onSelect(idOf(g));
      });
      doc.addEventListener('submit', (e) => e.preventDefault());
      doc.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault();
          handlers.current.onSave();
        }
      });
      doc.addEventListener('dragstart', (e) => {
        const g = fieldOf(e.target);
        if (g) e.dataTransfer!.setData('text/cms-field', idOf(g));
      });
      doc.addEventListener('dragover', (e) => {
        e.preventDefault();
        clear();
        const g = fieldOf(e.target);
        if (g) g.classList.add(side(g, e).cls);
      });
      doc.addEventListener('dragleave', clear);
      doc.addEventListener('drop', (e) => {
        e.preventDefault();
        clear();
        const g = fieldOf(e.target);
        const type = e.dataTransfer!.getData('text/cms-field-type') as FieldType;
        const moved = e.dataTransfer!.getData('text/cms-field');
        const target = g ? idOf(g) : null;
        const after = g ? side(g, e).after : true;
        if (type) handlers.current.onAdd(type, target, after);
        else if (moved && target && moved !== target) handlers.current.onMove(moved, target, after);
      });
      setReady(true);
    };
    el.addEventListener('load', onLoad);
    return () => el.removeEventListener('load', onLoad);
  }, [srcDoc]);

  useEffect(() => {
    const root = frame.current?.contentDocument?.getElementById('root');
    if (!ready || !root) return;
    if (!form.fields.length) {
      root.innerHTML = '<div class="cms-empty">Drag fields here, or click a field type on the left.</div>';
      return;
    }
    root.innerHTML = renderForm(form, { action: '#', title: true, description: !!form.description });
    for (const g of root.querySelectorAll<HTMLElement>('[data-field]')) {
      const f = form.fields.find((x) => x.id === g.dataset.field);
      g.draggable = true;
      if (f) g.dataset.label = f.label;
      g.classList.toggle('is-selected', g.dataset.field === selected);
    }
  }, [form, selected, ready]);

  return <iframe ref={frame} title="Form preview" srcDoc={srcDoc} className="h-full w-full border-0 bg-white" />;
}

// Builder --------------------------------------------------------------------------------------------

export default function FormBuilder({ formId }: { formId: number }) {
  const db = browserClient();
  const [row, setRow] = useState<Row | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [tab, setTab] = useState<Tab>('build');
  // The notification whose email is open in the email builder.
  const [emailFor, setEmailFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'busy'; text: string } | null>(null);
  const [pages, setPages] = useState<{ id: number; title: string; status: string }[]>([]);
  // Write with Claude: what it opens with, and what the last answer couldn't do.
  const [composing, setComposing] = useState<ComposeAsk[] | null>(null);
  const [composeNotes, setComposeNotes] = useState<string[]>([]);
  const [submissions, setSubmissions] = useState<number | null>(null);
  const [providers, setProviders] = useState<Providers | null>(null);
  // The default template for form notifications (the email builder's Templates), which new ones start from.
  const [starter, setStarter] = useState<{ design: EmailDoc; text: string } | null>(null);
  useEffect(() => {
    defaultTemplate(db, 'form').then(setStarter, () => {});
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await db.from('forms').select('id, title, definition, notifications, is_active').eq('id', formId).single();
      if (error) return setStatus({ kind: 'error', text: error.message });
      const r = data as Row;
      r.definition = { ...r.definition, fields: r.definition.fields ?? [] };
      r.notifications = r.notifications ?? [];
      setRow(r);
      setSaved(JSON.stringify(r));
      const [{ data: p }, { count }] = await Promise.all([
        db.from('entries').select('id, title, status').eq('type', 'page').in('status', ['publish', 'draft']).order('title'),
        db.from('form_submissions').select('id', { count: 'exact', head: true }).eq('form_id', formId),
      ]);
      setPages(p ?? []);
      setSubmissions(count ?? 0);
      const res = await fetch('/api/admin/forms/payments');
      if (res.ok) setProviders(await res.json());
    })();
  }, [formId]);

  const dirty = row != null && JSON.stringify(row) !== saved;
  // The email builder's kit: the form's fields and tags; its preview reads the notification as it is then.
  const latestRow = useRef(row);
  latestRow.current = row;
  const emailKit = useMemo(
    () => (row && emailFor ? formEmailKit(row.id, row.definition, () => latestRow.current!.notifications.find((n) => n.id === emailFor)!) : null),
    [emailFor, row?.id, row?.definition],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!row) return;
    setStatus({ kind: 'busy', text: 'Saving...' });
    const res = await fetch(`/api/admin/forms/${row.id}/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: row.title, definition: row.definition, notifications: row.notifications, is_active: row.is_active }),
    });
    if (!res.ok) return setStatus({ kind: 'error', text: `Not saved: ${await res.text()}` });
    setSaved(JSON.stringify(row));
    setStatus({ kind: 'ok', text: 'Saved' });
    setTimeout(() => setStatus((s) => (s?.kind === 'ok' ? null : s)), 2000);
  }, [row]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  if (!row) return <div className="p-10 text-sm text-admin-muted">{status?.text ?? 'Loading form...'}</div>;

  const form: FormDef = { ...row.definition, id: row.id, title: row.title };
  const setForm = (patch: Partial<FormDef>) => setRow({ ...row, definition: { ...row.definition, ...patch } });
  const setFields = (fields: Field[]) => setForm({ fields });
  const field = form.fields.find((f) => f.id === selected) ?? null;
  const nextN = () => Math.max(form.nextId ?? 1, ...form.fields.map((f) => Number(f.id.slice(1)) + 1 || 1));

  const add = (type: FieldType, targetId: string | null = selected, after = true) => {
    const n = nextN();
    const f = newField(type, n);
    const fields = [...form.fields];
    const at = targetId == null ? fields.length : fields.findIndex((x) => x.id === targetId) + (after ? 1 : 0);
    fields.splice(at < 0 ? fields.length : at, 0, f);
    setForm({ fields, nextId: n + 1 });
    setSelected(f.id);
    setTab('build');
  };
  const move = (id: string, targetId: string, after: boolean) => {
    const fields = form.fields.filter((f) => f.id !== id);
    const moving = form.fields.find((f) => f.id === id)!;
    fields.splice(fields.findIndex((f) => f.id === targetId) + (after ? 1 : 0), 0, moving);
    setFields(fields);
  };
  const updateField = (patch: Partial<Field>) => {
    const old = form.fields.find((f) => f.id === selected);
    let fields = form.fields.map((f) => (f.id === selected ? { ...f, ...patch } : f));
    // A choice whose value changed (renamed, or given a new value): conditions that tested the old
    // value test the new one. Matched by label, else by position; never onto another choice's value.
    if (patch.choices && old?.choices?.length) {
      const next = patch.choices;
      const renames = new Map<string, string>();
      old.choices.forEach((c, i) => {
        const n = next.find((x) => x.label === c.label) ?? (next.length === old.choices!.length ? next[i] : undefined);
        if (n && n.value !== c.value && !old.choices!.some((o) => o.value === n.value)) renames.set(c.value, n.value);
      });
      if (renames.size) {
        fields = fields.map((f) => {
          const l = logicOf(f);
          if (!l || !l.rules.some((r) => r.field === selected && renames.has(String(r.value)))) return f;
          return { ...f, logic: { ...l, rules: l.rules.map((r) => (r.field === selected && renames.has(String(r.value)) ? { ...r, value: renames.get(String(r.value))! } : r)) } };
        });
      }
    }
    setFields(fields);
  };
  const removeField = () => {
    if (!field) return;
    const used = form.fields.filter((f) => logicOf(f)?.rules.some((r) => r.field === field.id));
    if (used.length && !confirm(`${used.map((f) => f.label).join(', ')} ${used.length === 1 ? 'uses' : 'use'} this field in conditional logic. Delete anyway?`)) return;
    const i = form.fields.findIndex((f) => f.id === field.id);
    const fields = form.fields.filter((f) => f.id !== field.id);
    setFields(fields);
    setSelected(fields[Math.min(i, fields.length - 1)]?.id ?? null);
  };
  const duplicateField = () => {
    if (!field) return;
    const n = nextN();
    const copy: Field = { ...JSON.parse(JSON.stringify(field)), id: `f${n}` };
    const fields = [...form.fields];
    fields.splice(fields.findIndex((f) => f.id === field.id) + 1, 0, copy);
    setForm({ fields, nextId: n + 1 });
    setSelected(copy.id);
  };
  const shift = (d: number) => {
    if (!field) return;
    const i = form.fields.findIndex((f) => f.id === field.id);
    const j = i + d;
    if (j < 0 || j >= form.fields.length) return;
    const fields = [...form.fields];
    [fields[i], fields[j]] = [fields[j], fields[i]];
    setFields(fields);
  };

  const confirmation: Confirmation = form.confirmation ?? { type: 'message', message: '' };
  const setConfirmation = (patch: Partial<Confirmation>) => setForm({ confirmation: { ...confirmation, ...patch } });
  const payment = form.payment ?? null;
  const setPayment = (patch: Partial<PaymentSettings>) => setForm({ payment: { ...(payment ?? { provider: 'stripe' }), ...patch } });
  // Providers with keys in the environment; payment options show only when there is one.
  const ready = providers ? (Object.keys(providers) as PaymentProvider[]).filter((p) => providers[p].configured) : [];
  const providerLabel = (p: PaymentProvider) => `${providers?.[p]?.label ?? p}${providers?.[p]?.sandbox ? ' (test mode)' : ''}`;
  // The provider a payment goes through (pickProvider on the server): the form's, else the one set up.
  const takenBy = payment ? (ready.includes(payment.provider) ? payment.provider : ready[0]) : undefined;
  const canPay = ready.length > 0 || !!payment || productsOf(form).length > 0;
  const emailFields = form.fields.filter((f) => f.type === 'email');
  // From the latest row: the email builder reports changes quickly, and several can come in one turn.
  const setNotification = (i: number, patch: Partial<Notification>) => setRow((r) => r && { ...r, notifications: r.notifications.map((n, j) => (j === i ? { ...n, ...patch } : n)) });

  const TABS: [Tab, string][] = [
    ['build', 'Fields'],
    ['settings', 'Settings'],
    ['confirmation', 'Confirmation'],
    ...(canPay ? ([['payment', payment ? 'Payment (on)' : 'Payment']] as [Tab, string][]) : []),
    ['notifications', `Notifications (${row.notifications.length})`],
  ];

  const composed = (c: Composed) => {
    setRow((r) => r && { ...r, definition: { ...r.definition, ...c.definition }, notifications: c.notifications ?? r.notifications });
    if (c.page) setPages((p) => [...p, { ...c.page!, status: 'draft' }]);
    setComposeNotes(c.notes);
    setTab(c.definition.fields ? 'build' : c.definition.confirmation ? 'confirmation' : 'notifications');
    if (c.definition.fields) setSelected(null);
    setComposing(null);
  };
  const confirmPage = confirmation.type === 'page' ? pages.find((p) => p.id === confirmation.pageId) : undefined;

  const emailIndex = emailFor ? row.notifications.findIndex((n) => n.id === emailFor) : -1;
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {composing && <ComposeForm form={form} notifications={row.notifications} ask={composing} canPage={!!typeDef('page')} onDone={composed} onClose={() => setComposing(null)} />}
      {emailIndex >= 0 && (
        <EmailBuilder
          title={`${row.notifications[emailIndex].name || 'Notification'}: email`}
          kit={emailKit!}
          design={row.notifications[emailIndex].design ?? defaultEmail()}
          text={row.notifications[emailIndex].text}
          note="Changes are saved with the form."
          onChange={(patch) => setNotification(emailIndex, patch)}
          onClose={() => setEmailFor(null)}
        />
      )}
      <div className="flex items-center gap-4 border-b border-admin-ink/10 bg-white px-4 py-2">
        <a href="/admin/forms/" className="text-sm text-admin-muted hover:text-admin-accent">
          Forms
        </a>
        <span className="text-[#cbd5e1]">/</span>
        <input className="min-w-0 flex-1 rounded border border-transparent px-2 py-1 text-lg hover:border-admin-ink/10 focus:border-admin-accent focus:outline-none" value={row.title} onChange={(e) => setRow({ ...row, title: e.target.value })} />
        <nav className="flex gap-1 text-sm">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`rounded px-3 py-1.5 ${tab === k ? 'bg-admin-ink text-white' : 'text-admin-muted hover:bg-admin-soft'}`}>
              {l}
            </button>
          ))}
        </nav>
        <button type="button" className={btn} onClick={() => setComposing(form.fields.length ? ['fields'] : ['fields', 'confirmation', 'notifications'])}>
          Write with Claude
        </button>
        <a href={`/admin/submissions/?form=${row.id}`} className="text-sm text-admin-muted hover:text-admin-accent">
          Submissions{submissions != null ? ` (${submissions})` : ''}
        </a>
        <label className="flex items-center gap-1.5 text-sm text-admin-muted">
          <input type="checkbox" checked={row.is_active} onChange={(e) => setRow({ ...row, is_active: e.target.checked })} />
          Active
        </label>
        <span className={`w-28 text-right text-xs ${status?.kind === 'error' ? 'text-[#b91c1c]' : 'text-admin-muted'}`}>{status?.text ?? (dirty ? 'Unsaved changes' : '')}</span>
        <button type="button" onClick={save} disabled={!dirty || status?.kind === 'busy'} className="rounded bg-admin-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-admin-accent-dark disabled:opacity-40">
          Save
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {tab === 'build' && (
          <aside className="w-56 shrink-0 overflow-y-auto border-r border-admin-ink/10 bg-admin-bg p-3">
            {(['Standard', 'Advanced', ...(canPay ? (['Pricing'] as const) : []), 'Layout'] as const).map((group) => (
              <div key={group} className="mb-4">
                <div className="mb-2 text-[11px] font-semibold tracking-wider text-admin-muted uppercase">{group}</div>
                <div className="grid grid-cols-1 gap-1">
                  {FIELD_TYPES.filter((ft) => ft.group === group).map((ft) => (
                    <button
                      key={ft.type}
                      type="button"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/cms-field-type', ft.type)}
                      onClick={() => add(ft.type)}
                      className="cursor-grab rounded border border-admin-ink/10 bg-white px-2.5 py-1.5 text-left text-sm hover:border-admin-accent active:cursor-grabbing"
                    >
                      {ft.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[11px] leading-relaxed text-[#94a3b8]">Click to add below the selected field, or drag into the form. Drag fields in the form to reorder them.</p>
          </aside>
        )}

        <main className="min-w-0 flex-1 bg-admin-soft p-4">
          <div className="h-full overflow-hidden rounded bg-white shadow-[0_0_0_1px_rgba(26,26,46,0.08)]">
            <Preview
              form={form}
              selected={tab === 'build' ? selected : null}
              onSelect={(id) => {
                setSelected(id);
                setTab('build');
              }}
              onMove={move}
              onAdd={add}
              onSave={save}
            />
          </div>
        </main>

        <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-admin-ink/10 bg-white p-4">
          {composeNotes.length > 0 && (
            <div className="mb-3 rounded bg-admin-soft p-2 text-xs text-admin-ink" role="status">
              {composeNotes.map((n) => (
                <p key={n}>{n}</p>
              ))}
              <button type="button" className="mt-1 underline" onClick={() => setComposeNotes([])}>
                Dismiss
              </button>
            </div>
          )}
          {tab === 'build' &&
            (field ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-admin-muted uppercase">{FIELD_TYPES.find((ft) => ft.type === field.type)?.label ?? field.type}</span>
                  <span className="text-[11px] text-[#94a3b8]">{field.id}</span>
                </div>
                <div className="mb-4 flex flex-wrap gap-1">
                  <button type="button" className={btn} onClick={() => shift(-1)} disabled={form.fields[0]?.id === field.id}>
                    Move up
                  </button>
                  <button type="button" className={btn} onClick={() => shift(1)} disabled={form.fields[form.fields.length - 1]?.id === field.id}>
                    Move down
                  </button>
                  <button type="button" className={btn} onClick={duplicateField}>
                    Duplicate
                  </button>
                  <button type="button" className={`${btn} text-[#b91c1c]`} onClick={removeField}>
                    Delete
                  </button>
                </div>
                <FieldSettings key={field.id} form={form} field={field} onChange={updateField} />
              </>
            ) : (
              <p className="text-sm text-admin-muted">Select a field in the form to edit it, or add one from the left.</p>
            ))}

          {tab === 'settings' && (
            <>
              <Area label="Description (shown under the title where the form is placed)" value={form.description} rows={3} onChange={(v) => setForm({ description: v || undefined })} />
              <TextIn label="Submit button text" value={form.submitLabel} placeholder="Submit" onChange={(v) => setForm({ submitLabel: v || undefined })} />
              <Pick label="Labels" value={form.labelPlacement ?? 'top'} options={[['top', 'Above inputs'], ['left', 'Left of inputs (wide screens)']]} onChange={(v) => setForm({ labelPlacement: v === 'top' ? undefined : v })} />
              <Check label="Spam protection (hidden honeypot field)" value={form.honeypot} onChange={(v) => setForm({ honeypot: v || undefined })} />
              <TextIn label="CSS class" value={form.className} onChange={(v) => setForm({ className: v || undefined })} />
              <p className="mt-4 text-xs text-[#94a3b8]">Add the form to a page with the Form block (Sections category) in the page editor.</p>
            </>
          )}

          {tab === 'confirmation' && (
            <>
              <button type="button" className={`${btn} mb-3`} onClick={() => setComposing(['confirmation'])}>
                Write with Claude
              </button>
              <Pick label="After someone submits" value={confirmation.type} options={[['message', 'Show a message'], ['page', 'Go to a page'], ['redirect', 'Go to a web address']]} onChange={(v) => setConfirmation({ type: v })} />
              {confirmation.type === 'message' && (
                <>
                  <MergeTags tags={mergeTagOptions(form)} onInsert={(tag) => setConfirmation({ message: `${confirmation.message ?? ''}${tag}` })} />
                  <Area label="Message" value={confirmation.message} rows={8} onChange={(v) => setConfirmation({ message: v })} hint="Paragraphs are added automatically. HTML is allowed." />
                </>
              )}
              {confirmation.type === 'page' && (
                <Labelled label="Page">
                  <select className={input} value={String(confirmation.pageId ?? '')} onChange={(e) => setConfirmation({ pageId: Number(e.target.value) || undefined })}>
                    <option value="">Choose a page</option>
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                        {p.status === 'draft' ? ' (draft)' : ''}
                      </option>
                    ))}
                  </select>
                </Labelled>
              )}
              {confirmPage && (
                <p className="mb-3 text-xs text-admin-muted">
                  {confirmPage.status === 'draft' ? 'This page is a draft: until it is published, people see the message below instead. ' : ''}
                  <a className="underline hover:text-admin-accent" href={`/admin/edit/${confirmPage.id}/`} target="_blank" rel="noopener">
                    Edit the page
                  </a>
                </p>
              )}
              {confirmation.type === 'page' && confirmPage?.status === 'draft' && <Area label="Message (until the page is published)" value={confirmation.message} rows={4} onChange={(v) => setConfirmation({ message: v })} />}
              {confirmation.type === 'redirect' && <TextIn label="Web address" value={confirmation.url} placeholder="https://" onChange={(v) => setConfirmation({ url: v })} />}
            </>
          )}

          {tab === 'payment' && (
            <>
              <Check
                label="Take payment"
                value={!!payment}
                onChange={(on) => setForm({ payment: on ? { ...(payment ?? {}), provider: payment?.provider ?? ready[0] ?? 'stripe' } : null })}
              />
              {payment && ready.length > 1 && (
                <Labelled label="Take payment with">
                  <select className={input} value={takenBy} onChange={(e) => setPayment({ provider: e.target.value as PaymentProvider })}>
                    {ready.map((p) => (
                      <option key={p} value={p}>
                        {providerLabel(p)}
                      </option>
                    ))}
                  </select>
                </Labelled>
              )}
              {payment && ready.length === 1 && <p className="mb-3 text-xs text-admin-muted">Payments go through {providerLabel(ready[0])}.</p>}
              {payment && providers && !ready.length && (
                <p className="mb-3 rounded bg-[#fef3f2] p-2 text-xs text-[#b42318]">
                  No payment provider is set up: Stripe needs {providers.stripe.missing.join(' and ')}, Square needs {providers.square.missing.join(' and ')} in the site's environment. Until then the form refuses submissions that have something to pay.
                </p>
              )}
              {payment && (
                <>
                  <Pick label="Currency" value={payment.currency ?? 'USD'} options={CURRENCIES.map(([code, name]) => [code, `${code}: ${name}`] as [string, string])} onChange={(v) => setPayment({ currency: v === 'USD' ? undefined : v })} />
                  <MergeTags tags={mergeTagOptions(form)} onInsert={(tag) => setPayment({ description: `${payment.description ?? ''}${tag}` })} />
                  <TextIn label="Description of the payment" value={payment.description} placeholder={form.title} hint="Shown at checkout and on the receipt." onChange={(v) => setPayment({ description: v || undefined })} />
                  <Labelled label="Receipt email" hint="Filled in at checkout; the payment provider sends its receipt there.">
                    <select className={input} value={payment.emailField ?? ''} onChange={(e) => setPayment({ emailField: e.target.value || undefined })}>
                      <option value="">{emailFields.length ? `The first email field (${emailFields[0].label})` : 'None (the form has no email field)'}</option>
                      {emailFields.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </Labelled>
                  {!productsOf(form).length && <p className="mb-3 rounded bg-admin-soft p-2 text-xs text-admin-muted">Add Product fields (Fields, Pricing) for what the form charges; their total is the payment.</p>}
                  <div className="space-y-2 text-xs leading-relaxed text-admin-muted">
                    <p>Visitors pay on {(takenBy && providers?.[takenBy]?.label) ?? 'the provider'}'s checkout page after they submit, then come back to the confirmation. A submission with nothing to pay is sent right away.</p>
                    <p>Notifications are sent once the payment is complete. Submissions list unpaid checkouts as Unpaid.</p>
                    <p>
                      Webhook address (for visitors who pay and don't come back): <code>{location.origin}/api/payments/{takenBy ?? payment.provider}</code>
                    </p>
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'notifications' && (
            <>
              <p className="mb-3 text-xs text-admin-muted">{payment ? 'Emails sent when the form is submitted and paid for.' : 'Emails sent when the form is submitted.'}</p>
              <button type="button" className={`${btn} mb-3`} onClick={() => setComposing(['notifications'])}>
                Write with Claude
              </button>
              {row.notifications.map((n, i) => (
                <details key={n.id} open={row.notifications.length === 1} className="mb-3 rounded border border-admin-ink/10 p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {n.name || 'Notification'}
                    {n.active === false && <span className="ml-2 text-xs font-normal text-[#94a3b8]">(off)</span>}
                  </summary>
                  <div className="mt-3">
                    <TextIn label="Name" value={n.name} onChange={(v) => setNotification(i, { name: v })} />
                    <Check label="Send this email" value={n.active !== false} onChange={(v) => setNotification(i, { active: v ? undefined : false })} />
                    <TextIn label="Send to" value={n.to} hint="Addresses separated by commas. {admin_email} is the site's admin address; a field tag like {Email:f3} sends to what the visitor entered." onChange={(v) => setNotification(i, { to: v })} />
                    <TextIn label="Reply-to" value={n.replyTo} placeholder="The visitor's email, if the form has one" onChange={(v) => setNotification(i, { replyTo: v || undefined })} />
                    <TextIn label="From name" value={n.fromName} placeholder={site.organization} onChange={(v) => setNotification(i, { fromName: v || undefined })} />
                    <MergeTags tags={mergeTagOptions(form)} onInsert={(tag) => setNotification(i, { subject: `${n.subject ?? ''}${tag}` })} />
                    <TextIn label="Subject" value={n.subject} onChange={(v) => setNotification(i, { subject: v })} />
                    <div className="mb-3">
                      <span className={labelCls}>Email</span>
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="button" className={btn} onClick={() => { if (!n.design) setNotification(i, { design: emailFromMessage(n.message) }); setEmailFor(n.id); }}>
                          Edit email
                        </button>
                        <span className="text-xs text-admin-muted">
                          {n.design ? `Built in the email builder${n.text ? ', with its own plain text' : ''}.` : 'Uses its message from before the email builder; Edit email opens it there.'}
                        </span>
                      </div>
                    </div>
                    <button type="button" className={`${btn} text-[#b91c1c]`} onClick={() => setRow({ ...row, notifications: row.notifications.filter((_, j) => j !== i) })}>
                      Delete notification
                    </button>
                  </div>
                </details>
              ))}
              <button type="button" className={btn} onClick={() => setRow({ ...row, notifications: [...row.notifications, { ...defaultNotification(), ...(starter ? { design: starter.design, ...(starter.text ? { text: starter.text } : {}) } : {}) }] })}>
                Add notification
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
