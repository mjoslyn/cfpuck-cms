// An event's own emails (its attendee list > Emails; table ticket_emails): each kind uses the site's
// email (Settings > Tickets) until the event is given its own, designed in the email builder; the
// reminder and follow-up can be turned off for the event. Saved per email (POST /api/admin/tickets).
import { useRef, useState } from 'react';
import { Toggle } from '../puck/fields';
import { DEFAULT_EMAILS, EMAIL_KINDS, type EmailKind, type EventEmail, type TicketSettings } from '../lib/tickets/config';
import { TicketEmailCard } from './TicketEmailCard';

const HELP: Record<EmailKind, string> = {
  confirmation: 'To the buyer when an order is paid, or at once for free tickets.',
  reminder: 'To everyone with a paid order, before the event (when reminders are on under Settings > Tickets).',
  followUp: 'To everyone with a paid order, after the event (when follow-ups are on under Settings > Tickets).',
  waitlist: 'To people on the waitlist when tickets free up.',
  admin: "The copy of each order to the site's admin address.",
};

export default function TicketEmails({ eventId, eventTitle, own, site }: { eventId: number; eventTitle: string; own: Partial<Record<EmailKind, EventEmail>>; site: TicketSettings['emails'] }) {
  const [emails, setEmails] = useState(own);
  const latest = useRef(emails);
  latest.current = emails;
  const [saved, setSaved] = useState(() => JSON.stringify(own));
  const [status, setStatus] = useState<Partial<Record<EmailKind, string>>>({});
  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/admin/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: eventId, ...body }) });
    if (!res.ok) throw new Error(await res.text());
  };
  const save = async (kind: EmailKind, next = emails) => {
    setStatus((s) => ({ ...s, [kind]: 'Saving…' }));
    try {
      await post({ action: 'email-save', kind, email: next[kind] ?? {} });
      setSaved(JSON.stringify({ ...JSON.parse(saved), [kind]: next[kind] }));
      setStatus((s) => ({ ...s, [kind]: 'Saved.' }));
    } catch (e) {
      setStatus((s) => ({ ...s, [kind]: `Not saved: ${(e as Error).message}` }));
    }
  };
  const dirty = (kind: EmailKind) => JSON.stringify(emails[kind] ?? null) !== JSON.stringify(JSON.parse(saved)[kind] ?? null);
  const set = (kind: EmailKind, patch: EventEmail) => setEmails((e) => ({ ...e, [kind]: { ...(e[kind] ?? {}), ...patch } }));

  return (
    <div className="max-w-3xl">
      <p className="mb-4 text-sm text-admin-muted">
        This event's emails. Each uses the site's email from <a className="underline hover:text-admin-accent" href="/admin/settings/#tickets">Settings &gt; Tickets</a> until you edit it here; then this event sends its own.
      </p>
      {EMAIL_KINDS.map(([kind, label]) => {
        const e = emails[kind] ?? {};
        const siteEmail = site?.[kind];
        return (
          <TicketEmailCard
            key={kind}
            kind={kind}
            label={label}
            help={HELP[kind]}
            value={e}
            start={siteEmail?.design ?? DEFAULT_EMAILS[kind].design}
            subjectPlaceholder={siteEmail?.subject || DEFAULT_EMAILS[kind].subject}
            eventTitle={eventTitle}
            note="Saved for this event when you press Done."
            onChange={(patch) => set(kind, patch)}
            onReset={() => {
              const next = { ...emails, [kind]: { off: e.off } };
              setEmails(next);
              save(kind, next);
            }}
            onDone={() => dirty(kind) && save(kind, latest.current)}
          >
            {(kind === 'reminder' || kind === 'followUp') && <Toggle title="Don't send it for this event" value={e.off} onChange={(off) => set(kind, { off: off || undefined })} />}
            <div className="mb-2 flex items-center gap-3">
              {dirty(kind) && (
                <button type="button" onClick={() => save(kind)} className="rounded-sm bg-admin-ink px-3 py-1 text-xs font-semibold text-white hover:bg-admin-accent">
                  Save
                </button>
              )}
              {status[kind] && <span role="status" className="text-xs text-admin-muted">{status[kind]}</span>}
            </div>
          </TicketEmailCard>
        );
      })}
    </div>
  );
}
