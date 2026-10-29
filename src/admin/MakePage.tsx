// Make a page from a template, part or pattern: a draft entry of a chosen type with a copy of its
// blocks (POST /api/admin/templates, action make-page, which opens it in the editor). Shown in the
// templates list and the template editor's header.
import { useState } from 'react';
import { COMPOSABLE_TYPES } from '../lib/site';
import { showsType, type Features } from '../lib/features';

export default function MakePage({ kind, slug, title, features, dirty, className }: { kind: string; slug: string; title: string; features: Features; dirty?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const types = COMPOSABLE_TYPES.filter((t) => showsType(t.type, features));
  const field = 'w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent';
  return (
    <span>
      <button type="button" className={className ?? 'text-xs text-admin-muted hover:text-admin-accent'} aria-expanded={open} title="Make a new draft page with a copy of these blocks" onClick={() => setOpen((o) => !o)}>
        Make a page
      </button>
      {open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-admin-ink/40 p-4" onClick={() => setOpen(false)}>
        <form
          method="post"
          action="/api/admin/templates"
          className="w-80 rounded bg-white p-4 text-left text-sm shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-label="Make a page"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          onSubmit={(e) => dirty && !window.confirm('The page is made from the saved version; your unsaved changes won’t be in it. Make it anyway?') && e.preventDefault()}
        >
          <input type="hidden" name="action" value="make-page" />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="slug" value={slug} />
          <h2 className="mb-3 text-base font-medium">Make a page from {title}</h2>
          <label className="mb-2 block">
            <span className="mb-1 block text-xs font-medium text-admin-muted">Title</span>
            <input name="title" className={field} defaultValue={title} required autoFocus />
          </label>
          <label className="mb-2 block">
            <span className="mb-1 block text-xs font-medium text-admin-muted">Type</span>
            <select name="type" className={field} defaultValue={types.some((t) => t.type === 'page') ? 'page' : types[0]?.type}>
              {types.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.singular ?? t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mb-3 flex items-start gap-1.5 text-xs">
            <input type="checkbox" name="keep" className="mt-0.5" />
            <span>Keep the header, footer and Page content blocks (the page's own template usually has them)</span>
          </label>
          <p className="mb-3 text-xs text-admin-muted">A new draft with a copy of these blocks. Changing it won't change the template.</p>
          <div className="flex justify-end gap-3">
            <button type="button" className="text-xs text-admin-muted underline hover:text-admin-accent" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="rounded bg-admin-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-admin-accent">Make the page</button>
          </div>
        </form>
        </div>
      )}
    </span>
  );
}
