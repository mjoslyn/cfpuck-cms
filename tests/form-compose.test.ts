// Write with Claude for forms (applyComposed): Claude's answer becomes the form's fields, confirmation,
// thank-you page plan and emails. Fields it keeps keep their ids (and answers), products stay, tags name
// the form's fields, and emails keep the addresses of the ones they replace.
import { describe, expect, it, vi } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { applyComposed, composeSchema, markdownHtml, type ComposedForm } from '../src/lib/forms/compose';
import { outputSchema } from '../src/lib/compose/quick';
import { changesPages } from '../src/lib/cache';
import type { FormDef, Notification } from '../src/lib/forms/types';

const form = (fields: FormDef['fields'], extra: Partial<FormDef> = {}): FormDef => ({ id: 1, title: 'Volunteer', fields, nextId: fields.length + 1, ...extra });

describe('composing a form', () => {
  it('asks only for the parts wanted, in a schema structured outputs takes', () => {
    expect(Object.keys(composeSchema(['fields']).properties)).toEqual(['description', 'submit_label', 'fields']);
    expect(composeSchema(['page', 'notifications']).required).toEqual(['page', 'notifications']);
    expect(JSON.stringify(outputSchema(composeSchema(['fields', 'confirmation', 'page', 'notifications'])))).not.toMatch(/"(minimum|maxItems)"/);
  });

  it('writes fields, keeping the ids and settings of those it keeps, and conditions on earlier fields', () => {
    const def = form([
      { id: 'f1', type: 'text', label: 'Your name', errorMessage: 'Tell us who you are' },
      { id: 'f2', type: 'product', label: 'T-shirt', priceMode: 'fixed', price: 15 },
      { id: 'f3', type: 'textarea', label: 'Notes' },
    ]);
    const answer: ComposedForm = {
      description: 'Help at the fall festival.',
      submit_label: 'Sign up',
      fields: [
        { key: 'f1', type: 'text', label: 'Full name', required: true, width: 'half' },
        { key: 'email', type: 'email', label: 'Email', required: true, width: 'half', placeholder: 'you@example.org' },
        { key: 'shift', type: 'radio', label: 'Shift', required: true, width: 'full', choices: ['Friday', 'Saturday', 'Saturday'] },
        { key: 'why', type: 'textarea', label: 'Why Friday?', required: false, width: 'full', show_if: { match: 'all', rules: [{ field: 'shift', op: 'is', value: 'Friday' }, { field: 'later', op: 'is', value: 'x' }] } },
        { key: 'later', type: 'bogus', label: 'Later', required: false, width: 'wide' },
      ],
    };
    const { definition } = applyComposed(def, [], answer);
    expect(definition.fields!.map((f) => [f.id, f.type, f.label])).toEqual([
      ['f1', 'text', 'Full name'],
      ['f4', 'email', 'Email'],
      ['f5', 'radio', 'Shift'],
      ['f6', 'textarea', 'Why Friday?'],
      ['f7', 'text', 'Later'],
      ['f2', 'product', 'T-shirt'],
    ]);
    expect(definition.fields![0]).toMatchObject({ errorMessage: 'Tell us who you are', required: true, width: 'half' });
    expect(definition.fields![2].choices).toEqual([{ label: 'Friday', value: 'Friday' }, { label: 'Saturday', value: 'Saturday' }]);
    expect(definition.fields![3].logic).toEqual({ action: 'show', match: 'all', rules: [{ field: 'f5', op: 'is', value: 'Friday' }] });
    expect(definition.fields![4].width).toBeUndefined();
    expect(definition.fields![5]).toBe(def.fields[1]);
    expect(definition).toMatchObject({ nextId: 8, submitLabel: 'Sign up', description: 'Help at the fall festival.' });
  });

  it('turns tags into the form\'s, dropping unknown ones, in the confirmation and emails', () => {
    const def = form([{ id: 'f1', type: 'name', label: 'Name' }, { id: 'f2', type: 'email', label: 'Email: work' }]);
    const notifications: Notification[] = [
      { id: 'site1', name: 'Staff', to: 'events@example.org', subject: 'x', message: '', fromName: 'Town', design: { root: { props: { background: '#000000' } }, content: [] } },
    ];
    const answer: ComposedForm = {
      confirmation: 'Thanks, {f1.first}. We wrote to {f2}.\n\n- {unknown}\n- {form_title}',
      notifications: [
        { name: 'Staff notice', to: 'site', subject: 'New volunteer: {f1}', heading: 'From {f1.first}', body: 'See below.', answers: true, button_label: 'Open', button_url: 'javascript:alert(1)' },
        { name: 'Receipt', to: 'visitor', subject: 'Thanks for signing up', preheader: 'We got it', heading: 'Thank you', body: 'We\'ll email you on {date}.', answers: false, button_label: 'Events', button_url: '/events/' },
      ],
    };
    const { definition, notifications: out, notes } = applyComposed(def, notifications, answer, { background: '#ffffff' });
    expect(definition.confirmation).toEqual({ type: 'message', message: '<p>Thanks, {Name:f1.first}. We wrote to {Email work:f2}.</p><ul><li>{form_title}</li></ul>' });
    expect(notes).toEqual([]);
    const [staff, receipt] = out!;
    expect(staff).toMatchObject({ id: 'site1', name: 'Staff notice', to: 'events@example.org', fromName: 'Town', subject: 'New volunteer: {Name:f1}' });
    expect(staff.design!.root.props.background).toBe('#000000');
    expect(staff.design!.content.map((b) => b.type)).toEqual(['Heading', 'Text', 'FormField']);
    expect(receipt).toMatchObject({ to: '{Email work:f2}', replyTo: '{admin_email}' });
    expect(receipt.design!.root.props).toMatchObject({ background: '#ffffff', preheader: 'We got it' });
    expect(receipt.design!.content.at(-1)).toMatchObject({ type: 'Button', props: { label: 'Events', url: '/events/' } });
  });

  it('leaves out an email to the visitor when the form asks for no email address', () => {
    const { notifications, notes } = applyComposed(form([{ id: 'f1', type: 'text', label: 'Name' }]), [], { notifications: [{ name: 'Receipt', to: 'visitor', subject: 's', heading: 'h', body: 'b' }] });
    expect(notifications).toEqual([]);
    expect(notes[0]).toMatch(/needs an Email field/);
  });

  it('plans a thank-you page without tags or unsafe links, keeping the message for while it is a draft', () => {
    const def = form([], { confirmation: { type: 'message', message: 'Thanks!' } });
    const { definition, page } = applyComposed(def, [], {
      page: { title: 'You\'re signed up', sections: [{ kind: 'text', heading: 'Thanks', body: 'Hi {f1}.', buttons: [{ label: 'Home', url: '/' }, { label: 'Bad', url: 'javascript:x' }] }, { kind: 'faq', heading: 'Next', body: '', items: [{ question: 'When?', answer: 'Soon.' }] }] },
    });
    expect(definition.confirmation).toEqual({ type: 'page', message: 'Thanks!' });
    expect(page!.title).toBe('You\'re signed up');
    expect(page!.sections[0]).toMatchObject({ kind: 'text', body: 'Hi .', buttons: [{ label: 'Home', url: '/' }] });
    expect(page!.sections[1].items).toEqual([{ question: 'When?', answer: 'Soon.' }]);
  });

  it('writes simple Markdown as the HTML emails take, and doesn\'t clear the page cache', () => {
    expect(markdownHtml('**Hi** <b>there</b>\nline two\n\n- one\n- [two](https://example.org)')).toBe('<p><strong>Hi</strong> &lt;b&gt;there&lt;/b&gt;<br>line two</p><ul><li>one</li><li><a href="https://example.org">two</a></li></ul>');
    expect(changesPages('POST', '/api/admin/forms/compose')).toBe(false);
    expect(changesPages('PUT', '/api/admin/forms/3/')).toBe(true);
  });
});

