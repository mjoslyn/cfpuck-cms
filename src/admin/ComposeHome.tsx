// The admin's home (/admin/): one box to say what to make, and Compose makes it with Claude. A page,
// post or any type with a page opens Compose for a page with the brief (sent at once, or only put in the
// box to add documents, images or links first); a form, campaign, template, part or pattern is made empty
// and opens in its own editor, where Compose writes it (src/admin/ComposeStart.tsx, src/lib/compose/start.ts).
import { useState } from 'react';
import { keepStart } from '../lib/compose/start';
import { FORM_PARTS, TEXT, make, type StartKind } from './ComposeStart';

export interface HomeKind {
  /** A content type (`type:page`) or one of Compose's other kinds (`form`, `campaign`...). */
  id: string;
  label: string;
  /** Starts a group of its own (a rule before it). */
  group?: boolean;
}

const PLACEHOLDERS: Record<string, string> = {
  entry: 'e.g. A page about our fall festival on October 18th at Riverside Park: what\'s on, how to get there, and a call for volunteers.',
  ...Object.fromEntries(Object.entries(TEXT).map(([k, t]) => [k, t.brief])),
};

export default function ComposeHome({ kinds, configured, admin }: { kinds: HomeKind[]; configured: boolean; admin: boolean }) {
  const [kind, setKind] = useState(kinds[0]?.id ?? 'type:page');
  const [brief, setBrief] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const entryType = kind.startsWith('type:') ? kind.slice(5) : null;
  const other = entryType ? null : (kind as StartKind);
  const label = kinds.find((k) => k.id === kind)?.label.toLowerCase() ?? 'page';
  const canSend = configured && !busy && !!brief.trim();

  const go = async (send = true) => {
    if (entryType) {
      keepStart(`new:${entryType}`, { brief: brief.trim(), send });
      location.href = `/admin/compose/?type=${encodeURIComponent(entryType)}`;
      return;
    }
    if (!canSend || !other) return;
    setBusy(true);
    setError('');
    try {
      const made = await make(other, title.trim() || TEXT[other].untitled);
      keepStart(made.what, { brief: brief.trim(), ...(other === 'form' ? { parts: FORM_PARTS.map(([p]) => p), confirm: 'message' as const } : {}) });
      location.href = made.href;
    } catch (e) {
      setBusy(false);
      setError(`The ${TEXT[other].what} couldn’t be made: ${(e as Error).message || 'the site couldn’t be reached'}`);
    }
  };

  return (
    <div className="rounded-lg border border-admin-ink/10 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="What to make">
        {kinds.map((k) => (
          <span key={k.id} className="contents">
            {k.group && <span className="mx-1 h-5 w-px bg-admin-ink/15" aria-hidden="true" />}
            <button
              type="button"
              role="radio"
              aria-checked={kind === k.id}
              onClick={() => setKind(k.id)}
              className={`rounded-full border px-3 py-1 text-sm ${kind === k.id ? 'border-admin-ink bg-admin-ink text-white' : 'border-admin-ink/15 hover:border-admin-accent hover:text-admin-accent'}`}
            >
              {k.label}
            </button>
          </span>
        ))}
      </div>
      {other && other !== 'campaign' && (
        <input className="mb-2 w-full rounded border border-admin-ink/15 px-3 py-2 text-sm outline-none focus:border-admin-accent" aria-label="Name" placeholder={TEXT[other].name} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      )}
      <textarea
        className="min-h-32 w-full resize-y rounded border border-admin-ink/15 p-3 text-base outline-none focus:border-admin-accent"
        aria-label={`What should the ${label} be?`}
        placeholder={PLACEHOLDERS[other ?? 'entry']}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (canSend) go();
          }
        }}
      />
      {error && (
        <p className="mt-2 rounded bg-admin-soft px-2 py-1.5 text-xs text-admin-ink" role="alert">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {!configured ? (
          <span className="text-admin-muted">
            Claude isn't connected yet{admin ? <>: add its key under <a className="underline" href="/admin/settings/connections/">Settings &gt; Connections</a>.</> : ': an admin adds its key under Settings > Connections.'}
          </span>
        ) : entryType ? (
          <button type="button" className="text-admin-muted underline hover:text-admin-accent disabled:opacity-40" disabled={busy} onClick={() => go(false)}>
            Add documents, images or links first
          </button>
        ) : (
          <span className="text-admin-muted">It opens in its own editor, where you check it and save.</span>
        )}
        <button type="button" disabled={!canSend} onClick={() => go()} className="ml-auto rounded-sm bg-admin-ink px-5 py-2 text-xs font-semibold tracking-wider text-white uppercase hover:bg-admin-accent disabled:opacity-40">
          {busy ? 'Working…' : `Compose ${label}`}
        </button>
      </div>
    </div>
  );
}
