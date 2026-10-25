// The email builder's Templates panel (src/lib/email-templates.ts): the kit's saved templates to start
// the email from, with the kind of email each is the default for; saving the email as a new template or
// over one; deleting. Read and written with the editor's own session (editors only, by RLS).
import { useEffect, useState } from 'react';
import { browserClient } from '../lib/db/browser';
import { TEMPLATE_DEFAULTS, type EmailTemplate, type TemplateKit } from '../lib/email-templates';
import type { EmailDoc } from '../lib/forms/email';

const input = 'rounded border border-admin-ink/15 bg-white px-2 py-1 text-sm';

export function EmailTemplates({ kit, design, text, onUse, onClose }: { kit: TemplateKit; design: EmailDoc; text?: string; onUse: (t: EmailTemplate) => void; onClose: () => void }) {
  const [list, setList] = useState<EmailTemplate[] | null>(null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const defaults = TEMPLATE_DEFAULTS[kit];
  const label = (key: string | null) => defaults.find(([k]) => k === key)?.[1] ?? '';
  const load = async () => {
    const { data, error } = await browserClient().from('email_templates').select('*').eq('kit', kit).order('name');
    if (error) setStatus(error.message);
    setList((data ?? []) as EmailTemplate[]);
  };
  useEffect(() => {
    load();
  }, [kit]);
  const run = async (what: () => PromiseLike<{ error: { message: string } | null }>, done: string) => {
    setStatus('');
    const { error } = await what();
    setStatus(error ? error.message : done);
    await load();
  };
  const save = () => {
    const n = name.trim();
    if (!n) return setStatus('Name the template.');
    return run(() => browserClient().from('email_templates').insert({ kit, name: n.slice(0, 100), design, text: text ?? '' }), `Saved as “${n}”.`).then(() => setName(''));
  };
  // One template per kind of email: the one that was its default stops being it.
  const makeDefault = (t: EmailTemplate, key: string) =>
    run(async () => {
      const db = browserClient();
      if (key) {
        const { error } = await db.from('email_templates').update({ default_for: null }).eq('default_for', key).neq('id', t.id);
        if (error) return { error };
      }
      return db.from('email_templates').update({ default_for: key || null }).eq('id', t.id);
    }, key ? `“${t.name}” is the default for ${label(key).toLowerCase()}.` : `“${t.name}” is no longer a default.`);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-admin-ink/10 bg-admin-soft p-4 text-sm" aria-label="Templates">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Templates</h2>
        <button type="button" className="text-xs underline" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="mb-2 text-xs text-admin-muted">Save this email to start others from it. A default is what new emails of that kind start from{kit === 'ticket' ? ', and what a ticket email nobody has changed is sent as' : ''}.</p>
      <div className="mb-4 flex gap-2">
        <input className={`${input} min-w-0 flex-1`} placeholder="Template name" aria-label="Template name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <button type="button" className="rounded-sm bg-admin-ink px-3 py-1 text-xs font-semibold text-white hover:bg-admin-accent" onClick={save}>
          Save as template
        </button>
      </div>
      {status && (
        <p className="mb-3 text-xs" role="status">
          {status}
        </p>
      )}
      {list === null && <p className="text-xs text-admin-muted">Loading…</p>}
      {list?.length === 0 && <p className="text-xs text-admin-muted">No templates yet.</p>}
      {list?.map((t) => (
        <div key={t.id} className="mb-2 rounded border border-admin-ink/10 bg-white p-2">
          <div className="font-medium">{t.name}</div>
          <label className="mt-1 block text-xs text-admin-muted">
            Default for{' '}
            <select className={`${input} mt-1 w-full text-xs`} value={t.default_for ?? ''} onChange={(e) => makeDefault(t, e.target.value)}>
              <option value="">(none)</option>
              {defaults.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2 flex gap-3 text-xs">
            <button type="button" className="underline hover:text-admin-accent" onClick={() => confirm(`Replace this email with “${t.name}”? Its design and plain text are swapped for the template's.`) && onUse(t)}>
              Use
            </button>
            <button type="button" className="underline hover:text-admin-accent" onClick={() => confirm(`Save this email over “${t.name}”?`) && run(() => browserClient().from('email_templates').update({ design, text: text ?? '' }).eq('id', t.id), `“${t.name}” updated.`)}>
              Save over it
            </button>
            <button type="button" className="text-[#c4592a] underline" onClick={() => confirm(`Delete “${t.name}”? Emails made from it keep their design.`) && run(() => browserClient().from('email_templates').delete().eq('id', t.id), `“${t.name}” deleted.`)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </aside>
  );
}
