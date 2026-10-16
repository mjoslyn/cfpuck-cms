// A campaign (or a digest's issue): its settings, its email (designed in the email builder), a test send,
// and, for admins, scheduling, sending, pausing and approving. Once it has gone out: its numbers, and each
// link's clicks told apart into people's and machines' (src/lib/mailing/clicks.ts). Saves with
// POST /api/admin/mailing/campaigns.
import { useEffect, useMemo, useRef, useState } from 'react';
import EmailBuilder from '../forms/EmailBuilder';
import { mailingEmailKit } from './mailing-email';
import { CAMPAIGN_STATUS, rate, type Audience, type Campaign, type CampaignStats, type MailList } from '../lib/mailing/config';
import type { MemberLevel } from '../lib/members/config';
import type { EmailDoc } from '../lib/forms/email';

export interface LinkRow {
  id: number;
  url: string;
  label: string;
  kind: string;
  human: number;
  humanUnique: number;
  likely: number;
  likelyUnique: number;
  machine: number;
}

interface Props {
  campaign: Campaign;
  lists: MailList[];
  /** Member levels, when Members is on. */
  levels: MemberLevel[] | null;
  stats: CampaignStats | null;
  links: LinkRow[];
  admin: boolean;
  mailgun: boolean;
  tz: string;
  /** The digest this is an issue of. */
  digest?: { id: number; name: string } | null;
  /** Sending is paused site-wide (why). */
  paused: string;
}

const input = 'w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent';
const label = 'mb-1.5 block text-sm font-medium text-[#3b3b3b]';
const primary = 'rounded-sm bg-admin-ink px-4 py-2 text-xs font-semibold tracking-wider text-white uppercase hover:bg-admin-accent disabled:opacity-50';
const secondary = 'rounded-sm border border-admin-ink/20 px-3 py-1.5 text-xs font-semibold hover:border-admin-ink/50 disabled:opacity-50';

const EDITABLE = ['draft', 'review', 'scheduled', 'paused', 'failed'];

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/mailing/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** "Y-m-dTH:i" now in a time zone, for the schedule picker's starting value. */
function localNow(tz: string, plusHours = 1): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(Date.now() + plusHours * 3_600_000)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

