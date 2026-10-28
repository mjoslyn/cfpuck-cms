// Compose for forms (the form builder's Compose, POST /api/admin/forms/compose):
// from what the editor says the form is for, Claude writes its fields, its confirmation (a message, or a
// thank-you page made in the house style) and its notification emails. This file holds the answer's
// shape and turns an answer into the form's settings; nothing is saved until the editor saves the form
// (a confirmation page is made as a draft).
import { inline } from '../compose/build';
import type { PagePlan } from '../compose/spec';
import type { EmailDoc, EmailItem, EmailRoot } from './email';
import { newField } from './defaults';
import { INPUT_TYPES, NAME_PARTS } from './logic';
import type { Field, FieldType, FormDef, Logic, Notification, Operator, Width } from './types';

export type ComposePart = 'fields' | 'confirmation' | 'page' | 'notifications';

/** The field types Claude writes (products and their prices stay the editor's). */
const TYPES: FieldType[] = ['text', 'textarea', 'email', 'phone', 'number', 'url', 'select', 'radio', 'checkbox', 'name', 'date', 'consent', 'section', 'html', 'hidden'];
const WIDTHS: Width[] = ['full', 'three-quarters', 'two-thirds', 'half', 'third', 'quarter'];
const OPS: Operator[] = ['is', 'isnot', 'contains', 'starts_with', 'ends_with', '>', '<'];
const BUILT_IN = ['all_fields', 'form_title', 'date', 'admin_email'];
const PAYMENT_TAGS = ['payment_total', 'payment_id', 'payment_summary'];

const str = (description: string) => ({ type: 'string', description });

const FIELD_SCHEMA = {
  type: 'object',
  required: ['key', 'type', 'label', 'required', 'width'],
  properties: {
    key: str('The field\'s id: an existing field\'s id (f3) to keep that field and its answers, else a short new name in lowercase letters and underscores (email, guests).'),
    type: { type: 'string', enum: TYPES, description: 'text: one line. textarea: several lines. select: a dropdown. radio: pick one. checkbox: pick any. name: first and last name. consent: one checkbox to agree. section: a heading between groups of fields. html: a note shown in the form. hidden: a value the visitor doesn\'t see.' },
    label: str('The label (for section, the heading; for html and hidden, a name for the editor).'),
    required: { type: 'boolean' },
    width: { type: 'string', enum: WIDTHS, description: 'Its share of the row: full, or half, third... to put short fields side by side (first name and email, for instance).' },
    description: str('A short help text under the field, or "".'),
    placeholder: str('Example text in the empty field, or "".'),
    choices: { type: 'array', items: { type: 'string' }, description: 'select, radio and checkbox: the choices, in order. Otherwise [].' },
    consent_text: str('consent: the checkbox\'s text.'),
    text: str('html: the note, as simple Markdown (paragraphs, **bold**, [links](url)).'),
    min: { type: 'number', description: 'number: the smallest value allowed.' },
    max: { type: 'number', description: 'number: the largest value allowed.' },
    show_if: {
      type: 'object',
      description: 'Show the field only when the visitor\'s other answers match (leave rules empty to always show it).',
      required: ['match', 'rules'],
      properties: {
        match: { type: 'string', enum: ['all', 'any'] },
        rules: {
          type: 'array',
          items: { type: 'object', required: ['field', 'op', 'value'], properties: { field: str('The key of an earlier field.'), op: { type: 'string', enum: OPS }, value: str('A choice exactly as written, or a value.') } },
        },
      },
    },
  },
};

