// Settings > Tickets (settings.site.tickets; src/lib/tickets/config.ts): who takes payments, the
// currency, how long an unpaid order holds its tickets, the admin's copy of orders, and the emails
// buyers get (wording, and when the reminder and follow-up go out). Saved with the other settings.
import { Num, Row, Select, Text, Toggle, inputClass } from '../puck/fields';
import { CURRENCIES, DEFAULT_EMAILS, DEFAULT_FOLLOW_UP_HOURS, DEFAULT_HOLD, DEFAULT_REMINDER_HOURS, MERGE_TAGS, type EmailKind, type TicketSettings } from '../lib/tickets/config';

const EMAILS: [EmailKind, string, string][] = [
  ['confirmation', 'Confirmation', 'Sent when an order is paid, or at once for free tickets. The order details follow the message.'],
  ['reminder', 'Reminder', 'Sent before the event to everyone with a paid order. The order details follow the message.'],
  ['followUp', 'Follow-up', 'Sent after the event, for thanks or a survey link.'],
  ['waitlist', 'Waitlist: tickets available', 'Sent to people on an event\'s waitlist when tickets free up.'],
];

export default function TicketSettingsPanel({ value, providers, onChange }: { value: TicketSettings; providers: { stripe: boolean; square: boolean }; onChange: (v: TicketSettings) => void }) {
  const set = (patch: Partial<TicketSettings>) => onChange({ ...value, ...patch });
  const setEmail = (kind: EmailKind, patch: Record<string, unknown>) => set({ emails: { ...(value.emails ?? {}), [kind]: { ...((value.emails ?? {})[kind] ?? {}), ...patch } } });
  const provider = value.provider;
  return (
    <>
      <p className="mb-3 text-xs text-admin-muted">An event sells tickets when Tickets is on in its settings. Free tickets need no payment provider.</p>
      <Select
        title="Payments"
        value={provider}
        options={[['stripe', `Stripe${providers.stripe ? '' : ' (keys not set)'}`], ['square', `Square${providers.square ? '' : ' (keys not set)'}`]]}
        onChange={(v) => set({ provider: (v as TicketSettings['provider']) || undefined })}
      />
      {provider && !providers[provider] && (
        <p className="-mt-2 mb-3 text-xs text-[#b3261e]">
          {provider === 'stripe' ? 'Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET' : 'Set SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID and SQUARE_WEBHOOK_SIGNATURE_KEY'} in the site's environment. Until then only free tickets can be ordered.
        </p>
      )}
      {provider && (
        <p className="-mt-2 mb-3 text-xs text-admin-muted">
          Webhook address: <code>{typeof location === 'undefined' ? '' : location.origin}/api/tickets/webhook/{provider}</code>
        </p>
      )}
      <Select title="Currency" value={value.currency} options={CURRENCIES} onChange={(currency) => set({ currency: currency || undefined })} />
      <Num title={`Minutes an unpaid order holds its tickets (30 to 120, default ${DEFAULT_HOLD})`} value={value.hold} min={30} max={120} onChange={(hold) => set({ hold })} />
      <Toggle title="Email me a copy of each order" value={value.notify !== false} onChange={(notify) => set({ notify })} />
      <p className="-mt-2 mb-4 text-xs text-admin-muted">To the site's admin address (TICKETS_NOTIFY_EMAIL or FORMS_ADMIN_EMAIL in the environment).</p>

      <span className="mb-1 block text-xs font-semibold tracking-wider text-admin-muted uppercase">Emails to buyers</span>
      <p className="mb-2 text-xs text-admin-muted">Each event can have its own wording. Tags: {MERGE_TAGS.map(([tag, label]) => `${tag} ${label.toLowerCase()}`).join(', ')}.</p>
      {EMAILS.map(([kind, label, help]) => {
        const e = (value.emails ?? {})[kind] as { subject?: string; message?: string; on?: boolean; hours?: number } | undefined;
        const timed = kind === 'reminder' || kind === 'followUp';
        return (
          <details key={kind} className="mb-2 rounded border border-admin-ink/10 bg-white" open={timed ? !!e?.on : false}>
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              {label}
              {timed && <span className="ml-2 text-xs font-normal text-admin-muted">{e?.on ? `on, ${e.hours ?? (kind === 'reminder' ? DEFAULT_REMINDER_HOURS : DEFAULT_FOLLOW_UP_HOURS)} hours ${kind === 'reminder' ? 'before' : 'after'}` : 'off'}</span>}
            </summary>
            <div className="border-t border-admin-ink/10 p-3">
              <p className="mb-3 text-xs text-admin-muted">{help}</p>
              {timed && (
                <>
                  <Toggle title={`Send the ${label.toLowerCase()}`} value={e?.on} onChange={(on) => setEmail(kind, { on })} />
                  <Num title={`Hours ${kind === 'reminder' ? 'before the event starts' : 'after the event ends'}`} value={e?.hours ?? (kind === 'reminder' ? DEFAULT_REMINDER_HOURS : DEFAULT_FOLLOW_UP_HOURS)} min={1} onChange={(hours) => setEmail(kind, { hours })} />
                </>
              )}
              <Text title="Subject" value={e?.subject} placeholder={DEFAULT_EMAILS[kind].subject} onChange={(subject) => setEmail(kind, { subject: subject || undefined })} />
              <Row title="Message">
                <textarea className={inputClass} rows={7} value={e?.message ?? ''} placeholder={DEFAULT_EMAILS[kind].message} onChange={(ev) => setEmail(kind, { message: ev.target.value || undefined })} />
              </Row>
            </div>
          </details>
        );
      })}
      <p className="mt-2 text-xs text-admin-muted">Reminders and follow-ups are sent hourly by the site's scheduled function, on the deployed site only.</p>
    </>
  );
}
