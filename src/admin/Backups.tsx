// Settings > Backups: each copy's backups and snapshots (this site always; the other copy when
// SYNC_REMOTE_URL and SYNC_SECRET are set): what it keeps, its snapshot schedule, Back up now, and each backup to download,
// restore or delete. Sync backups are made by Settings > Sync before a sync writes. Backups hold rows,
// not stored images.
import { useEffect, useState } from 'react';
import { plural, post } from './Sync';

export default function BackupsTab() {
  const [remote, setRemote] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/admin/sync')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))))
      .then((d: { remote: string | null }) => setRemote(d.remote), (e) => setError(e.message));
  }, []);
  if (error) return <p className="text-sm text-[#b3261e]">{error}</p>;
  if (remote === undefined) return <p className="text-sm text-admin-muted">Loading…</p>;
  return (
    <div className="max-w-5xl space-y-3">
      <p className="text-sm text-[#475569]">Snapshots of each site's content, and the backups a sync saves before writing. Open a site to see and manage its backups.</p>
      <Backups site="here" name="this site" />
      {remote && <Backups site="remote" name={remote} />}
    </div>
  );
}

interface BackupRow {
  path: string;
  created_at: string;
  size: number;
  snapshot: boolean;
}
interface Schedule {
  enabled: boolean;
  every: 'daily' | 'weekly';
  keep: number;
}
const IMAGES_NOTE = 'Backups hold the site’s content as database rows. Stored images (the files of the media library) are not backed up: a restore brings back a file’s library row, not its image.';

