// Write with Claude in the form builder (POST /api/admin/forms/compose): the editor says what the form
// is for and picks what to write (fields, the confirmation as a message or a thank-you page, the
// emails); the answer goes into the builder for review, saved with Save. A thank-you page is made as a
// draft.
import { useState } from 'react';
import type { FormDef, Notification } from '../lib/forms/types';

export type ComposeAsk = 'fields' | 'confirmation' | 'notifications';

export interface Composed {
  definition: Partial<FormDef>;
  notifications?: Notification[];
  page?: { id: number; title: string };
  notes: string[];
}

const PARTS: [ComposeAsk, string][] = [
  ['fields', 'Fields'],
  ['confirmation', 'Confirmation'],
  ['notifications', 'Notification emails'],
];

export default function ComposeForm({ form, notifications, ask, canPage, onDone, onClose }: { form: FormDef; notifications: Notification[]; ask: ComposeAsk[]; canPage: boolean; onDone: (c: Composed) => void; onClose: () => void }) {
  const [brief, setBrief] = useState('');
  const [parts, setParts] = useState<Set<ComposeAsk>>(new Set(ask));
  const [confirm, setConfirm] = useState<'message' | 'page'>(form.confirmation?.type === 'page' && canPage ? 'page' : 'message');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (p: ComposeAsk, on: boolean) => setParts((s) => new Set([...s].filter((x) => x !== p).concat(on ? [p] : [])));
  const write = async () => {
    setError('');
    setBusy(true);
    const asked = [...parts].map((p) => (p === 'confirmation' && confirm === 'page' ? 'page' : p));
    const res = await fetch('/api/admin/forms/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief, parts: asked, definition: form, notifications }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError((res && (await res.text())) || 'Claude couldn’t be reached. Try again.');
    onDone(await res.json());
  };
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-admin-ink/40 p-4" onClick={() => !busy && onClose()}>
      <div className="w-[480px] max-w-full rounded bg-white p-5 text-left text-sm shadow-xl" role="dialog" aria-modal="true" aria-label="Write with Claude" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
        <h2 className="mb-1 text-base font-medium">Write with Claude</h2>
        <p className="mb-3 text-xs text-admin-muted">Claude writes what you tick from what you say here and the form as it is. You can change everything before you save.</p>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-admin-muted">What is the form for?</span>
          <textarea
            className="w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent"
            rows={5}
            autoFocus
            value={brief}
            placeholder="Volunteer sign-up for the fall festival: name, email, phone, which shifts (Friday evening, Saturday, Sunday), T-shirt size. Tell them we'll email the schedule a week before."
            onChange={(e) => setBrief(e.target.value)}
          />
        </label>
        <fieldset className="mb-3">
          <legend className="mb-1 text-xs font-medium text-admin-muted">Write</legend>
          {PARTS.map(([p, label]) => (
            <div key={p}>
              <label className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={parts.has(p)} onChange={(e) => toggle(p, e.target.checked)} />
                {label}
              </label>
              {p === 'fields' && parts.has('fields') && form.fields.length > 0 && <p className="mb-1 ml-6 text-xs text-admin-muted">Claude rewrites the fields. Fields it keeps keep their answers; Product fields stay as they are.</p>}
              {p === 'confirmation' && parts.has('confirmation') && canPage && (
                <div className="mb-1 ml-6 flex gap-4 text-xs">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="confirm-as" checked={confirm === 'message'} onChange={() => setConfirm('message')} />A message
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="confirm-as" checked={confirm === 'page'} onChange={() => setConfirm('page')} />A thank-you page (made as a draft)
                  </label>
                </div>
              )}
              {p === 'notifications' && parts.has('notifications') && notifications.length > 0 && <p className="mb-1 ml-6 text-xs text-admin-muted">Replaces the emails. Each keeps the addresses of the one it replaces.</p>}
            </div>
          ))}
        </fieldset>
        {error && <p className="mb-3 rounded bg-admin-soft px-2 py-1.5 text-xs text-admin-ink" role="alert">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          {busy && <span className="mr-auto text-xs text-admin-muted">Writing… this takes up to a minute.</span>}
          <button type="button" className="text-xs text-admin-muted underline hover:text-admin-accent" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !parts.size || (!brief.trim() && !form.fields.length)} className="rounded bg-admin-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-admin-accent-dark disabled:opacity-50" onClick={write}>
            {busy ? 'Writing…' : 'Write'}
          </button>
        </div>
      </div>
    </div>
  );
}
