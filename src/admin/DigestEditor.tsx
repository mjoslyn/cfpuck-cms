// A weekly digest: when it goes out (a weekday and time in the site's time zone), to whom, whether each
// issue waits for an admin's approval, when to skip a week with too little in it, and its email
// (Entries blocks for what was published since the last issue, Events blocks for what's coming up). Its
// issues are campaigns, listed under it. Saves with POST /api/admin/mailing/digests.
import { useMemo, useRef, useState } from 'react';
import EmailBuilder from '../forms/EmailBuilder';
import { mailingEmailKit } from './mailing-email';
import { CAMPAIGN_STATUS, WEEKDAYS, type Audience, type CampaignStatus, type Digest, type MailList } from '../lib/mailing/config';
import type { MemberLevel } from '../lib/members/config';
import type { EmailDoc } from '../lib/forms/email';

interface Issue {
  id: number;
  name: string;
  status: CampaignStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  recipients: number;
  error: string;
}

const input = 'w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent';
const label = 'mb-1.5 block text-sm font-medium text-[#3b3b3b]';
const primary = 'rounded-sm bg-admin-ink px-4 py-2 text-xs font-semibold tracking-wider text-white uppercase hover:bg-admin-accent disabled:opacity-50';
const secondary = 'rounded-sm border border-admin-ink/20 px-3 py-1.5 text-xs font-semibold hover:border-admin-ink/50 disabled:opacity-50';

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/mailing/digests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function DigestEditor({ digest, lists, levels, issues, admin, tz, lastSent, segments }: { digest: Digest; lists: MailList[]; levels: MemberLevel[] | null; issues: Issue[]; admin: boolean; tz: string; lastSent: string | null; segments: { id: number; name: string }[] }) {
  const [d, setD] = useState(digest);
  const [saved, setSaved] = useState(() => JSON.stringify(digest));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const latest = useRef(d);
  latest.current = d;
  const dirty = JSON.stringify(d) !== saved;
  const editable = admin || !digest.enabled;
  const set = (patch: Partial<Digest>) => setD((x) => ({ ...x, ...patch }));
  const audience = (d.audience ?? {}) as Audience;
  const since = lastSent ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const kit = useMemo(() => mailingEmailKit({ subject: () => latest.current.subject || latest.current.name, digest: true, since: () => since }), []);
  const run = async (fn: () => Promise<unknown>, done: string | ((r: any) => string), reload = false) => {
    setBusy(true);
    setStatus('Working…');
    try {
      const r = await fn();
      setStatus(typeof done === 'function' ? done(r) : done);
      if (reload) setTimeout(() => location.reload(), 800);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = (next = latest.current) =>
    run(async () => {
      await post({ action: 'save', id: d.id, digest: next });
      setSaved(JSON.stringify(next));
    }, `Saved ${new Date().toLocaleTimeString()}`);
  const when = (s?: string | null) => (s ? new Date(s).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) : '');

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-admin-muted">
            <a className="underline" href="/admin/mailing/?tab=digests">Mailing Lists › Weekly digests</a>
          </p>
          <h1 className="text-3xl font-normal">{d.name}</h1>
          <p className="mt-1 text-sm">
            {digest.enabled ? <strong>On</strong> : <strong>Off</strong>}: {WEEKDAYS[d.weekday]}s at {d.send_time} ({tz.replace(/_/g, ' ')}){d.mode === 'review' ? `, each issue waiting ${d.review_hours} hours for an admin's approval` : ', sent on its own'}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span role="status" className="text-xs text-admin-muted">{status || (dirty ? 'Unsaved changes' : '')}</span>
          {editable && (
            <button type="button" className={primary} disabled={busy || !dirty} onClick={() => save()}>
              Save
            </button>
          )}
        </div>
      </div>
      {!editable && <p className="mb-4 text-sm text-admin-muted">This digest is on: only admins change it.</p>}

      <fieldset disabled={!editable} className="grid gap-6 md:grid-cols-2">
        <div>
          <label className="mb-3 block">
            <span className={label}>Name</span>
            <input className={input} value={d.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="mb-3 block">
            <span className={label}>Subject</span>
            <input className={input} value={d.subject} placeholder="{site_name}: the week of {week_of}" onChange={(e) => set({ subject: e.target.value })} />
            <span className="mt-1 block text-xs text-admin-muted">{'{week_of}'} is the Monday of the issue's week.</span>
          </label>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>Goes out on</span>
              <select className={input} value={d.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((w, i) => (
                  <option key={w} value={i}>
                    {w}s
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>At</span>
              <input type="time" className={input} value={d.send_time} onChange={(e) => set({ send_time: e.target.value })} />
            </label>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>From name</span>
              <input className={input} value={d.from_name} placeholder="Settings > Mailing's" onChange={(e) => set({ from_name: e.target.value })} />
            </label>
            <label className="block">
              <span className={label}>Replies go to</span>
              <input className={input} value={d.reply_to} placeholder="Settings > Mailing's" onChange={(e) => set({ reply_to: e.target.value })} />
            </label>
          </div>
          <div className="mb-3 rounded bg-white p-3 shadow-[0_0_0_1px_rgba(26,26,46,0.08)]">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Email</span>
              <button type="button" className={secondary} onClick={() => setBuilding(true)}>
                {editable ? 'Edit the email' : 'See the email'}
              </button>
            </div>
            <p className="text-xs text-admin-muted">Entries blocks set to “only new” list what was published since the last issue went out; Events blocks list what's coming up. Both are filled in when each issue is made.</p>
          </div>
        </div>
        <div>
          <fieldset className="mb-3 border-0 p-0">
            <legend className={label}>To the lists</legend>
            {lists.map((l) => (
              <label key={l.id} className="mr-4 inline-flex items-center gap-1 text-sm">
                <input type="checkbox" checked={d.list_ids.includes(l.id)} onChange={(e) => set({ list_ids: e.target.checked ? [...d.list_ids, l.id] : d.list_ids.filter((x) => x !== l.id) })} />
                {l.name}
              </label>
            ))}
          </fieldset>
          <label className="mb-3 block">
              <span className={label}>Segment</span>
              <select className={input} value={d.segment_id ?? ''} onChange={(e) => set({ segment_id: Number(e.target.value) || null })}>
                <option value="">Everyone on those lists</option>
                {segments.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-admin-muted">
                Only the people on the lists who match it. <a className="underline" href={d.segment_id ? `/admin/mailing/segments/${d.segment_id}/` : '/admin/mailing/?tab=segments'}>{d.segment_id ? 'See who matches' : 'Segments'}</a>
              </span>
            </label>
          {levels && (
            <label className="mb-3 block">
              <span className={label}>Members</span>
              <select className={input} value={audience.members ?? 'any'} onChange={(e) => set({ audience: { ...audience, members: e.target.value as Audience['members'] } })}>
                <option value="any">Everyone on those lists</option>
                <option value="members">Only members</option>
                <option value="non-members">Only people who aren't members</option>
              </select>
            </label>
          )}
          <label className="mb-3 block">
            <span className={label}>Each issue</span>
            <select className={input} value={d.mode} onChange={(e) => set({ mode: e.target.value as Digest['mode'] })}>
              <option value="review">Waits for an admin's approval</option>
              <option value="auto">Goes out on its own</option>
            </select>
          </label>
          {d.mode === 'review' && (
            <label className="mb-3 block">
              <span className={label}>Hours it waits (made at its time, sent this much later if approved)</span>
              <input type="number" min={1} max={168} className={input} value={d.review_hours} onChange={(e) => set({ review_hours: Number(e.target.value) || 24 })} />
            </label>
          )}
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.skip_when_empty} onChange={(e) => set({ skip_when_empty: e.target.checked })} />
            Skip a week with fewer than
            <input type="number" min={1} max={50} className="w-16 rounded border border-admin-ink/15 px-2 py-1 text-sm" value={d.min_items} onChange={(e) => set({ min_items: Number(e.target.value) || 1 })} />
            entries and events
          </label>
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.track_links} onChange={(e) => set({ track_links: e.target.checked })} />
            Track links
          </label>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.utm} onChange={(e) => set({ utm: e.target.checked })} />
            Add UTM parameters to links to this site
          </label>
          {admin ? (
            <label className="mb-3 flex items-center gap-2 rounded bg-white p-3 text-sm font-medium shadow-[0_0_0_1px_rgba(26,26,46,0.08)]">
              <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
              On: make an issue every week
            </label>
          ) : (
            <p className="mb-3 text-xs text-admin-muted">An admin turns it on.</p>
          )}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={secondary} disabled={busy} onClick={() => run(async () => (dirty && editable ? await post({ action: 'save', id: d.id, digest: latest.current }).then(() => setSaved(JSON.stringify(latest.current))) : null, post({ action: 'test', id: d.id })), 'This week’s issue, as it would be now, sent to you.')}>
          Send me this week's issue
        </button>
        {admin && (
          <button type="button" className={secondary} disabled={busy || dirty} title={dirty ? 'Save first' : ''} onClick={() => confirm(d.mode === 'review' ? 'Make an issue now? It waits for approval like any other.' : 'Make an issue now and send it at once?') && run(() => post({ action: 'issue', id: d.id }), (r) => `Issue: ${r.result}`, true)}>
            Make an issue now
          </button>
        )}
        {admin && (
          <button type="button" className="ml-auto text-xs text-[#c4592a] underline" onClick={() => confirm('Delete this digest? Its issues stay as campaigns.') && run(async () => (await post({ action: 'delete', id: d.id }), (location.href = '/admin/mailing/?tab=digests')), 'Deleted.')}>
            Delete digest
          </button>
        )}
      </div>

      <h2 className="mt-8 mb-3 text-xl">Issues</h2>
      <table className="w-full border-collapse overflow-hidden rounded bg-white text-sm shadow-[0_0_0_1px_rgba(26,26,46,0.08)]">
        <thead className="bg-admin-soft text-left text-xs tracking-wider text-admin-muted uppercase">
          <tr>
            <th className="px-3 py-2 font-semibold">Issue</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Recipients</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.id} className="border-t border-admin-ink/5 align-top">
              <td className="px-3 py-2">
                <a className="hover:text-admin-accent" href={`/admin/mailing/campaigns/${i.id}/`}>
                  {i.name}
                </a>
              </td>
              <td className="px-3 py-2">
                {CAMPAIGN_STATUS[i.status] ?? i.status} <span className="text-xs text-admin-muted">{i.status === 'sent' ? when(i.sent_at) : when(i.scheduled_at)}</span>
                {i.error && ['skipped', 'cancelled', 'failed', 'paused'].includes(i.status) && <div className="text-xs text-admin-muted">{i.error}</div>}
              </td>
              <td className="px-3 py-2">{i.recipients || '–'}</td>
            </tr>
          ))}
          {!issues.length && (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-admin-muted">
                No issues yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {building && (
        <EmailBuilder
          title={`${d.name}: email`}
          kit={kit}
          design={(d.design ?? { root: { props: {} }, content: [] }) as EmailDoc}
          text={d.text}
          note={editable ? 'Saved with the digest (Save).' : 'Only admins change a digest that is on.'}
          onChange={(patch) => editable && set({ ...(patch.design ? { design: patch.design } : {}), ...('text' in patch ? { text: patch.text ?? '' } : {}) })}
          onClose={() => setBuilding(false)}
        />
      )}
    </div>
  );
}
