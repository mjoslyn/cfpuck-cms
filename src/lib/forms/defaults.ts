// New forms and fields as the builder creates them (./types.ts).
import { defaultEmail } from './email';
import type { Field, FieldType, FormDef, Notification } from './types';

export function newForm(id: number, title: string): FormDef {
  return {
    id,
    title,
    fields: [],
    submitLabel: 'Submit',
    honeypot: true,
    nextId: 1,
    confirmation: { type: 'message', message: 'Thanks for contacting us! We will get in touch with you shortly.' },
  };
}

export const defaultNotification = (): Notification => ({
  id: Math.random().toString(36).slice(2, 12),
  name: 'Notification',
  to: '{admin_email}',
  subject: 'New submission from {form_title}',
  message: '{all_fields}',
  design: defaultEmail(),
});

export const FIELD_TYPES: { type: FieldType; label: string; group: 'Standard' | 'Advanced' | 'Pricing' | 'Layout' }[] = [
  { type: 'text', label: 'Single line text', group: 'Standard' },
  { type: 'textarea', label: 'Paragraph text', group: 'Standard' },
  { type: 'select', label: 'Dropdown', group: 'Standard' },
  { type: 'radio', label: 'Multiple choice', group: 'Standard' },
  { type: 'checkbox', label: 'Checkboxes', group: 'Standard' },
  { type: 'number', label: 'Number', group: 'Standard' },
  { type: 'hidden', label: 'Hidden', group: 'Standard' },
  { type: 'name', label: 'Name', group: 'Advanced' },
  { type: 'email', label: 'Email', group: 'Advanced' },
  { type: 'phone', label: 'Phone', group: 'Advanced' },
  { type: 'url', label: 'Website', group: 'Advanced' },
  { type: 'date', label: 'Date', group: 'Advanced' },
  { type: 'consent', label: 'Consent', group: 'Advanced' },
  { type: 'product', label: 'Product', group: 'Pricing' },
  { type: 'section', label: 'Section heading', group: 'Layout' },
  { type: 'html', label: 'HTML content', group: 'Layout' },
];

const CHOICES = ['First choice', 'Second choice', 'Third choice'].map((label) => ({ label, value: label }));

export function newField(type: FieldType, n: number): Field {
  const label = FIELD_TYPES.find((t) => t.type === type)?.label ?? 'Field';
  const base: Field = { id: `f${n}`, type, label };
  switch (type) {
    case 'select':
    case 'radio':
    case 'checkbox':
      return { ...base, choices: CHOICES.map((c) => ({ ...c })) };
    case 'phone':
      return { ...base, phoneFormat: 'us' };
    case 'consent':
      return { ...base, label: 'Consent', consentText: 'I agree to the privacy policy.' };
    case 'html':
      return { ...base, label: 'HTML content', html: '<p>Some text for visitors.</p>' };
    case 'product':
      return { ...base, priceMode: 'fixed', price: 10, required: true };
    default:
      return base;
  }
}
