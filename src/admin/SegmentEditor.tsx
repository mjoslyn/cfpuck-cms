// A segment: its name and rules (all must match, or any), and who matches now, subscribed, with a count
// and the first 100 (src/lib/mailing/segments.ts; the database evaluates the rules). Saves with
// POST /api/admin/mailing/segments.
import { useEffect, useRef, useState } from 'react';
import { RULE_TYPES, cleanTags, describeSegment, type Rule, type RuleType, type Segment } from '../lib/mailing/segments';
import type { MailList } from '../lib/mailing/config';
import type { MemberLevel } from '../lib/members/config';

const input = 'rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent';
const primary = 'rounded-sm bg-admin-ink px-4 py-2 text-xs font-semibold tracking-wider text-white uppercase hover:bg-admin-accent disabled:opacity-50';

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/mailing/segments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** A new rule of a type, with a starting value. */
const fresh = (type: RuleType): Rule => (type === 'joined' || type === 'opened' || type === 'clicked' ? { type, days: 30 } : type === 'field' ? { type, key: '', op: 'equals', value: '' } : { type });

export default function SegmentEditor({ segment, lists, levels, tags, fields, usedBy }: { segment: Segment; lists: MailList[]; levels: MemberLevel[] | null; tags: string[]; fields: string[]; usedBy: { id: number; name: string; kind: 'campaign' | 'digest' }[] }) {
  const [s, setS] = useState(segment);
  const [saved, setSaved] = useState(() => JSON.stringify(segment));
  const [status, setStatus] = useState('');
  const [people, setPeople] = useState<{ count: number; people: { id: number; email: string; name: string }[] } | null>(null);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(s) !== saved;
  const rules = s.rules.rules;
  const setRules = (next: Rule[]) => setS((x) => ({ ...x, rules: { ...x.rules, rules: next } }));
  const setRule = (i: number, patch: Partial<Rule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const types = RULE_TYPES.filter((t) => !t.members || levels);
  const names = { lists: new Map(lists.map((l) => [l.id, l.name])), levels: new Map((levels ?? []).map((l) => [l.id, l.name])) };

  // Who matches, a moment after the rules stop changing.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = JSON.stringify(s.rules);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setError('');
      post({ action: 'people', rules: s.rules }).then(setPeople, (e) => setError(e.message));
    }, 400);
    return () => clearTimeout(timer.current);
  }, [key]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async () => {
    setStatus('Saving…');
    try {
      await post({ action: 'save', id: s.id, segment: s });
      setSaved(JSON.stringify(s));
      setStatus(`Saved ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-admin-muted">
            <a className="underline" href="/admin/mailing-lists/?tab=segments">Mailing Lists › Segments</a>
          </p>
          <h1 className="text-3xl font-normal">{s.name || 'Untitled segment'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span role="status" className="text-xs text-admin-muted">{status || (dirty ? 'Unsaved changes' : '')}</span>
          <button type="button" className={primary} disabled={!dirty} onClick={save}>
            Save
          </button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
        <div>
          <label className="mb-3 block text-sm">
            <span className="mb-1.5 block font-medium">Name</span>
            <input className={`${input} w-full`} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
          </label>
          <label className="mb-4 block text-sm">
            <span className="mb-1.5 block font-medium">Description (for you)</span>
            <input className={`${input} w-full`} value={s.description} placeholder="Farm businesses near the village" onChange={(e) => setS({ ...s, description: e.target.value })} />
          </label>

          <div className="rounded bg-white p-4 shadow-[0_0_0_1px_rgba(26,26,46,0.08)]">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span>People who match</span>
              <select className={input} value={s.rules.match} onChange={(e) => setS({ ...s, rules: { ...s.rules, match: e.target.value === 'any' ? 'any' : 'all' } })}>
                <option value="all">all of these</option>
                <option value="any">any of these</option>
              </select>
            </div>
            {rules.map((r, i) => {
              const t = RULE_TYPES.find((x) => x.type === r.type)!;
              return (
                <div key={`${i}:${rules.length}:${r.type}`} className="mb-2 flex flex-wrap items-center gap-2 border-t border-admin-ink/5 pt-2 text-sm">
                  <select className={input} aria-label="Rule" value={r.type} onChange={(e) => setRules(rules.map((x, j) => (j === i ? fresh(e.target.value as RuleType) : x)))}>
                    {types.map((x) => (
                      <option key={x.type} value={x.type}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  <select className={input} aria-label="Is or isn't" value={r.not ? 'no' : 'yes'} onChange={(e) => setRule(i, { not: e.target.value === 'no' || undefined })}>
                    <option value="yes">{t.yes}</option>
                    <option value="no">{t.no}</option>
                  </select>
                  {r.type === 'list' && (
                    <span className="flex flex-wrap gap-2">
                      {lists.map((l) => (
                        <label key={l.id} className="inline-flex items-center gap-1">
                          <input type="checkbox" checked={(r.lists ?? []).includes(l.id)} onChange={(e) => setRule(i, { lists: e.target.checked ? [...(r.lists ?? []), l.id] : (r.lists ?? []).filter((x) => x !== l.id) })} />
                          {l.name}
                        </label>
                      ))}
                    </span>
                  )}
                  {r.type === 'tag' && (
                    <>
                      <input className={`${input} w-56`} list="segment-tags" placeholder="tags, comma separated" defaultValue={(r.tags ?? []).join(', ')} onBlur={(e) => setRule(i, { tags: cleanTags(e.target.value) })} />
                      <span className="text-xs text-admin-muted">(any of)</span>
                    </>
                  )}
                  {r.type === 'field' && (
                    <>
                      <input className={`${input} w-36`} list="segment-fields" placeholder="field, e.g. town" value={r.key ?? ''} onChange={(e) => setRule(i, { key: e.target.value })} />
                      <select className={input} aria-label="How" value={r.op ?? 'equals'} onChange={(e) => setRule(i, { op: e.target.value as Rule['op'] })}>
                        <option value="equals">equal to</option>
                        <option value="contains">containing</option>
                        <option value="set">filled in</option>
                      </select>
                      {r.op !== 'set' && <input className={`${input} w-40`} placeholder="value" value={r.value ?? ''} onChange={(e) => setRule(i, { value: e.target.value })} />}
                    </>
                  )}
                  {r.type === 'member' && levels && levels.length > 0 && (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-admin-muted">of</span>
                      {levels.map((l) => (
                        <label key={l.id} className="inline-flex items-center gap-1">
                          <input type="checkbox" checked={(r.levels ?? []).includes(l.id)} onChange={(e) => setRule(i, { levels: e.target.checked ? [...(r.levels ?? []), l.id] : (r.levels ?? []).filter((x) => x !== l.id) })} />
                          {l.name}
                        </label>
                      ))}
                      <span className="text-xs text-admin-muted">(none ticked: any level)</span>
                    </span>
                  )}
                  {(r.type === 'joined' || r.type === 'opened' || r.type === 'clicked') && (
                    <>
                      <input type="number" min={1} max={3650} className={`${input} w-20`} value={r.days ?? 30} onChange={(e) => setRule(i, { days: Number(e.target.value) || 30 })} />
                      <span>days{r.type === 'joined' && r.not ? ' ago' : ''}</span>
                    </>
                  )}
                  {r.type === 'source' && <input className={`${input} w-56`} placeholder="a page, form or import name" value={r.value ?? ''} onChange={(e) => setRule(i, { value: e.target.value })} />}
                  <button type="button" className="ml-auto text-xs text-[#c4592a] underline" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              );
            })}
            <button type="button" className="mt-2 rounded-sm border border-admin-ink/20 px-3 py-1 text-xs font-semibold hover:border-admin-ink/50" onClick={() => setRules([...rules, fresh('tag')])}>
              Add a rule
            </button>
            <datalist id="segment-tags">
              {tags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <datalist id="segment-fields">
              {fields.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            <p className="mt-3 text-xs text-admin-muted">
              {describeSegment(s.rules, names)}. A campaign or digest using this segment goes to the people on its lists who match. Tags and fields are set on each contact, and from an import's columns. Opens and clicks count people, not mail scanners.
            </p>
          </div>

          {usedBy.length > 0 && (
            <p className="mt-4 text-sm text-admin-muted">
              Used by{' '}
              {usedBy.map((u, i) => (
                <span key={`${u.kind}${u.id}`}>
                  {i ? ', ' : ''}
                  <a className="underline" href={`/admin/mailing-lists/${u.kind === 'campaign' ? 'campaigns' : 'digests'}/${u.id}/`}>
                    {u.name}
                  </a>
                </span>
              ))}
              . Changes apply to what hasn't gone out yet.
            </p>
          )}
          <button
            type="button"
            className="mt-4 text-xs text-[#c4592a] underline"
            onClick={async () => {
              if (!confirm('Delete this segment?')) return;
              try {
                await post({ action: 'delete', id: s.id });
                location.href = '/admin/mailing-lists/?tab=segments';
              } catch (e) {
                setStatus((e as Error).message);
              }
            }}
          >
            Delete segment
          </button>
        </div>

        <aside className="rounded bg-white p-4 shadow-[0_0_0_1px_rgba(26,26,46,0.08)]">
          <h2 className="mb-1 text-sm font-semibold">Who matches now</h2>
          <p className="mb-3 text-xs text-admin-muted">Subscribed people on any list. A campaign narrows it to its own lists.</p>
          {error && <p className="text-sm text-[#c4592a]">{error}</p>}
          {!people && !error && <p className="text-sm text-admin-muted">Counting…</p>}
          {people && (
            <>
              <p className="mb-2 text-2xl">
                {people.count} {people.count === 1 ? 'person' : 'people'}
              </p>
              <ul className="max-h-[28rem] overflow-y-auto text-sm">
                {people.people.map((p) => (
                  <li key={p.id} className="border-t border-admin-ink/5 py-1">
                    <a className="hover:text-admin-accent" href={`/admin/mailing-lists/contacts/${p.id}/`}>
                      {p.email}
                    </a>
                    {p.name && <span className="text-admin-muted"> · {p.name}</span>}
                  </li>
                ))}
              </ul>
              {people.count > people.people.length && <p className="mt-2 text-xs text-admin-muted">The first {people.people.length} shown.</p>}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