describe('the compose endpoint', () => {
  it('makes the thank-you page as a hidden draft and points the confirmation at it', async () => {
    const quick = await import('../src/lib/compose/quick');
    const spy = vi.spyOn(quick, 'quickAsk').mockResolvedValue({ page: { title: 'Thank you', sections: [{ kind: 'text', heading: 'We got it', body: 'See you soon.' }] }, confirmation: 'ignored' });
    const { POST } = await import('../src/pages/api/admin/forms/compose');
    const db = siteDb();
    const call = (body: unknown) => POST({ request: new Request('http://x/api/admin/forms/compose', { method: 'POST', body: JSON.stringify(body) }), locals: { db } } as any) as Promise<Response>;
    const res = await call({ brief: 'Sign-ups', parts: ['confirmation', 'page'], definition: form([]), notifications: [] });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(spy.mock.calls[0][2]).toMatch(/Sign-ups/);
    expect(Object.keys((spy.mock.calls[0][1] as any).input_schema.properties)).toEqual(['page']);
    const { data: page } = await db.from('entries').select('id, type, slug, status, fields, content').eq('id', out.page.id).single();
    expect(page).toMatchObject({ type: 'page', slug: 'thank-you', status: 'draft', fields: { seo: { noindex: true, nosearch: true } } });
    expect(JSON.stringify(page!.content)).toContain('We got it');
    expect(out.definition.confirmation).toMatchObject({ type: 'page', pageId: page!.id });
    expect((await call({ brief: '', parts: ['fields'], definition: form([]) })).status).toBe(400);
    spy.mockRestore();
  });
});
