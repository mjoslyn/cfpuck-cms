// The standard start for Compose > Form, Campaign, Template, Template part and Pattern
// (/admin/compose/new/?kind=), laid out as Compose for a page: say what it is for, and Send makes it and
// opens it in its own editor, where Compose writes it from this brief at once (src/lib/compose/start.ts):
// the form builder's or campaign editor's Compose, or the page editor's panel for a template.
import { useState } from 'react';
import { keepStart, type ComposeStart as Start } from '../lib/compose/start';

export type StartKind = 'form' | 'campaign' | 'template' | 'part' | 'pattern';

const FORM_PARTS: [string, string][] = [
  ['fields', 'Fields'],
  ['confirmation', 'Confirmation'],
  ['notifications', 'Notification emails'],
];

/** What each kind says on the page. */
const TEXT: Record<StartKind, { what: string; intro: string; name: string; brief: string; untitled: string }> = {
  form: {
    what: 'form',
    intro: 'Say what the form is for and what it should ask. Claude writes what you tick below: its fields, the thank-you message or page, and the emails sent when someone fills it in. The form opens in the builder, where you check it and Save.',
    name: 'Form name (e.g. Festival volunteers)',
    brief: "e.g. Volunteer sign-up for the fall festival: name, email, phone, which shifts (Friday evening, Saturday, Sunday), T-shirt size. Tell them we'll email the schedule a week before.",
    untitled: 'Untitled form',
  },
  campaign: {
    what: 'campaign',
    intro: 'Say what the email is about. Claude writes its subject and the email in the site\'s email style, and can add your latest posts or upcoming events. The campaign opens as a draft, where you choose its lists, check it and Save; nothing is sent until you send it.',
    name: '',
    brief: "e.g. The October newsletter: the fall festival is on the 18th at Riverside Park, we're looking for volunteers (sign up at /volunteer/), and the library's new hours. Then our latest news and upcoming events.",
    untitled: '',
  },
  template: {
    what: 'template',
    intro: 'A page layout, chosen for a type of content under Settings > Types or on a page. Say what pages it is for and what they should show; Claude builds it in the editor, kept with Save & apply.',
    name: 'Template name (e.g. Event with sidebar)',
    brief: 'e.g. A layout for event pages: a wide photo at the top, the details beside the description, and a band of related events at the bottom.',
    untitled: 'New template',
  },
  part: {
    what: 'template part',
    intro: 'A shared section, such as a header, footer or banner, placed in templates. Say what it should hold; Claude builds it in the editor, kept with Save & apply.',
    name: 'Part name (e.g. Holiday banner)',
    brief: 'e.g. A slim banner for the top of every page: the holiday opening hours and a link to the full schedule.',
    untitled: 'New template part',
  },
  pattern: {
    what: 'pattern',
    intro: 'A reusable group of blocks, inserted on any page from the Patterns tab. Say what it is for; Claude builds it in the editor, kept with Save & apply.',
    name: 'Pattern name (e.g. Team members)',
    brief: 'e.g. A grid of team members with a photo, name, role and a short line about each, under a heading.',
    untitled: 'New pattern',
  },
};

async function make(kind: StartKind, title: string): Promise<{ what: string; href: string }> {
  const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (kind === 'form') {
    const res = await post('/api/admin/forms/', { title });
    if (!res.ok) throw new Error(await res.text());
    const { id } = await res.json();
    return { what: `form:${id}`, href: `/admin/forms/${id}/?compose=1` };
  }
  if (kind === 'campaign') {
    const res = await post('/api/admin/mailing/campaigns', { action: 'create' });
    if (!res.ok) throw new Error(await res.text());
    const { id } = await res.json();
    return { what: `campaign:${id}`, href: `/admin/mailing-lists/campaigns/${id}/?compose=1` };
  }
  const res = await post('/api/admin/templates', { action: 'create', kind, title });
  if (!res.ok) throw new Error(await res.text());
  const { slug } = await res.json();
  return { what: `${kind}:${slug}`, href: `/admin/templates/${kind}/${slug}/?compose=1` };
}

export default function ComposeStart({ kind, canPage }: { kind: StartKind; canPage: boolean }) {
  const t = TEXT[kind];
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [parts, setParts] = useState<Set<string>>(new Set(FORM_PARTS.map(([p]) => p)));
  const [confirm, setConfirm] = useState<'message' | 'page'>('message');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canSend = !busy && !!brief.trim() && (kind !== 'form' || parts.size > 0);
  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    setError('');
    try {
      const made = await make(kind, title.trim() || t.untitled);
      const start: Start = { brief: brief.trim(), ...(kind === 'form' ? { parts: FORM_PARTS.map(([p]) => p).filter((p) => parts.has(p)), confirm } : {}) };
      keepStart(made.what, start);
      location.href = made.href;
    } catch (e) {
      setBusy(false);
      setError(`The ${t.what} couldn’t be made: ${(e as Error).message || 'the site couldn’t be reached'}`);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="rounded border border-dashed border-admin-ink/15 p-3 text-sm text-admin-muted">
          <p className="mb-2 font-medium text-admin-ink">Describe the {t.what} you want</p>
          <p>{t.intro}</p>
        </div>
      </div>
      <div className="border-t border-admin-ink/10 p-3">
        {t.name && <input className="mb-2 w-full rounded border border-admin-ink/15 px-2 py-1.5 text-sm outline-none focus:border-admin-accent" aria-label="Name" placeholder={t.name} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />}
        <textarea
          className="max-h-48 min-h-20 w-full resize-y rounded border border-admin-ink/15 p-2 text-sm outline-none focus:border-admin-accent"
          aria-label={`What is the ${t.what} for?`}
          placeholder={t.brief}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {error && (
          <p className="mt-2 rounded bg-admin-soft px-2 py-1.5 text-xs text-admin-ink" role="alert">
            {error}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          {kind === 'form' && (
            <>
              <span className="text-admin-muted">Write</span>
              {FORM_PARTS.map(([p, label]) => (
                <label key={p} className="flex items-center gap-1">
                  <input type="checkbox" checked={parts.has(p)} onChange={(e) => setParts((s) => new Set([...s].filter((x) => x !== p).concat(e.target.checked ? [p] : [])))} />
                  {label}
                </label>
              ))}
              {canPage && parts.has('confirmation') && (
                <label className="flex items-center gap-1 text-admin-muted">
                  Confirmation as
                  <select className="rounded border border-admin-ink/15 px-1 py-1 text-admin-ink" value={confirm} onChange={(e) => setConfirm(e.target.value as 'message' | 'page')}>
                    <option value="message">A message</option>
                    <option value="page">A thank-you page (a draft)</option>
                  </select>
                </label>
              )}
            </>
          )}
          <button type="button" disabled={!canSend} onClick={send} className="ml-auto rounded-sm bg-admin-ink px-4 py-1.5 font-semibold tracking-wider text-white uppercase hover:bg-admin-accent disabled:opacity-40">
            {busy ? 'Working…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