/** One copy's backups and snapshots: what it keeps, its snapshot schedule, Back up now, and download, restore or delete each. */
function Backups({ site, name }: { site: 'here' | 'remote'; name: string }) {
  const [list, setList] = useState<BackupRow[] | null>(null);
  const [saved, setSaved] = useState<{ keep: number; schedule: Schedule } | null>(null);
  const [keep, setKeep] = useState('');
  const [schedule, setSchedule] = useState<Schedule>({ enabled: false, every: 'daily', keep: 14 });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [restoring, setRestoring] = useState<{ path: string; preview: { table: string; restore: number; since: number }[] | null; deleteSince: boolean } | null>(null);
  const load = () =>
    fetch(`/api/admin/sync?backups=${site}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))))
      .then(
        (d: { list: BackupRow[]; keep: number; schedule: Schedule }) => {
          setList(d.list);
          setSaved({ keep: d.keep, schedule: d.schedule });
          setKeep(String(d.keep));
          setSchedule(d.schedule);
        },
        (e) => setError(e.message),
      );
  const dirty = saved && (keep !== String(saved.keep) || JSON.stringify(schedule) !== JSON.stringify(saved.schedule));
  const href = (path: string) => `/api/admin/sync?backups=${site}&file=${encodeURIComponent(path)}`;

  const saveRetention = async () => {
    const n = Number(keep);
    if (!Number.isInteger(n) || n < 0 || !Number.isInteger(schedule.keep) || schedule.keep < 0) return setStatus('Enter whole numbers: 0 keeps all.');
    const goes = list ? (n ? Math.max(0, list.filter((b) => !b.snapshot).length - n) : 0) + (schedule.keep ? Math.max(0, list.filter((b) => b.snapshot).length - schedule.keep) : 0) : 0;
    if (goes && !window.confirm(`${plural(goes, 'older backup')} on ${name} will be deleted now. Go on?`)) return;
    try {
      const r = await post({ action: 'retention', site, keep: n, schedule });
      setSaved({ keep: r.keep, schedule: r.schedule });
      const gone = new Set<string>(r.deleted);
      setList((l) => (l ?? []).filter((b) => !gone.has(b.path)));
      setStatus(r.deleted.length ? `Saved; deleted ${plural(r.deleted.length, 'older backup')}.` : 'Saved.');
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  const backUpNow = async () => {
    setBusy('snapshot');
    setStatus(`Taking a snapshot of ${name}…`);
    try {
      const r = await post({ action: 'snapshot', site });
      setStatus(`Saved ${r.path} (${plural(r.rows, 'row')}; stored images aren't included).`);
      await load();
    } catch (e) {
      setStatus(`Not saved: ${(e as Error).message}`);
    }
    setBusy('');
  };
  const remove = async (path: string) => {
    if (!window.confirm(`Delete ${path} on ${name}? It can't be got back.`)) return;
    try {
      await post({ action: 'deleteBackup', site, path });
      setList((l) => (l ?? []).filter((b) => b.path !== path));
      setStatus(`Deleted ${path}.`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  const startRestore = async (b: BackupRow) => {
    if (!b.snapshot) {
      if (
        !window.confirm(
          `Restore ${b.path} on ${name}?\n\nThe rows that sync overwrote go back to how they were, and the rows it added are deleted (for files, their library rows). Changes made to those rows since are lost. Stored images aren't in backups and stay as they are.\n\nA backup of ${name}'s current state is saved first.`,
        )
      )
        return;
      return runRestore(b.path, false);
    }
    setRestoring({ path: b.path, preview: null, deleteSince: false });
    try {
      const r = await fetch(`/api/admin/sync?backups=${site}&preview=${encodeURIComponent(b.path)}`);
      if (!r.ok) throw new Error(await r.text());
      const p = await r.json();
      setRestoring({ path: b.path, preview: p.tables, deleteSince: false });
    } catch (e) {
      setRestoring(null);
      setStatus((e as Error).message);
    }
  };
  const runRestore = async (path: string, deleteSince: boolean) => {
    setBusy(path);
    setStatus(`Restoring ${path}…`);
    try {
      const { job } = await post({ action: 'restoreBackup', site, path, deleteSince });
      // The restore runs as a job (it can take minutes); ask until it reports.
      let state: { status: string; result?: any; error?: string } = { status: 'queued' };
      for (let i = 0; i < 480 && (state.status === 'queued' || state.status === 'running'); i++) {
        if (i) await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch(`/api/admin/sync?restoreJob=${job}`);
        if (res.ok) state = await res.json();
      }
      if (state.status !== 'done') throw new Error(state.error ?? 'it is still running after 16 minutes. Reload this page later to see whether a before-restore backup was saved.');
      const r = state.result;
      setStatus(`Restored ${plural(r.restored, 'row')}${r.removed ? ` and deleted ${plural(r.removed, 'row')}` : ''}. The state before the restore is in ${r.backup}.${r.problems.length ? ` Problems: ${r.problems.join('; ')}` : ''}`);
      setRestoring(null);
      await load();
    } catch (e) {
      setStatus(`Not restored: ${(e as Error).message}`);
    }
    setBusy('');
  };
  const since = restoring?.preview?.reduce((n, t) => n + t.since, 0) ?? 0;

  return (
    <details className="rounded-sm border border-admin-ink/10 bg-white p-3" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && !list && load()}>
      <summary className="cursor-pointer text-sm font-medium">Backups on {name}</summary>
      <p className="mt-2 rounded-sm bg-[#fff8eb] p-2 text-xs text-[#7a4a00]">{IMAGES_NOTE}</p>
      {error ? (
        <p className="mt-2 text-xs text-[#b3261e]">{error}</p>
      ) : !list ? (
        <p className="mt-2 text-xs text-admin-muted">Loading…</p>
      ) : (
        <>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <fieldset className="rounded-sm border border-admin-ink/10 p-2">
              <legend className="px-1 text-admin-muted">Snapshots</legend>
              <p className="mb-2 text-admin-muted">Everything a sync covers, as it is: entries, terms, library rows, templates, forms, settings, redirects.</p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} />
                Take one
                <select value={schedule.every} onChange={(e) => setSchedule({ ...schedule, every: e.target.value as Schedule['every'] })} className="rounded-sm border border-admin-ink/20 px-1 py-0.5">
                  <option value="daily">every day</option>
                  <option value="weekly">every week</option>
                </select>
              </label>
              <label className="mt-2 flex items-center gap-2">
                Keep the last
                <input type="number" min={0} max={1000} value={schedule.keep} onChange={(e) => setSchedule({ ...schedule, keep: Number(e.target.value) })} className="w-16 rounded-sm border border-admin-ink/20 px-1 py-0.5" />
                snapshots (0: all)
              </label>
              <p className="mt-2 text-admin-muted">Scheduled snapshots run on the deployed site, at 07:00 UTC (not under astro dev).</p>
              <button type="button" disabled={!!busy} onClick={backUpNow} className="mt-2 rounded-sm bg-admin-ink px-3 py-1 font-semibold tracking-wider text-white uppercase hover:bg-admin-accent disabled:opacity-40">
                {busy === 'snapshot' ? 'Backing up…' : 'Back up now'}
              </button>
            </fieldset>
            <fieldset className="rounded-sm border border-admin-ink/10 p-2">
              <legend className="px-1 text-admin-muted">Sync backups</legend>
              <p className="mb-2 text-admin-muted">Saved before each sync or restore into {name}: the rows it overwrote, as they were, and the rows it added.</p>
              <label className="flex items-center gap-2">
                Keep the last
                <input aria-label="Keep the last sync backups" type="number" min={0} max={1000} value={keep} onChange={(e) => setKeep(e.target.value)} className="w-16 rounded-sm border border-admin-ink/20 px-1 py-0.5" />
                sync backups (0: all)
              </label>
            </fieldset>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" disabled={!dirty} onClick={saveRetention} className="rounded-sm border border-admin-ink/20 px-3 py-1 text-xs disabled:opacity-40">
              Save
            </button>
            {status && (
              <p className="text-xs text-admin-muted" role="status">
                {status}
              </p>
            )}
          </div>

          {!list.length ? (
            <p className="mt-3 text-xs text-admin-muted">None yet.</p>
          ) : (
            <ul className="mt-3 list-none pl-0 text-xs">
              {list.map((b) => (
                <li key={b.path} className="border-t border-admin-ink/5 py-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`shrink-0 rounded-sm px-1 ${b.snapshot ? 'bg-[#e0f2fe] text-[#075985]' : 'bg-[#f1f5f9] text-[#475569]'}`}>{b.snapshot ? 'Snapshot' : 'Sync backup'}</span>
                      <a className="truncate text-admin-accent hover:underline" href={href(b.path)}>
                        {b.path}
                      </a>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-admin-muted">
                      {b.size ? `${Math.max(1, Math.round(b.size / 1024))} KB` : ''}
                      <button type="button" disabled={!!busy} className="text-admin-accent disabled:opacity-40" onClick={() => startRestore(b)}>
                        {busy === b.path ? 'Restoring…' : 'Restore'}
                      </button>
                      <button type="button" disabled={!!busy} className="text-[#b3261e] disabled:opacity-40" onClick={() => remove(b.path)}>
                        Delete
                      </button>
                    </span>
                  </div>
                  {restoring?.path === b.path && (
                    <div className="mt-2 rounded-sm border-2 border-[#b3261e]/50 bg-[#fff7f5] p-3">
                      <p className="font-semibold text-[#b3261e]">Restore this snapshot on {name}?</p>
                      {!restoring.preview ? (
                        <p className="mt-1 text-admin-muted">Comparing…</p>
                      ) : (
                        <>
                          <p className="mt-1">Every row it holds is written back as it was then; changes made to them since are lost.</p>
                          <table className="mt-2">
                            <thead>
                              <tr className="text-left text-admin-muted">
                                <th className="pr-4 font-medium">Table</th>
                                <th className="pr-4 font-medium">Put back</th>
                                <th className="font-medium">Made since</th>
                              </tr>
                            </thead>
                            <tbody>
                              {restoring.preview.map((t) => (
                                <tr key={t.table}>
                                  <td className="pr-4">{t.table}</td>
                                  <td className="pr-4">{t.restore}</td>
                                  <td>{t.since}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <label className="mt-2 flex items-start gap-2">
                            <input type="checkbox" className="mt-0.5" disabled={!since} checked={restoring.deleteSince} onChange={(e) => setRestoring({ ...restoring, deleteSince: e.target.checked })} />
                            <span>
                              Also delete the {plural(since, 'row')} made since the snapshot
                              <span className="block text-admin-muted">Otherwise they stay. Files lose their library rows; their stored images stay.</span>
                            </span>
                          </label>
                          <p className="mt-2 text-admin-muted">A snapshot of {name}'s current state is taken first, so this can be undone. Stored images aren't in snapshots: they stay as they are.</p>
                          <div className="mt-2 flex gap-2">
                            <button type="button" disabled={!!busy} onClick={() => runRestore(b.path, restoring.deleteSince)} className="rounded-sm bg-[#b3261e] px-3 py-1 font-semibold tracking-wider text-white uppercase hover:bg-[#8c1d17] disabled:opacity-40">
                              Restore{restoring.deleteSince ? ` and delete ${since}` : ''}
                            </button>
                            <button type="button" onClick={() => setRestoring(null)} className="rounded-sm border border-admin-ink/20 px-3 py-1">
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </details>
  );
}
