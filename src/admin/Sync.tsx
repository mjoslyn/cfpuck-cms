// Settings > Sync: copy content between this site and its other copy (SYNC_REMOTE_* in the env), either
// way. Pick what to sync, compare, look at the differences row by row, untick rows to leave alone, then
// sync after a warning that names the site being written to (and, by default, a backup on it; backups
// and snapshots are on the Backups tab, src/admin/Backups.tsx). Each site can protect itself from syncs.
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { GroupPlan, SyncConflict, SyncPlan } from '../lib/sync';

type Direction = 'push' | 'pull';
interface Group {
  id: string;
  label: string;
  kind: string;
}
interface Info {
  remote: string | null;
  groups: Group[];
  protected: { here: boolean; there: boolean | string | null };
}

export const post = async (body: unknown) => {
  const res = await fetch('/api/admin/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A site's name at the start of a sentence ("this site" → "This site"). */
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
const BATCH: Record<string, number> = { files: 4, type: 25 };

export default function Sync() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState<Direction>('push');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<SyncPlan | null>(null);
  const [left, setLeft] = useState<Set<string>>(new Set()); // "group|key" rows unticked
  const [busy, setBusy] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [keepBackup, setKeepBackup] = useState(true);
  const [report, setReport] = useState<{ written: number; skipped: (SyncConflict & { group: string })[]; backup: string | null } | null>(null);
  const [diffOf, setDiffOf] = useState<{ group: string; key: string; label: string } | null>(null);

  const load = () =>
    fetch('/api/admin/sync')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))))
      .then(setInfo, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  // A new choice invalidates the comparison.
  useEffect(() => {
    setResult(null);
    setReport(null);
    setUnderstood(false);
  }, [direction, chosen]);

  if (error && !info) return <p className="text-sm text-[#b3261e]">{error}</p>;
  if (!info) return <p className="text-sm text-admin-muted">Loading…</p>;

  const remote = info.remote;
  const source = direction === 'push' ? 'this site' : remote;
  const target = direction === 'push' ? remote : 'this site';
  const targetProtected = direction === 'push' ? info.protected.there === true : info.protected.here;

  const protect = async (value: boolean) => {
    if (!value && !window.confirm('Allow syncs to overwrite this site’s content?')) return;
    try {
      await post({ action: 'protect', value });
      setInfo({ ...info, protected: { ...info.protected, here: value } });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const compare = async () => {
    setBusy('Comparing…');
    setError('');
    setReport(null);
    try {
      setResult(await post({ action: 'plan', direction, groups: [...chosen] }));
      setLeft(new Set());
      setUnderstood(false);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy('');
  };

  const picked = (g: GroupPlan, kind: 'added' | 'changed') => g[kind].filter((i) => !left.has(`${g.id}|${i.key}`));
  const totals = result ? result.groups.reduce((t, g) => ({ added: t.added + picked(g, 'added').length, changed: t.changed + picked(g, 'changed').length }), { added: 0, changed: 0 }) : { added: 0, changed: 0 };

  const run = async () => {
    if (!result) return;
    const written = { n: 0 };
    const skipped: (SyncConflict & { group: string })[] = [];
    setError('');
    // Checks and the backup first: if the target can't take the sync or the backup can't be saved, nothing is written.
    let saved: { path: string | null; overwritten: number; added: number };
    try {
      setBusy(keepBackup ? `Saving a backup on ${result.target}…` : `Checking ${result.target}…`);
      saved = await post({ action: 'backup', direction, save: keepBackup, items: result.groups.map((g) => ({ group: g.id, added: picked(g, 'added').map((i) => i.key), changed: picked(g, 'changed').map((i) => i.key) })) });
    } catch (e) {
      setError(`Nothing was synced: ${(e as Error).message}`);
      setBusy('');
      return;
    }
    try {
      for (const g of result.groups) {
        const keys = [...picked(g, 'added'), ...picked(g, 'changed')].map((i) => i.key);
        const kind = info.groups.find((x) => x.id === g.id)?.kind ?? '';
        const size = BATCH[kind] ?? 50;
        for (let i = 0; i < keys.length; i += size) {
          setBusy(`${g.label}: ${Math.min(i + size, keys.length)} of ${keys.length}`);
          const r = await post({ action: 'apply', direction, groups: [...chosen], group: g.id, keys: keys.slice(i, i + size), backup: saved.path ?? undefined });
          written.n += r.written;
          skipped.push(...r.skipped.map((s: SyncConflict) => ({ ...s, group: g.label })));
        }
      }
    } catch (e) {
      setError(`Stopped: ${(e as Error).message}`);
    }
    setReport({ written: written.n, skipped, backup: saved.path });
    setResult(null);
    setUnderstood(false);
    setBusy('');
  };

  const toggle = (id: string, on: boolean) => setChosen((s) => (on ? new Set([...s, id]) : new Set([...s].filter((x) => x !== id))));
  const sections: [string, Group[]][] = [
    ['Content types', info.groups.filter((g) => g.kind === 'type')],
    ['Taxonomies', info.groups.filter((g) => g.kind === 'taxonomy')],
    ['Files and site', info.groups.filter((g) => g.kind !== 'type' && g.kind !== 'taxonomy')],
  ];

  return (
    <div className="max-w-5xl space-y-8">
      <section aria-labelledby="sync-here" className="rounded-sm border border-admin-ink/10 bg-white p-4">
        <h2 id="sync-here" className="mb-2 text-sm font-semibold tracking-wider text-admin-muted uppercase">
          This site
        </h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={info.protected.here} onChange={(e) => protect(e.target.checked)} />
          <span>
            Protect this site from syncs
            <span className="block text-xs text-admin-muted">A sync into this site, from here or from the other copy, is refused while this is on. Saved as you change it.</span>
          </span>
        </label>
      </section>

      {!remote ? (
        <section className="text-sm text-[#475569]">
          <p className="mb-2">No other copy is set up, so this site can't start a sync. To sync with another copy of the site (production and a local copy, say), set these on the copy you sync from and restart it:</p>
          <pre className="rounded-sm bg-[#f1f5f9] p-3 text-xs">{'SYNC_REMOTE_NAME=Production\nSYNC_REMOTE_URL=https://<its address>\nSYNC_SECRET=<the same long random value on both copies>'}</pre>
          <p className="mt-2 text-xs text-admin-muted">The other copy needs the same SYNC_SECRET (at least 32 characters) to answer, and syncing files needs its store as SYNC_REMOTE_STORAGE_*. It can still protect itself here.</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="sync-direction">
            <h2 id="sync-direction" className="mb-2 text-sm font-semibold tracking-wider text-admin-muted uppercase">
              Direction
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['push', 'pull'] as Direction[]).map((d) => {
                const prot = d === 'push' ? info.protected.there : info.protected.here;
                return (
                  <label key={d} className={`flex cursor-pointer items-start gap-2 rounded-sm border p-3 text-sm ${direction === d ? 'border-admin-accent bg-admin-accent/5' : 'border-admin-ink/15 bg-white'}`}>
                    <input type="radio" name="sync-direction" className="mt-1" checked={direction === d} onChange={() => setDirection(d)} />
                    <span>
                      <strong className="font-semibold">{d === 'push' ? `This site → ${remote}` : `${remote} → this site`}</strong>
                      <span className="block text-xs text-admin-muted">
                        {d === 'push' ? `Writes to ${remote}.` : 'Writes to this site.'} {prot === true ? 'That site is protected: syncs are refused.' : typeof prot === 'string' ? `Couldn't check ${remote}: ${prot}` : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="sync-what">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id="sync-what" className="text-sm font-semibold tracking-wider text-admin-muted uppercase">
                What to sync
              </h2>
              <span className="text-xs">
                <button type="button" className="mr-3 text-admin-accent hover:underline" onClick={() => setChosen(new Set(info.groups.map((g) => g.id)))}>
                  All
                </button>
                <button type="button" className="text-admin-accent hover:underline" onClick={() => setChosen(new Set())}>
                  None
                </button>
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {sections.map(([title, groups]) => (
                <fieldset key={title} className="rounded-sm border border-admin-ink/10 bg-white p-3">
                  <legend className="px-1 text-xs font-medium text-admin-muted">{title}</legend>
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 py-0.5 text-sm">
                      <input type="checkbox" checked={chosen.has(g.id)} onChange={(e) => toggle(g.id, e.target.checked)} />
                      {g.label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <p className="mt-2 text-xs text-admin-muted">Entries, terms, files and forms keep their ids on both sites; templates match by name, redirects by old address. A sync never deletes anything.</p>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={!chosen.size || !!busy} onClick={compare} className="rounded-sm bg-admin-ink px-4 py-2 text-xs font-semibold tracking-wider text-white uppercase hover:bg-admin-accent disabled:opacity-40">
              Compare
            </button>
            <p className="text-xs text-admin-muted" role="status">
              {busy}
            </p>
          </div>
          {error && <p className="text-sm text-[#b3261e]">{error}</p>}

          {report && (
            <section className="rounded-sm border border-admin-ink/10 bg-white p-4 text-sm" aria-live="polite">
              <p className="font-medium">Synced {plural(report.written, 'row')} to {target}.</p>
              <p className="mt-1 text-xs text-admin-muted">
                {report.backup ? (
                  <>
                    Backup of what it overwrote, saved on {target} first:{' '}
                    <a className="text-admin-accent hover:underline" href={`/api/admin/sync?backups=${direction === 'push' ? 'remote' : 'here'}&file=${encodeURIComponent(report.backup)}`}>
                      {report.backup}
                    </a>
                  </>
                ) : (
                  'No backup was saved.'
                )}
              </p>
              {report.skipped.length > 0 && (
                <>
                  <p className="mt-2 text-[#b3261e]">{plural(report.skipped.length, 'problem')}:</p>
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {report.skipped.map((s, i) => (
                      <li key={i}>
                        {s.group}: {s.label} {s.label && '—'} {s.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-2 text-xs text-admin-muted">Pages on the site's CDN may show the old content for up to a minute. Backups can be restored from the Backups tab.</p>
            </section>
          )}

          {result && (
            <section aria-labelledby="sync-result" className="space-y-3">
              <h2 id="sync-result" className="text-sm font-semibold tracking-wider text-admin-muted uppercase">
                {result.source} → {result.target}
              </h2>
              {result.groups.map((g) => (
                <GroupResult key={g.id} g={g} left={left} setLeft={setLeft} onDiff={(key, label) => setDiffOf({ group: g.id, key, label })} />
              ))}

              {targetProtected || result.protected ? (
                <p className="rounded-sm border border-[#b3261e]/40 bg-[#b3261e]/5 p-3 text-sm text-[#b3261e]">{cap(result.target)} is protected from syncs. Turn its protection off on its own Sync tab under Settings to sync into it.</p>
              ) : totals.added + totals.changed === 0 ? (
                <p className="text-sm text-admin-muted">Nothing to sync.</p>
              ) : (
                <div className="rounded-sm border-2 border-[#b3261e]/50 bg-[#fff7f5] p-4 text-sm">
                  <p className="font-semibold text-[#b3261e]">This writes to {result.target}.</p>
                  <ul className="mt-2 list-disc pl-5">
                    {totals.changed > 0 && (
                      <li>
                        <strong>{plural(totals.changed, 'row')} on {result.target} will be overwritten</strong> with {result.source}'s version. Changes made there to those rows are lost{keepBackup ? ', apart from the backup' : ', and can’t be got back from here'}.
                      </li>
                    )}
                    {totals.added > 0 && <li>{plural(totals.added, 'row')} will be added.</li>}
                    <li>Nothing is deleted. Rows with conflicts are left alone.</li>
                  </ul>
                  <label className="mt-3 flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={keepBackup} onChange={(e) => setKeepBackup(e.target.checked)} />
                    <span>
                      Save a backup on {result.target} first
                      <span className="block text-xs text-admin-muted">The rows it overwrites, as they are now, and a list of the rows it adds; if it can't be saved, nothing is synced. Stored images are not backed up, only files' library rows.</span>
                    </span>
                  </label>
                  {!keepBackup && totals.changed > 0 && <p className="mt-1 text-xs text-[#b3261e]">Without a backup, the {plural(totals.changed, 'row')} it overwrites can't be got back.</p>}
                  <label className="mt-3 flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
                    <span>I understand that {result.target}'s content will be changed{totals.changed ? ' and overwritten' : ''}.</span>
                  </label>
                  <button type="button" disabled={!understood || !!busy} onClick={run} className="mt-3 rounded-sm bg-[#b3261e] px-4 py-2 text-xs font-semibold tracking-wider text-white uppercase hover:bg-[#8c1d17] disabled:opacity-40">
                    Sync {plural(totals.added + totals.changed, 'row')} to {result.target}
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {diffOf && <DiffDialog direction={direction} group={diffOf.group} rowKey={diffOf.key} label={diffOf.label} onClose={() => setDiffOf(null)} />}
    </div>
  );
}

function GroupResult({ g, left, setLeft, onDiff }: { g: GroupPlan; left: Set<string>; setLeft: (f: (s: Set<string>) => Set<string>) => void; onDiff: (key: string, label: string) => void }) {
  const counts = [g.added.length && `${g.added.length} new`, g.changed.length && `${g.changed.length} changed`, g.same && `${g.same} the same`, g.conflicts.length && `${g.conflicts.length} with conflicts`].filter(Boolean).join(', ') || 'nothing there';
  const flip = (key: string, on: boolean) =>
    setLeft((s) => {
      const n = new Set(s);
      if (on) n.delete(`${g.id}|${key}`);
      else n.add(`${g.id}|${key}`);
      return n;
    });
  const list = (title: string, items: { key: string; label: string }[], tone: string) =>
    items.length > 0 && (
      <div className="mt-2">
        <p className={`text-xs font-medium ${tone}`}>{title}</p>
        <ul className="mt-1 max-h-72 overflow-y-auto text-xs">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-2 border-t border-admin-ink/5 py-1">
              <input type="checkbox" aria-label={`Sync ${i.label}`} checked={!left.has(`${g.id}|${i.key}`)} onChange={(e) => flip(i.key, e.target.checked)} />
              <span className="min-w-0 flex-1 truncate">{i.label}</span>
              <button type="button" className="shrink-0 text-admin-accent hover:underline" onClick={() => onDiff(i.key, i.label)}>
                Show differences
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <details className="rounded-sm border border-admin-ink/10 bg-white p-3" open={g.changed.length + g.conflicts.length > 0 && g.changed.length + g.added.length + g.conflicts.length <= 30}>
      <summary className="cursor-pointer text-sm">
        <span className="font-medium">{g.label}</span> <span className="text-xs text-admin-muted">{counts}</span>
      </summary>
      {g.warnings.map((w) => (
        <p key={w} className="mt-2 text-xs text-[#9a5b00]">
          {w}
        </p>
      ))}
      {list('Changed (will be overwritten)', g.changed, 'text-[#b3261e]')}
      {list('New', g.added, 'text-[#166534]')}
      {g.conflicts.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-[#9a5b00]">Conflicts (left alone)</p>
          <ul className="mt-1 max-h-48 overflow-y-auto text-xs">
            {g.conflicts.map((c) => (
              <li key={c.key} className="border-t border-admin-ink/5 py-1">
                {c.label}: <span className="text-admin-muted">{c.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

// ---- diff -----------------------------------------------------------------------------------------

type Line = { op: ' ' | '-' | '+'; text: string };

/** A line diff (longest common subsequence); past ~4M cells it shows both sides whole instead. */
function lineDiff(a: string[], b: string[]): Line[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--;
  const head: Line[] = a.slice(0, start).map((text) => ({ op: ' ', text }));
  const tail: Line[] = a.slice(endA).map((text) => ({ op: ' ', text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (x.length * y.length > 4_000_000) return [...head, ...x.map((text) => ({ op: '-' as const, text })), ...y.map((text) => ({ op: '+' as const, text })), ...tail];
  const w = y.length + 1;
  const dp = new Uint32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i * w + j] = x[i] === y[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const mid: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) mid.push({ op: ' ', text: x[i++] }), j++;
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) mid.push({ op: '-', text: x[i++] });
    else mid.push({ op: '+', text: y[j++] });
  }
  while (i < x.length) mid.push({ op: '-', text: x[i++] });
  while (j < y.length) mid.push({ op: '+', text: y[j++] });
  return [...head, ...mid, ...tail];
}

/** Changed lines with 3 lines of context; longer unchanged runs fold into a count you can open. */
function Hunks({ lines }: { lines: Line[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const keep = lines.map((_, n) => lines.slice(Math.max(0, n - 3), n + 4).some((l) => l.op !== ' '));
  const out: ReactElement[] = [];
  for (let n = 0; n < lines.length; ) {
    if (keep[n] || open.has(n)) {
      const l = lines[n];
      out.push(
        <div key={n} className={l.op === '-' ? 'bg-[#fdecea] text-[#8c1d17]' : l.op === '+' ? 'bg-[#e8f5e9] text-[#14532d]' : 'text-[#475569]'}>
          <span className="inline-block w-5 text-center select-none">{l.op === ' ' ? '' : l.op === '-' ? '−' : '+'}</span>
          {l.text}
        </div>,
      );
      n++;
      continue;
    }
    let end = n;
    while (end < lines.length && !keep[end]) end++;
    const from = n;
    out.push(
      <button key={`fold-${n}`} type="button" className="my-0.5 block w-full bg-[#f1f5f9] py-0.5 text-center text-admin-muted hover:text-admin-ink" onClick={() => setOpen((s) => new Set([...s, ...Array.from({ length: end - from }, (_, k) => from + k)]))}>
        {end - n} unchanged {end - n === 1 ? 'line' : 'lines'}
      </button>,
    );
    n = end;
  }
  return <>{out}</>;
}

function DiffDialog({ direction, group, rowKey, label, onClose }: { direction: Direction; group: string; rowKey: string; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<{ source: string; target: string; sourceName: string; targetName: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    ref.current?.showModal();
    post({ action: 'diff', direction, group, key: rowKey }).then(setData, (e) => setError(e.message));
  }, []);
  const lines = useMemo(() => (data ? lineDiff(data.target ? data.target.split('\n') : [], data.source ? data.source.split('\n') : []) : []), [data]);
  const changes = lines.filter((l) => l.op !== ' ').length;
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="sync-diff-title" className="m-auto max-h-[90vh] w-[min(64rem,95vw)] rounded-sm p-0 shadow-xl backdrop:bg-black/40">
      <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-admin-ink/10 bg-white p-4">
        <div className="min-w-0">
          <h2 id="sync-diff-title" className="truncate text-base font-semibold">
            {label}
          </h2>
          {data && (
            <p className="mt-1 text-xs">
              <span className="mr-3 bg-[#fdecea] px-1 text-[#8c1d17]">− {cap(data.targetName)} now</span>
              <span className="bg-[#e8f5e9] px-1 text-[#14532d]">+ {cap(data.sourceName)} (what the sync writes)</span>
              <span className="ml-3 text-admin-muted">{!data.target ? 'Not there yet: all of it is new.' : changes ? `${changes} changed ${changes === 1 ? 'line' : 'lines'}` : 'No differences.'}</span>
            </p>
          )}
        </div>
        <button type="button" onClick={() => ref.current?.close()} className="shrink-0 rounded-sm border border-admin-ink/20 px-3 py-1 text-xs">
          Close
        </button>
      </div>
      <div className="overflow-x-auto p-4 font-mono text-xs leading-5 whitespace-pre">{error ? <p className="font-sans text-[#b3261e]">{error}</p> : data ? <Hunks lines={lines} /> : <p className="font-sans text-admin-muted">Loading…</p>}</div>
    </dialog>
  );
}