const EMAIL_SCHEMA = {
  type: 'object',
  required: ['name', 'to', 'subject', 'heading', 'body', 'answers'],
  properties: {
    name: str('What the email is, for the editor (Notice to staff, Receipt to the visitor).'),
    to: { type: 'string', enum: ['site', 'visitor'], description: 'site: the people who run the site. visitor: the person who filled in the form (the form needs an email field).' },
    subject: str('The subject line; tags allowed.'),
    preheader: str('A short line shown after the subject in inbox lists, or "".'),
    heading: str('The heading at the top of the email; tags allowed.'),
    body: str('The message under the heading, as simple Markdown (paragraphs, **bold**, [links](url), "- " lists); tags allowed.'),
    answers: { type: 'boolean', description: 'Whether to list every answer under the message (a table of labels and answers).' },
    button_label: str('A button at the end, or "".'),
    button_url: str('Where the button goes: a full web address, a site path like /events/, or mailto:. "" for none.'),
  },
};

const PAGE_SCHEMA = {
  type: 'object',
  required: ['title', 'sections'],
  description: 'A thank-you page the visitor goes to after submitting. It can\'t show their answers.',
  properties: {
    title: str('The page\'s title (Thank you, You\'re registered).'),
    sections: {
      type: 'array',
      description: 'The page from top to bottom: one to three sections.',
      items: {
        type: 'object',
        required: ['kind', 'heading', 'body'],
        properties: {
          kind: { type: 'string', enum: ['text', 'cta', 'faq'], description: 'text: heading and body. cta: a short call to action with buttons. faq: questions and answers (what happens next).' },
          heading: str('The section\'s heading.'),
          body: str('Simple Markdown: paragraphs, **bold**, [links](url), "- " lists.'),
          buttons: { type: 'array', items: { type: 'object', required: ['label', 'url'], properties: { label: str('Button text'), url: str('A site path like / or /events/, a full web address, or mailto:') } } },
          items: { type: 'array', items: { type: 'object', required: ['question', 'answer'], properties: { question: str('Question'), answer: str('Answer (simple Markdown)') } } },
        },
      },
    },
  },
};

/** The answer's JSON schema, for the parts asked for. */
export function composeSchema(parts: ComposePart[]): Record<string, any> {
  const properties: Record<string, unknown> = {};
  if (parts.includes('fields')) {
    properties.description = str('A sentence shown under the form\'s title, or "".');
    properties.submit_label = str('The submit button\'s text (Send, Register, Request a quote).');
    properties.fields = { type: 'array', description: 'Every field of the form, in order.', items: FIELD_SCHEMA };
  }
  if (parts.includes('confirmation')) properties.confirmation = str('The message shown in place of the form once it is sent, as simple Markdown; tags allowed.');
  if (parts.includes('page')) properties.page = PAGE_SCHEMA;
  if (parts.includes('notifications')) properties.notifications = { type: 'array', description: 'The emails sent when the form is submitted: usually one to the site, and one to the visitor when it helps them (a receipt, what happens next).', items: EMAIL_SCHEMA };
  return { type: 'object', required: Object.keys(properties), properties };
}

export interface ComposedField {
  key: string;
  type: string;
  label: string;
  required?: boolean;
  width?: string;
  description?: string;
  placeholder?: string;
  choices?: string[];
  consent_text?: string;
  text?: string;
  min?: number;
  max?: number;
  show_if?: { match?: string; rules?: { field: string; op: string; value: string }[] } | null;
}
export interface ComposedEmail {
  name: string;
  to: string;
  subject: string;
  preheader?: string;
  heading: string;
  body: string;
  answers?: boolean;
  button_label?: string;
  button_url?: string;
}
export interface ComposedForm {
  description?: string;
  submit_label?: string;
  fields?: ComposedField[];
  confirmation?: string;
  page?: { title: string; sections: { kind: string; heading?: string; body?: string; buttons?: { label: string; url: string }[]; items?: { question: string; answer: string }[] }[] };
  notifications?: ComposedEmail[];
}

