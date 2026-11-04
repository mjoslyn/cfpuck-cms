// Settings > Popups (src/lib/popups.ts): each popup's name, the template part it shows (edited in the
// visual editor, in a new tab), where and when it shows, and how often; one can be the cookie consent
// banner, with its buttons' words and a link to the privacy policy. Saved with Save settings.
import { useState } from 'react';
import { CONSENT_STARTER, POPUP_FREQUENCIES, POPUP_LAYOUTS, POPUP_TRIGGERS, type Popup } from '../lib/popups';
import { inputClass } from '../puck/fields';

interface Part {
  slug: string;
  title: string;
}

const label = 'mb-1 block text-xs font-semibold text-admin-muted';
const button = 'rounded-sm border border-admin-ink/15 bg-white px-3 py-1.5 text-xs font-semibold hover:border-admin-accent';

/** A popup's id from its name (letters, digits and dashes), not one already used. */
function newId(name: string, taken: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'popup';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export default function PopupsSettings({ value, parts: initialParts, onChange }: { value: Popup[]; parts: Part[]; onChange: (popups: Popup[]) => void }) {
  const [parts, setParts] = useState(initialParts);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const hasConsent = value.some((p) => p.consent);
  const update = (i: number, patch: Partial<Popup>) => onChange(value.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  /** A new popup, with a template part of its own for its content. */
  async function add(consent: boolean) {
    const name = consent ? 'Cookie consent' : `Popup ${value.length + 1}`;
    setBusy(consent ? 'consent' : 'popup');
    setError('');
    try {
      const r = await fetch('/api/admin/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', kind: 'part', title: name, ...(consent ? { content: CONSENT_STARTER } : {}) }) });
      if (!r.ok) throw new Error(await r.text());
      const { slug } = (await r.json()) as { slug: string };
      setParts((ps) => [...ps, { slug, title: name }]);
      const popup: Popup = consent
        ? { id: newId(name, value.map((p) => p.id)), name, enabled: false, part: slug, layout: 'bar-bottom', trigger: 'load', frequency: 'always', pages: 'all', consent: true }
        : { id: newId(name, value.map((p) => p.id)), name, enabled: false, part: slug, layout: 'modal', trigger: 'delay', delay: 5, frequency: 'session', pages: 'all' };
      onChange([...value, popup]);
    } catch (e) {
      setError(`Couldn't make its content: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <p className="mb-4 text-xs text-admin-muted">
        A popup shows a template part over the site's pages. Build its content with <strong>Edit content</strong> (it opens in the visual editor, in a new tab), then choose where and when it shows here and turn it on. Changes here are saved with Save settings.
      </p>
      {value.map((p, i) => (
        <div key={p.id} className="mb-4 rounded border border-admin-ink/10 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={!!p.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
              {p.enabled ? 'On' : 'Off'}
              {p.consent && <span className="rounded bg-admin-soft px-2 py-0.5 text-xs font-normal">Cookie consent banner</span>}
            </label>
            <div className="flex gap-2">
              <a className={button} href={`/admin/templates/part/${p.part}/`} target="_blank" rel="noopener">
                Edit content
              </a>
              <button type="button" className={button} onClick={() => confirm(`Remove “${p.name}”? Its content stays under Templates > Parts.`) && onChange(value.filter((_, k) => k !== i))}>
                Remove
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}>Name (for screen readers and this list)</span>
              <input className={inputClass} value={p.name} onChange={(e) => update(i, { name: e.target.value })} />
            </label>
            <label className="block">
              <span className={label}>Content (a template part)</span>
              <select className={inputClass} value={p.part} onChange={(e) => update(i, { part: e.target.value })}>
                {!parts.some((x) => x.slug === p.part) && <option value={p.part}>{p.part} (missing)</option>}
                {parts.map((x) => (
                  <option key={x.slug} value={x.slug}>
                    {x.title || x.slug}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>Shown as</span>
              <select className={inputClass} value={p.layout} onChange={(e) => update(i, { layout: e.target.value as Popup['layout'] })}>
                {POPUP_LAYOUTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {!p.consent && (
              <>
                <div>
                  <label className="block">
                    <span className={label}>Shows</span>
                    <select className={inputClass} value={p.trigger} onChange={(e) => update(i, { trigger: e.target.value as Popup['trigger'] })}>
                      {POPUP_TRIGGERS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {p.trigger === 'delay' && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-admin-muted">
                      After <input type="number" min={0} max={600} className={`${inputClass} w-20`} value={p.delay ?? 5} onChange={(e) => update(i, { delay: Number(e.target.value) })} /> seconds
                    </label>
                  )}
                  {p.trigger === 'scroll' && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-admin-muted">
                      After <input type="number" min={1} max={100} className={`${inputClass} w-20`} value={p.scroll ?? 50} onChange={(e) => update(i, { scroll: Number(e.target.value) })} /> % of the page
                    </label>
                  )}
                  {p.trigger === 'exit' && <p className="mt-1 text-xs text-admin-muted">When the pointer leaves the top of the window (computers only).</p>}
                </div>
                <div>
                  <label className="block">
                    <span className={label}>How often</span>
                    <select className={inputClass} value={p.frequency} onChange={(e) => update(i, { frequency: e.target.value as Popup['frequency'] })}>
                      {POPUP_FREQUENCIES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {p.frequency === 'days' && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-admin-muted">
                      Again after <input type="number" min={1} max={365} className={`${inputClass} w-20`} value={p.days ?? 7} onChange={(e) => update(i, { days: Number(e.target.value) })} /> days
                    </label>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <label className="block">
                    <span className={label}>On</span>
                    <select className={inputClass} value={p.pages} onChange={(e) => update(i, { pages: e.target.value as Popup['pages'] })}>
                      <option value="all">Every page</option>
                      <option value="only">Only these pages</option>
                      <option value="except">Every page but these</option>
                    </select>
                  </label>
                  {p.pages !== 'all' && (
                    <label className="mt-2 block">
                      <span className="mb-1 block text-xs text-admin-muted">One address a line, such as /about/; end with * for everything under it, such as /events/*</span>
                      <textarea className={`${inputClass} font-mono text-xs`} rows={3} value={(p.paths ?? []).join('\n')} onChange={(e) => update(i, { paths: e.target.value.split('\n') })} />
                    </label>
                  )}
                </div>
              </>
            )}
            {p.consent && (
              <>
                <p className="text-xs text-admin-muted sm:col-span-2">
                  Its Accept and Reject buttons and the privacy policy link are in its content: use <strong>Edit content</strong> to change their words, size and look like any other button (Accept links to <code>#accept-cookies</code>, Reject to <code>#reject-cookies</code>). Shows on every page until the visitor chooses, then not again for six months. Until they accept, the Stats cookie isn't set and code snippets marked “Only after visitors accept cookies” don't run. A link to <code>#cookie-settings</code> anywhere on the site (in the footer, say) opens it again so they can change their mind.
                </p>
              </>
            )}
          </div>
        </div>
      ))}
      {error && <p className="mb-3 text-sm text-[#c4592a]">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={!!busy} onClick={() => add(false)}>
          {busy === 'popup' ? 'Adding…' : 'Add a popup'}
        </button>
        {!hasConsent && (
          <button type="button" className={button} disabled={!!busy} onClick={() => add(true)}>
            {busy === 'consent' ? 'Adding…' : 'Add a cookie consent banner'}
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-admin-muted">Inside a popup's content, links to <code>#close-popup</code> close it, and links to <code>#accept-cookies</code> or <code>#reject-cookies</code> record the visitor's choice.</p>
    </div>
  );
}