export default function CampaignEditor({ campaign, lists, levels, stats, links, admin, mailgun, tz, digest, paused }: Props) {
  const [c, setC] = useState(campaign);
  const [saved, setSaved] = useState(() => JSON.stringify(campaign));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [at, setAt] = useState(() => localNow(tz));
  const [confirming, setConfirming] = useState<null | { action: 'send' | 'schedule' | 'approve'; count: number | null; ticked: boolean }>(null);
  const [showMachine, setShowMachine] = useState(false);
  const latest = useRef(c);
  latest.current = c;
  const dirty = JSON.stringify(c) !== saved;
  const editable = EDITABLE.includes(c.status) && (admin || c.status === 'draft');
  const set = (patch: Partial<Campaign>) => setC((x) => ({ ...x, ...patch }));
  const audience = (c.audience ?? {}) as Audience;
  const kit = useMemo(() => mailingEmailKit({ id: c.id, subject: () => latest.current.subject, digest: !!c.digest_id, since: () => latest.current.since ?? undefined }), [c.id]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  // While it sends, the numbers refresh.
  useEffect(() => {
    if (c.status !== 'sending' || dirty) return;
    const t = setTimeout(() => location.reload(), 15_000);
    return () => clearTimeout(t);
  }, [c.status, dirty]);

  const run = async (fn: () => Promise<unknown>, done: string, reload = false) => {
    setBusy(true);
    setStatus('Working…');
    try {
      await fn();
      setStatus(done);
      if (reload) location.reload();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      await post({ action: 'save', id: c.id, campaign: latest.current });
      setSaved(JSON.stringify(latest.current));
    }, `Saved ${new Date().toLocaleTimeString()}`);
  const saveFirst = async () => {
    if (dirty && editable) {
      await post({ action: 'save', id: c.id, campaign: latest.current });
      setSaved(JSON.stringify(latest.current));
    }
  };
  const ask = async (action: 'send' | 'schedule' | 'approve') => {
    setConfirming({ action, count: null, ticked: false });
    try {
      await saveFirst();
      const { count } = await post({ action: 'count', id: c.id });
      setConfirming({ action, count, ticked: false });
    } catch (e) {
      setConfirming(null);
      setStatus((e as Error).message);
    }
  };
  const when = (s?: string | null) => (s ? new Date(s).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) : '');
  const listNames = c.list_ids.map((id) => lists.find((l) => l.id === id)?.name ?? `List ${id}`).join(', ');

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-admin-muted">
            <a className="underline" href="/admin/mailing/">Mailing</a> › {digest ? <a className="underline" href={`/admin/mailing/digests/${digest.id}/`}>{digest.name}</a> : 'Campaigns'}
          </p>
          <h1 className="text-3xl font-normal">{c.name || 'Untitled campaign'}</h1>
          <p className="mt-1 text-sm">
            <strong>{CAMPAIGN_STATUS[c.status]}</strong>
            {c.status === 'scheduled' && c.scheduled_at && <> for {when(c.scheduled_at)}</>}
            {c.status === 'review' && c.scheduled_at && <>: goes out {when(c.scheduled_at)} if approved before then</>}
            {c.status === 'sent' && c.sent_at && <> {when(c.sent_at)}</>}
            {c.error && ['failed', 'paused', 'skipped', 'cancelled'].includes(c.status) && <span className="text-admin-muted"> · {c.error}</span>}
          </p>
          {paused && ['scheduled', 'sending', 'review'].includes(c.status) && <p className="mt-1 text-sm text-[#c4592a]">Sending is paused site-wide: {paused}</p>}
          {!mailgun && <p className="mt-1 text-xs text-admin-muted">Mailgun isn't set up: nothing goes out (locally, emails go to the mail catcher).</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="text-xs text-admin-muted">{status || (dirty ? 'Unsaved changes' : '')}</span>
          {editable && (
            <button type="button" className={primary} disabled={busy || !dirty} onClick={save}>
              Save
            </button>
          )}
        </div>
      </div>

      {editable ? (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label className="mb-3 block">
              <span className={label}>Name (for you)</span>
              <input className={input} value={c.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className="mb-3 block">
              <span className={label}>Subject</span>
              <input className={input} value={c.subject} placeholder="What's new this month" onChange={(e) => set({ subject: e.target.value })} />
              <span className="mt-1 block text-xs text-admin-muted">Tags work here too: {'{first_name|there}'}, {'{site_name}'}.</span>
            </label>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className={label}>From name</span>
                <input className={input} value={c.from_name} placeholder="Settings > Mailing's" onChange={(e) => set({ from_name: e.target.value })} />
              </label>
              <label className="block">
                <span className={label}>Replies go to</span>
                <input className={input} value={c.reply_to} placeholder="Settings > Mailing's" onChange={(e) => set({ reply_to: e.target.value })} />
              </label>
            </div>
            <div className="mb-3 rounded bg-white p-3 shadow-[0_0_0_1px_rgba(26,26,46,0.08)]">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">Email</span>
                <button type="button" className={secondary} onClick={() => setBuilding(true)}>
                  Edit the email
                </button>
              </div>
              <p className="text-xs text-admin-muted">
                {(c.design?.content ?? []).length} block{(c.design?.content ?? []).length === 1 ? '' : 's'}{c.text ? ', with its own plain text' : ''}. Every email ends with the sender, the postal address and unsubscribe and preferences links, added when it is sent.
              </p>
            </div>
          </div>
          <div>
            <fieldset className="mb-3 border-0 p-0">
              <legend className={label}>To the lists</legend>
              {lists.map((l) => (
                <label key={l.id} className="mr-4 inline-flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={c.list_ids.includes(l.id)} onChange={(e) => set({ list_ids: e.target.checked ? [...c.list_ids, l.id] : c.list_ids.filter((x) => x !== l.id) })} />
                  {l.name}
                </label>
              ))}
              {!lists.length && (
                <p className="text-xs text-admin-muted">
                  No lists yet: <a className="underline" href="/admin/mailing/?tab=lists">add one</a>.
                </p>
              )}
            </fieldset>
            {levels && (
              <fieldset className="mb-3 border-0 p-0">
                <legend className={label}>Members</legend>
                <select className={input} value={audience.members ?? 'any'} onChange={(e) => set({ audience: { ...audience, members: e.target.value as Audience['members'] } })}>
                  <option value="any">Everyone on those lists</option>
                  <option value="members">Only members</option>
                  <option value="non-members">Only people who aren't members</option>
                </select>
                {audience.members === 'members' && levels.length > 0 && (
                  <div className="mt-2">
                    <span className="text-xs text-admin-muted">Of the levels (none ticked: any): </span>
                    {levels.map((l) => (
                      <label key={l.id} className="mr-3 inline-flex items-center gap-1 text-sm">
                        <input type="checkbox" checked={(audience.levels ?? []).includes(l.id)} onChange={(e) => set({ audience: { ...audience, levels: e.target.checked ? [...(audience.levels ?? []), l.id] : (audience.levels ?? []).filter((x) => x !== l.id) } })} />
                        {l.name}
                      </label>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-admin-muted">Active members, matched by their email address.</p>
              </fieldset>
            )}
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={c.track_links} onChange={(e) => set({ track_links: e.target.checked })} />
              Track links (people's clicks told apart from mail scanners')
            </label>
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={c.utm} onChange={(e) => set({ utm: e.target.checked })} />
              Add UTM parameters to links to this site
            </label>

            <div className="mb-3 rounded bg-white p-3 shadow-[0_0_0_1px_rgba(26,26,46,0.08)]">
              <span className="mb-2 block text-sm font-medium">Send a test</span>
              <div className="flex gap-2">
                <input className={input} value={testTo} placeholder="Also to (up to 5 addresses)" onChange={(e) => setTestTo(e.target.value)} />
                <button type="button" className={secondary} disabled={busy} onClick={() => run(async () => (await saveFirst(), post({ action: 'test', id: c.id, to: testTo })), 'Test sent to you' + (testTo ? ' and the addresses given' : '') + '.')}>
                  Send test
                </button>
              </div>
              <p className="mt-1 text-xs text-admin-muted">As it would go now, marked [Test] and not counted. Its links aren't tracked.</p>
            </div>

            {admin ? (
              <div className="rounded bg-white p-3 shadow-[0_0_0_1px_rgba(26,26,46,0.08)]">
                <span className="mb-2 block text-sm font-medium">Send</span>
                {c.status === 'review' && (
                  <div className="mb-3">
                    <button type="button" className={primary} disabled={busy} onClick={() => ask('approve')}>
                      Approve
                    </button>
                    <span className="ml-2 text-xs text-admin-muted">It goes out {when(c.scheduled_at)}.</span>
                  </div>
                )}
                {c.status === 'scheduled' ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={secondary} disabled={busy} onClick={() => run(() => post({ action: 'unschedule', id: c.id }), 'Back to a draft.', true)}>
                      {c.digest_id && !c.approved_at ? 'Unschedule' : 'Back to draft'}
                    </button>
                    <button type="button" className={secondary} disabled={busy} onClick={() => ask('send')}>
                      Send now instead
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={primary} disabled={busy} onClick={() => ask('send')}>
                      {c.status === 'paused' || c.status === 'failed' ? 'Resume now' : 'Send now'}
                    </button>
                    <span className="text-xs text-admin-muted">or at</span>
                    <input type="datetime-local" className="rounded border border-admin-ink/15 px-2 py-1 text-sm" value={at} onChange={(e) => setAt(e.target.value)} />
                    <button type="button" className={secondary} disabled={busy} onClick={() => ask('schedule')}>
                      Schedule
                    </button>
                  </div>
                )}
                <p className="mt-1 text-xs text-admin-muted">Times are in the site's time zone ({tz.replace(/_/g, ' ')}).</p>
                {(c.status === 'paused' || c.status === 'scheduled') && (
                  <button type="button" className="mt-2 text-xs text-[#c4592a] underline" disabled={busy} onClick={() => confirm('Cancel this campaign? Whatever has gone out stays sent; nothing more goes.') && run(() => post({ action: 'cancel', id: c.id }), 'Cancelled.', true)}>
                    Cancel the campaign
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-admin-muted">An admin schedules and sends it.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
          <span>
            “{c.subject}” to {listNames || 'no lists'}
            {audience.members === 'members' ? ', members only' : audience.members === 'non-members' ? ', non-members only' : ''}
          </span>
          {admin && c.status === 'sending' && (
            <button type="button" className={secondary} disabled={busy} onClick={() => run(() => post({ action: 'pause', id: c.id }), 'Paused.', true)}>
              Pause
            </button>
          )}
          {!admin && c.status === 'draft' && <span className="text-admin-muted">Only admins change campaigns once they are scheduled.</span>}
          <button type="button" className={secondary} onClick={() => setBuilding(true)}>
            See the email
          </button>
        </div>
      )}

      <div className="mt-6 flex gap-3 text-xs">
        <button type="button" className="underline hover:text-admin-accent" onClick={() => run(async () => (location.href = `/admin/mailing/campaigns/${(await post({ action: 'duplicate', id: c.id })).id}/`), 'Copied.')}>
          Duplicate
        </button>
        {(c.status === 'draft' || (admin && ['cancelled', 'skipped', 'failed'].includes(c.status) && !c.started_at)) && (
          <button type="button" className="text-[#c4592a] underline" onClick={() => confirm('Delete this campaign?') && run(async () => (await post({ action: 'delete', id: c.id }), (location.href = '/admin/mailing/')), 'Deleted.')}>
            Delete
          </button>
        )}
      </div>

      {stats && stats.recipients + stats.dropped > 0 && <Numbers stats={stats} links={links} showMachine={showMachine} setShowMachine={setShowMachine} campaignId={c.id} admin={admin} mailgun={mailgun} />}

      {confirming && (
        <div className="fixed inset-0 z-[950] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Confirm">
          <div className="w-full max-w-md rounded bg-white p-5 shadow-xl">
            <h2 className="mb-2 text-lg font-semibold">{confirming.action === 'approve' ? 'Approve this issue?' : confirming.action === 'schedule' ? 'Schedule this campaign?' : 'Send this campaign now?'}</h2>
            <p className="mb-3 text-sm">
              “{c.subject || '(no subject)'}” to {listNames || 'no lists'}
              {audience.members === 'members' ? ' (members only)' : audience.members === 'non-members' ? ' (non-members only)' : ''}: {confirming.count === null ? 'counting…' : <strong>{confirming.count} {confirming.count === 1 ? 'person' : 'people'}</strong>} now
              {confirming.action === 'schedule' ? `, at ${at.replace('T', ' ')} (${tz.replace(/_/g, ' ')})` : ''}. Who is still subscribed when it goes is who gets it.
            </p>
            <label className="mb-4 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={confirming.ticked} onChange={(e) => setConfirming({ ...confirming, ticked: e.target.checked })} />
              <span>I've sent a test and checked it. This can't be called back once it goes.</span>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={secondary} onClick={() => setConfirming(null)}>
                Not yet
              </button>
              <button
                type="button"
                className={primary}
                disabled={!confirming.ticked || !confirming.count || busy}
                onClick={() => {
                  const a = confirming.action;
                  setConfirming(null);
                  run(() => post(a === 'schedule' ? { action: 'schedule', id: c.id, at } : { action: a, id: c.id }), a === 'send' ? 'Sending.' : a === 'approve' ? 'Approved.' : 'Scheduled.', true);
                }}
              >
                {confirming.action === 'approve' ? 'Approve' : confirming.action === 'schedule' ? 'Schedule' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {building && (
        <EmailBuilder
          title={`${c.name || 'Campaign'}: email`}
          kit={kit}
          design={(c.design ?? { root: { props: {} }, content: [] }) as EmailDoc}
          text={c.text}
          note={editable ? 'Saved with the campaign (Save).' : 'This campaign can’t be changed now.'}
          onChange={(patch) => editable && set({ ...(patch.design ? { design: patch.design } : {}), ...('text' in patch ? { text: patch.text ?? '' } : {}) })}
          onClose={() => setBuilding(false)}
        />
      )}
    </div>
  );
}

function Numbers({ stats: s, links, showMachine, setShowMachine, campaignId, admin, mailgun }: { stats: CampaignStats; links: LinkRow[]; showMachine: boolean; setShowMachine: (v: boolean) => void; campaignId: number; admin: boolean; mailgun: boolean }) {
  const [mg, setMg] = useState<Record<string, number> | null>(null);
  const [err, setErr] = useState('');
  const tile = (title: string, value: string | number, note?: string) => (
    <div className="rounded bg-white p-3 shadow-[0_0_0_1px_rgba(26,26,46,0.08)]">
      <div className="text-xs text-admin-muted">{title}</div>
      <div className="text-2xl">{value}</div>
      {note && <div className="text-xs text-admin-muted">{note}</div>}
    </div>
  );
  const content = links.filter((l) => l.kind === 'content');
  const trap = links.find((l) => l.kind === 'honeypot');
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xl">Numbers</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tile('Sent', s.sent, s.queued ? `${s.queued} still to go` : s.dropped ? `${s.dropped} unsubscribed before their batch` : undefined)}
        {tile('Delivered', s.delivered, rate(s.delivered, s.sent))}
        {tile('Clicked', rate(s.clicked, s.delivered), `${s.clicked} people (${s.confirmed} confirmed)`)}
        {tile('Opened', rate(s.opened, s.delivered), 'Indicative: mail apps open some for people')}
        {tile('Bounced', rate(s.bounced, s.sent), `${s.bounced}`)}
        {tile('Spam complaints', rate(s.complained, s.delivered), `${s.complained}`)}
        {tile('Unsubscribed', rate(s.unsubscribed, s.delivered), `${s.unsubscribed}`)}
        {tile('Machine clicks', s.machine, 'Sends whose links a mail scanner followed')}
      </div>
      <p className="mt-2 text-xs text-admin-muted">Clicked counts people (and likely people), not mail scanners; confirmed means they went on to use the page. Opens leave out mail scanners and privacy proxies.</p>
      {content.length > 0 && (
        <>
          <div className="mt-6 mb-2 flex items-center justify-between">
            <h3 className="text-lg">Links</h3>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={showMachine} onChange={(e) => setShowMachine(e.target.checked)} />
              Show machine clicks
            </label>
          </div>
          <table className="w-full border-collapse overflow-hidden rounded bg-white text-sm shadow-[0_0_0_1px_rgba(26,26,46,0.08)]">
            <thead className="bg-admin-soft text-left text-xs tracking-wider text-admin-muted uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">Link</th>
                <th className="px-3 py-2 font-semibold">People</th>
                <th className="px-3 py-2 font-semibold">Confirmed</th>
                {showMachine && <th className="px-3 py-2 font-semibold">Machine clicks</th>}
              </tr>
            </thead>
            <tbody>
              {content.map((l) => (
                <tr key={l.id} className="border-t border-admin-ink/5 align-top">
                  <td className="px-3 py-2">
                    <div>{l.label}</div>
                    <div className="max-w-xl truncate text-xs text-admin-muted">{l.url}</div>
                  </td>
                  <td className="px-3 py-2">{l.likelyUnique + l.humanUnique}</td>
                  <td className="px-3 py-2">{l.humanUnique}</td>
                  {showMachine && <td className="px-3 py-2">{l.machine}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {showMachine && trap && <p className="mt-1 text-xs text-admin-muted">The hidden link (followed only by machines) was followed {trap.machine + trap.likely + trap.human} times.</p>}
        </>
      )}
      {admin && mailgun && (
        <div className="mt-4 text-xs">
          <button
            type="button"
            className="underline hover:text-admin-accent"
            onClick={async () => {
              setErr('');
              try {
                setMg((await post({ action: 'reconcile', id: campaignId })).totals);
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Compare with Mailgun's totals
          </button>
          {err && <span className="ml-2 text-[#c4592a]">{err}</span>}
          {mg && <span className="ml-2 text-admin-muted">{Object.entries(mg).map(([k, v]) => `${k} ${v}`).join(' · ') || 'Mailgun has nothing for this campaign yet.'}</span>}
        </div>
      )}
    </section>
  );
}