/** The form as Claude is shown it: its fields (with their ids), confirmation and emails. */
export function formOutline(form: FormDef, notifications: Notification[]): string {
  const lines = [`Title: ${form.title}`];
  if (form.description) lines.push(`Description: ${form.description}`);
  if (form.fields.length) {
    lines.push('Fields now:');
    for (const f of form.fields) {
      const choices = f.choices?.length ? ` (choices: ${f.choices.map((c) => c.label).join(', ')})` : '';
      const fixed = f.type === 'product' ? ' [a product the form charges for: kept as it is, mention it if useful]' : '';
      lines.push(`- ${f.id}: ${f.type} "${f.label}"${f.required ? ', required' : ''}${choices}${fixed}`);
    }
  } else lines.push('The form has no fields yet.');
  if (form.payment) lines.push('The form takes payment for its products.');
  const c = form.confirmation;
  if (c?.type === 'message' && c.message) lines.push(`Confirmation message now: ${c.message.replace(/\s+/g, ' ').slice(0, 600)}`);
  for (const n of notifications) lines.push(`Email now: "${n.name}" to ${n.to}, subject "${n.subject}"`);
  return lines.join('\n');
}

/** What Claude is asked to do (system text), for the parts asked for. */
export function composeTask(parts: ComposePart[], form: FormDef): string {
  const asks = [
    parts.includes('fields') && 'its fields (ask only what the site needs to act on it, in the order a person would answer; group long forms with section headings)',
    parts.includes('confirmation') && 'the message shown once it is sent (thank them, say what happens next and when if the brief says)',
    parts.includes('page') && 'a short thank-you page the visitor goes to once it is sent (it can\'t show their answers)',
    parts.includes('notifications') && 'the emails it sends',
  ].filter(Boolean);
  const payment = form.payment ? `, ${PAYMENT_TAGS.map((t) => `{${t}}`).join(', ')}` : '';
  return (
    `You write a web form "${form.title}" for the site: ${asks.join('; ')}. ` +
    `In the confirmation message and the emails, tags put in what the visitor entered: {key} for a field's answer (by the key you gave it, or an existing field's id), {key.first} and {key.last} for parts of a name field; also {form_title}, {date}, {all_fields} (every answer)${payment}. ` +
    'Write plainly and warmly, short sentences, no exclamation marks in headings.'
  );
}

const clean = (s: unknown, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const tagLabel = (s: string) => s.replace(/[{}:]/g, '').trim() || 'Field';

/** Simple Markdown (paragraphs, "- " lists, **bold**, *italic*, [links](url)) as HTML. */
export function markdownHtml(md: string): string {
  return (md ?? '')
    .trim()
    .split(/\n\s*\n/)
    .filter((b) => b.trim())
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.every((l) => /^[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    })
    .join('');
}

/** A link a button may take: a web, mail or phone address, or a path on the site. */
const safeUrl = (u: unknown) => {
  const s = String(u ?? '').trim();
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/))/i.test(s) ? s : '';
};

const newId = (type: string) => `${type}-${Math.random().toString(36).slice(2, 10)}`;

export interface Applied {
  /** The form's settings to merge into its definition. */
  definition: Partial<FormDef>;
  notifications?: Notification[];
  /** The thank-you page's plan, for buildPage. */
  page?: PagePlan;
  /** What couldn't be done as asked, to tell the editor. */
  notes: string[];
}

/**
 * Claude's answer as the form's settings. Fields keep the id (and the settings Claude doesn't write) of
 * an existing field whose id they name, so its answers stay with it; new fields take the next ids.
 * Product fields stay as they are. Emails keep the address, reply-to and sender of the existing email to
 * the same people, and the look (colors, width) of its design or else `look`.
 */
