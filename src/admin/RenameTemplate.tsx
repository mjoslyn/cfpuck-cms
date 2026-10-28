// Rename a template, part or pattern (POST /api/admin/templates, action rename): its name and its
// address (slug), which follows the name until it is edited. Shown in the templates list and the
// template editor's header; a new address reopens the editor there.
import { useState } from 'react';
import { TEMPLATE_TITLE_MAX, templateSlug } from '../lib/admin/rename-template';

export default function RenameTemplate({ kind, slug, title, dirty, onRenamed, className }: { kind: string; slug: string; title: string; dirty?: boolean; onRenamed?: (title: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(title);
  const [address, setAddress] = useState(slug);
  // The address follows the name until someone types one.
  const [ownAddress, setOwnAddress] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    setOpen(false);
    setError('');
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newSlug = templateSlug(address);
    if (dirty && newSlug !== slug) return setError('Save your changes first: a new address reopens the editor.');
    setBusy(true);
    setError('');
    const res = await fetch('/api/admin/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'rename', kind, slug, title: name, newSlug }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError((res && (await res.text())) || 'Couldn’t rename it. Try again.');
    const saved = (await res.json()) as { title: string; slug: string; failed: number };
    if (saved.failed) window.alert(`Renamed, but ${saved.failed} place${saved.failed === 1 ? '' : 's'} naming the old address couldn’t be changed. They still find it by its old address.`);
    setOpen(false);
    if (saved.slug !== slug && onRenamed) location.replace(`/admin/templates/${kind}/${saved.slug}/`);
    else if (onRenamed) onRenamed(saved.title);
    else location.reload();
  };
  const field = 'w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent';
  return (
    <span>
      <button
        type="button"
        className={className ?? 'text-xs text-admin-muted hover:text-admin-accent'}
        aria-expanded={open}
        aria-label={`Rename ${title}`}
        onClick={() => {
          setName(title);
          setAddress(slug);
          setOwnAddress(false);
          setOpen((o) => !o);
        }}
      >
        Rename
      </button>
      {open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-admin-ink/40 p-4" onClick={close}>
          <form className="w-80 rounded bg-white p-4 text-left text-sm shadow-xl" role="dialog" aria-modal="true" aria-label="Rename" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()} onSubmit={submit}>
            <h2 className="mb-3 text-base font-medium">Rename {title}</h2>
            <label className="mb-2 block">
              <span className="mb-1 block text-xs font-medium text-admin-muted">Name</span>
              <input
                className={field}
                value={name}
                maxLength={TEMPLATE_TITLE_MAX}
                required
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  if (!ownAddress) setAddress(templateSlug(e.target.value) || slug);
                }}
              />
            </label>
            <label className="mb-2 block">
              <span className="mb-1 block text-xs font-medium text-admin-muted">Address</span>
              <input
                className={`${field} font-mono`}
                value={address}
                required
                onChange={(e) => {
                  setOwnAddress(true);
                  setAddress(e.target.value);
                }}
                onBlur={() => setAddress((a) => templateSlug(a) || slug)}
              />
            </label>
            <p className="mb-3 text-xs text-admin-muted">
              {templateSlug(address) === slug
                ? 'Its address stays as it is.'
                : `Pages, settings and other templates using ${slug} will use ${templateSlug(address) || '…'}, and anything still naming ${slug} keeps finding it.`}
            </p>
            {error && <p className="mb-3 rounded bg-admin-soft px-2 py-1.5 text-xs text-admin-ink" role="alert">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" className="text-xs text-admin-muted underline hover:text-admin-accent" onClick={close}>
                Cancel
              </button>
              <button disabled={busy || !name.trim() || !templateSlug(address)} className="rounded bg-admin-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-admin-accent disabled:opacity-50">
                {busy ? 'Renaming…' : 'Rename'}
              </button>
            </div>
          </form>
        </div>
      )}
    </span>
  );
}
