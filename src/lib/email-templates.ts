// Saved email templates (table email_templates): designs, with their own plain text, that the email
// builder offers to start an email from (src/forms/EmailTemplates.tsx). Each belongs to the builder kit
// that made it, since its blocks are that kit's: mailing (campaigns and digests), form (form
// notifications) or ticket (ticket emails). A template can be the default for one kind of email: new
// campaigns, digests and form notifications start from it, and a ticket email nobody has changed (the
// event's own, else the site's) is sent from it. Safe in the browser.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailDoc } from './forms/email';

export type TemplateKit = 'mailing' | 'form' | 'ticket';

/** A saved template. */
export interface EmailTemplate {
  id: number;
  kit: TemplateKit;
  name: string;
  design: EmailDoc;
  text: string;
  default_for: string | null;
  updated_at?: string;
}

/** What a kit's templates can be the default for: [key, label]. */
export const TEMPLATE_DEFAULTS: Record<TemplateKit, [string, string][]> = {
  mailing: [
    ['campaign', 'New campaigns'],
    ['digest', 'New weekly digests'],
  ],
  form: [['form', 'New form notifications']],
  ticket: [
    ['ticket:confirmation', 'Ticket confirmations'],
    ['ticket:reminder', 'Ticket reminders'],
    ['ticket:followUp', 'Ticket follow-ups'],
    ['ticket:waitlist', 'Waitlist emails'],
    ['ticket:admin', 'Order copies to the admin'],
  ],
};

/** The design and text the default template for `key` holds, if one is set. */
export async function defaultTemplate(db: SupabaseClient, key: string): Promise<{ design: EmailDoc; text: string } | null> {
  const { data } = await db.from('email_templates').select('design, text').eq('default_for', key).maybeSingle();
  return data ? { design: data.design as EmailDoc, text: String(data.text ?? '') } : null;
}

/** Every default of a kind, by key (ticket emails read them all at once). */
export async function defaultTemplates(db: SupabaseClient, prefix: string): Promise<Record<string, { design: EmailDoc; text: string }>> {
  const { data } = await db.from('email_templates').select('default_for, design, text').like('default_for', `${prefix}%`);
  return Object.fromEntries((data ?? []).map((r) => [String(r.default_for), { design: r.design as EmailDoc, text: String(r.text ?? '') }]));
}
