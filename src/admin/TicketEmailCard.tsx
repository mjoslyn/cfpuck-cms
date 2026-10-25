// One ticket email in a list of them (Settings > Tickets, and an event's own on its attendee list): its
// subject, whether it has its own design, and Edit email, which opens the email builder with the
// ticket kit (src/admin/ticket-email.ts).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import EmailBuilder from '../forms/EmailBuilder';
import { Text } from '../puck/fields';
import type { EmailDoc } from '../lib/forms/email';
import { DEFAULT_EMAILS, type EmailKind, type TicketEmail } from '../lib/tickets/config';
import { ticketEmailKit } from './ticket-email';
import { browserClient } from '../lib/db/browser';
import { defaultTemplate } from '../lib/email-templates';

const btn = 'rounded-sm border border-admin-ink/20 px-3 py-1.5 text-xs font-semibold hover:border-admin-ink/50';

export function TicketEmailCard({
  kind,
  label,
  help,
  value,
  start,
  subjectPlaceholder,
  eventTitle,
  note,
  children,
  onChange,
  onReset,
  onDone,
}: {
  kind: EmailKind;
  label: string;
  help: ReactNode;
  value: TicketEmail;
  /** The design the builder opens with when there is none yet. */
  start?: EmailDoc;
  subjectPlaceholder?: string;
  eventTitle?: string;
  /** Shown in the builder's header: how changes are saved. */
  note: string;
  /** Controls above the subject (on/off, timing). */
  children?: ReactNode;
  onChange: (patch: TicketEmail) => void;
  /** Back to the default (or the site's) email; offered when this one has a design of its own. */
  onReset?: () => void;
  /** The builder closed. */
  onDone?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // The default template for this kind of ticket email, sent when nothing above it is designed.
  const [template, setTemplate] = useState<{ design: EmailDoc; text: string } | null>(null);
  useEffect(() => {
    defaultTemplate(browserClient(), `ticket:${kind}`).then(setTemplate, () => {});
  }, [kind]);
  const subject = useRef(value.subject);
  subject.current = value.subject || subjectPlaceholder || DEFAULT_EMAILS[kind].subject;
  const kit = useMemo(() => ticketEmailKit(kind, () => subject.current!, eventTitle), [kind, eventTitle]);
  return (
    <section className="mb-3 rounded border border-admin-ink/10 bg-white p-3">
      <h3 className="text-sm font-medium">{label}</h3>
      <p className="mb-3 text-xs text-admin-muted">{help}</p>
      {children}
      <Text title="Subject" value={value.subject} placeholder={subjectPlaceholder ?? DEFAULT_EMAILS[kind].subject} onChange={(s) => onChange({ subject: s || undefined })} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn} onClick={() => setEditing(true)}>
          Edit email
        </button>
        <span className="text-xs text-admin-muted">{value.design ? 'Designed here' : 'Not changed yet'}</span>
        {value.design && onReset && (
          <button type="button" className="text-xs text-[#b3261e]" onClick={() => confirm('Go back to the default email? This design is removed.') && onReset()}>
            Reset to the default
          </button>
        )}
      </div>
      {editing && (
        <EmailBuilder
          title={`${label}: email`}
          kit={kit}
          design={value.design ?? start ?? template?.design ?? DEFAULT_EMAILS[kind].design}
          text={value.text ?? (value.design || start ? undefined : template?.text || undefined)}
          note={note}
          onChange={(patch) => onChange('text' in patch ? { text: patch.text } : patch)}
          onClose={() => {
            setEditing(false);
            onDone?.();
          }}
        />
      )}
    </section>
  );
}
