// Move a template, part or pattern to the trash (POST /api/admin/templates, actions uses and trash): the
// dialog first says what uses it, and what those pages show without it. Shown in the templates list.
import { useState } from 'react';
import type { TemplateUses } from '../lib/admin/template-trash';

const KIND = { template: 'template', part: 'template part', pattern: 'pattern' } as Record<string, string>;
const listed = (names: string[]) => (names.length > 5 ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} more` : names.join(', '));

export default function TrashTemplate({ kind, slug, title }: { kind: string; slug: string; title: string }) {
  const [uses, setUses] = useState<TemplateUses | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const post = (action: string) => fetch('/api/admin/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, kind, slug }) }).catch(() => null);
  const open = async () => {
    setError('');
    setBusy(true);
    const res = await post('uses');
    setBusy(false);
    if (!res?.ok) return window.alert((res && (await res.text())) || 'Couldn’t check what uses it. Try again.');
    setUses(await res.json());
  };
  const trash = async () => {
    setBusy(true);
    const res = await post('trash');
    setBusy(false);
    if (!res?.ok) return setError((res && (await res.text())) || 'Couldn’t move it to the trash. Try again.');
    location.reload();
  };
  const used = uses && (uses.entries.length || uses.templates.length || uses.settings || uses.terms.length);
  return (
    <span>
      <button type="button" className="text-xs text-admin-muted hover:text-admin-accent" aria-label={`Move ${title} to the trash`} disabled={busy} onClick={open}>
        Trash
      </button>
      {uses && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-admin-ink/40 p-4" onClick={() => setUses(null)}>
          <div className="w-96 rounded bg-white p-4 text-left text-sm shadow-xl" role="dialog" aria-modal="true" aria-label="Move to the trash" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setUses(null)}>
            <h2 className="mb-3 text-base font-medium">Move {title} to the trash?</h2>
            {used ? (
              <>
                <p className="mb-2">This {KIND[kind]} is in use:</p>
                <ul className="mb-3 list-disc pl-5 text-xs">
                  {uses.entries.length > 0 && <li>{kind === 'template' ? 'Chosen by' : 'On'} {listed(uses.entries)}</li>}
                  {uses.templates.length > 0 && <li>In {listed(uses.templates)}</li>}
                  {uses.settings && <li>Chosen under Settings &gt; Types</li>}
                  {uses.terms.length > 0 && <li>Chosen by {listed(uses.terms)}</li>}
                </ul>
                <p className="mb-3 text-xs text-admin-muted">{kind === 'template' ? 'Those pages will use the next template in line until you restore it.' : 'It will disappear from those pages until you restore it.'}</p>
              </>
            ) : (
              <p className="mb-3 text-xs text-admin-muted">Nothing uses it. You can restore it from the trash at the bottom of Templates.</p>
            )}
            {error && <p className="mb-3 rounded bg-admin-soft px-2 py-1.5 text-xs text-admin-ink" role="alert">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" className="text-xs text-admin-muted underline hover:text-admin-accent" autoFocus onClick={() => setUses(null)}>
                Cancel
              </button>
              <button type="button" disabled={busy} className="rounded bg-admin-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-admin-accent disabled:opacity-50" onClick={trash}>
                Move to the trash
              </button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