export function applyComposed(form: FormDef, notifications: Notification[], answer: ComposedForm, look: EmailRoot = {}): Applied {
  const notes: string[] = [];
  const definition: Partial<FormDef> = {};
  let fields = form.fields;
  // Keys Claude used, as the fields they name.
  const byKey = new Map<string, Field>(form.fields.map((f) => [f.id, f]));
  if (answer.fields) {
    let next = Math.max(form.nextId ?? 1, ...form.fields.map((f) => Number(f.id.slice(1)) + 1 || 1));
    const keyMap = new Map<string, Field>();
    const out: Field[] = [];
    for (const c of answer.fields) {
      const type = (TYPES.includes(c.type as FieldType) ? c.type : 'text') as FieldType;
      const key = String(c.key ?? '').trim();
      if (keyMap.has(key)) continue;
      const had = form.fields.find((f) => f.id === key);
      if (had?.type === 'product') {
        keyMap.set(key, had);
        out.push(had);
        continue;
      }
      const base = had && had.type === type ? had : { ...newField(type, 0), id: had ? had.id : `f${next++}` };
      const f: Field = { ...base, type, label: clean(c.label, 200) || base.label, required: c.required ? true : undefined };
      const set = <K extends keyof Field>(k: K, v: Field[K] | undefined) => {
        if (v === undefined || v === '') delete f[k];
        else f[k] = v;
      };
      set('width', WIDTHS.includes(c.width as Width) && c.width !== 'full' ? (c.width as Width) : undefined);
      set('description', clean(c.description, 500) || undefined);
      set('placeholder', clean(c.placeholder, 200) || undefined);
      if (['select', 'radio', 'checkbox'].includes(type)) {
        const labels = [...new Set((c.choices ?? []).map((x) => clean(x, 200)).filter(Boolean))];
        if (labels.length) f.choices = labels.map((label) => ({ ...base.choices?.find((x) => x.label === label), label, value: base.choiceValues ? (base.choices?.find((x) => x.label === label)?.value ?? label) : label }));
      } else delete f.choices;
      if (type === 'consent') set('consentText', clean(c.consent_text, 500) || f.consentText);
      if (type === 'html') set('html', markdownHtml(String(c.text ?? '')) || f.html);
      if (type === 'number') {
        set('min', typeof c.min === 'number' ? c.min : undefined);
        set('max', typeof c.max === 'number' ? c.max : undefined);
      }
      if (type !== 'section' && type !== 'html') delete f.logic;
      keyMap.set(key, f);
      out.push(f);
    }
    // Conditions, now that every key has its field: rules on earlier fields only.
    for (const c of answer.fields) {
      const f = keyMap.get(String(c.key ?? '').trim());
      const rules = (c.show_if?.rules ?? [])
        .map((r) => ({ field: keyMap.get(String(r.field))?.id ?? '', op: (OPS.includes(r.op as Operator) ? r.op : 'is') as Operator, value: clean(r.value, 200) }))
        .filter((r) => r.field && out.findIndex((x) => x.id === r.field) < out.findIndex((x) => x === f));
      if (f && f.type !== 'product' && rules.length) f.logic = { action: 'show', match: c.show_if?.match === 'any' ? 'any' : 'all', rules } satisfies Logic;
    }
    // Products Claude left out stay: what the form charges is the editor's.
    for (const p of form.fields) if (p.type === 'product' && !out.includes(p)) out.push(p);
    fields = out;
    definition.fields = out;
    definition.nextId = next;
    definition.description = clean(answer.description, 500) || undefined;
    if (clean(answer.submit_label)) definition.submitLabel = clean(answer.submit_label, 60);
    // Tags name the form's fields as they are now: by Claude's keys and by id.
    byKey.clear();
    for (const [k, f] of keyMap) byKey.set(k, f);
    for (const f of out) byKey.set(f.id, f);
  }

  // Claude's tags as the form's: {key} -> {Label:f3}; unknown ones are dropped, with a paragraph or list
  // item left empty.
  const allowed = new Set([...BUILT_IN, ...(form.payment ? PAYMENT_TAGS : [])]);
  const tags = (text: string) =>
    retag(text).replace(/<(p|li)>\s*<\/\1>/g, '').replace(/<ul><\/ul>/g, '');
  const retag = (text: string) =>
    text.replace(/\{([\w-]+)(?:\.(\w+))?\}/g, (tag, key: string, part?: string) => {
      if (!part && allowed.has(key)) return tag;
      const f = byKey.get(key);
      if (!f || !INPUT_TYPES.includes(f.type)) return '';
      const p = part && f.type === 'name' && NAME_PARTS.includes(part as any) ? `.${part}` : '';
      return `{${tagLabel(f.label)}:${f.id}${p}}`;
    });

  if (answer.confirmation !== undefined) definition.confirmation = { type: 'message', message: tags(markdownHtml(answer.confirmation)) };

  if (answer.page) {
    const sections = (answer.page.sections ?? []).slice(0, 4).map((s, i) => ({
      kind: (['text', 'cta', 'faq'].includes(s.kind) ? s.kind : 'text') as 'text' | 'cta' | 'faq',
      background: (i % 2 ? 'tint' : 'plain') as 'plain' | 'tint',
      heading: clean(s.heading, 200),
      body: String(s.body ?? '').replace(/\{[^{}]*\}/g, '').slice(0, 4000),
      buttons: (s.buttons ?? []).map((b) => ({ label: clean(b.label, 60), url: safeUrl(b.url) })).filter((b) => b.label && b.url).slice(0, 2),
      items: (s.items ?? []).map((it) => ({ question: clean(it.question, 300), answer: String(it.answer ?? '').slice(0, 2000) })).filter((it) => it.question),
    }));
    const title = clean(answer.page.title, 200) || 'Thank you';
    // The message stays, shown while the page is a draft.
    definition.confirmation = { type: 'page', message: definition.confirmation?.message ?? form.confirmation?.message };
    return { definition, ...emails(), page: { title, slug: '', excerpt: '', sections }, notes };
  }
  return { definition, ...emails(), notes };

  function emails(): { notifications?: Notification[] } {
    if (!answer.notifications) return {};
    const email = fields.find((f) => f.type === 'email');
    const toVisitor = (n: Notification) => /\{[^{}]*:f\d+\}/.test(n.to);
    const unused = [...notifications];
    const out: Notification[] = [];
    for (const e of answer.notifications.slice(0, 4)) {
      const visitor = e.to === 'visitor';
      if (visitor && !email) {
        notes.push(`“${clean(e.name, 80)}” wasn’t added: an email to the visitor needs an Email field.`);
        continue;
      }
      const at = unused.findIndex((n) => toVisitor(n) === visitor);
      const had = at >= 0 ? unused.splice(at, 1)[0] : undefined;
      const content: EmailItem[] = [{ type: 'Heading', props: { id: newId('Heading'), text: tags(clean(e.heading, 200)), level: 2 } }];
      const body = tags(markdownHtml(String(e.body ?? '').slice(0, 4000)));
      if (body) content.push({ type: 'Text', props: { id: newId('Text'), html: body } });
      if (e.answers) content.push({ type: 'FormField', props: { id: newId('FormField'), field: 'all', showLabel: true } });
      const url = safeUrl(e.button_url);
      if (clean(e.button_label) && url) content.push({ type: 'Button', props: { id: newId('Button'), label: clean(e.button_label, 60), url } });
      const preheader = tags(clean(e.preheader, 150));
      const design: EmailDoc = { root: { props: { ...(had?.design?.root?.props ?? look), ...(preheader ? { preheader } : { preheader: undefined }) } }, content };
      out.push({
        id: had?.id ?? Math.random().toString(36).slice(2, 12),
        name: clean(e.name, 80) || (visitor ? 'Email to the visitor' : 'Notification'),
        ...(had?.active === false ? { active: false } : {}),
        to: had?.to ?? (visitor ? `{${tagLabel(email!.label)}:${email!.id}}` : '{admin_email}'),
        subject: tags(clean(e.subject, 200)) || '{form_title}',
        message: '',
        design,
        ...(had?.replyTo ? { replyTo: had.replyTo } : visitor ? { replyTo: '{admin_email}' } : {}),
        ...(had?.fromName ? { fromName: had.fromName } : {}),
      });
    }
    return { notifications: out };
  }
}
