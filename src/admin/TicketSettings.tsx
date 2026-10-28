// Settings > Tickets (settings.site.tickets; src/lib/tickets/config.ts): who takes payments, the
// currency, how long an unpaid order holds its tickets, and the emails: the buyer's (confirmation,
// reminder, follow-up, waitlist) and the admin's copy of each order, each designed in the email builder,
// with when the reminder and follow-up go out. Saved with the other settings; an event can have its own
// emails (its attendee list > Emails).
import { useEffect, useState } from 'react';
import { Num, Segmented, Select, Toggle } from '../puck/fields';
import type { PaymentProvider, ProviderStatus } from '../lib/payments';
import { CURRENCIES, DEFAULT_FOLLOW_UP_HOURS, DEFAULT_HOLD, DEFAULT_REMINDER_HOURS, EMAIL_KINDS, type EmailKind, type TicketEmail, type TicketSettings } from '../lib/tickets/config';
import { TicketEmailCard } from './TicketEmailCard';

const HELP: Record<EmailKind, string> = {
  confirmation: 'To the buyer when an order is paid, or at once for free tickets.',
  reminder: 'To everyone with a paid order, before the event.',
  followUp: 'To everyone with a paid order, after the event: thanks, or a survey link.',
  waitlist: "To people on an event's waitlist when tickets free up.",
  admin: "To the site's admin address (TICKETS_NOTIFY_EMAIL or FORMS_ADMIN_EMAIL in the environment) for each order, replying to the buyer.",
};

export default function TicketSettingsPanel({ value, providers, onChange }: { value: TicketSettings; providers: Record<PaymentProvider, ProviderStatus>; onChange: (v: TicketSettings) => void }) {
  const set = (patch: Partial<TicketSettings>) => onChange({ ...value, ...patch });
  const emails = (value.emails ?? {}) as Record<EmailKind, (TicketEmail & { on?: boolean; hours?: number }) | undefined>;
  const setEmail = (kind: EmailKind, patch: TicketEmail & { on?: boolean; hours?: number }) => set({ emails: { ...emails, [kind]: { ...(emails[kind] ?? {}), ...patch } } });
  // Providers with keys in the environment; the one payments go through is the chosen one if it has
  // them, else the one that does (pickProvider on the server).
  const ready = (Object.keys(providers) as PaymentProvider[]).filter((p) => providers[p].configured);
  const provider = value.provider && ready.includes(value.provider) ? value.provider : ready[0];
  const label = (p: PaymentProvider) => `${providers[p].label}${providers[p].sandbox ? ' (test mode)' : ''}`;
  // The site's address, once in the browser (the server renders without it).
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(location.origin), []);
  return (
    <>
      <p className="mb-3 text-xs text-admin-muted">An event sells tickets when Tickets is on in its settings. Free tickets need no payment provider.</p>
      {ready.length > 1 && <Segmented title="Payments" value={provider!} options={ready.map((p) => [p, label(p)] as [string, string])} onChange={(v) => set({ provider: v as PaymentProvider })} />}
      {ready.length === 1 && <p className="mb-3 text-xs text-admin-muted">Payments go through {label(ready[0])}.</p>}
      {!ready.length && (
        <p className="mb-3 rounded bg-admin-soft p-2 text-xs text-admin-muted">
          To sell paid tickets, connect Stripe or Square under <a className="underline" href="/admin/settings/connections/">Settings &gt; Connections</a>.
        </p>
      )}
      {provider && (
        <p className="-mt-2 mb-3 text-xs text-admin-muted">
          Webhook address: <code>{origin}/api/payments/{provider}</code> (shared with forms that take payment)
        </p>
      )}
      {ready.length > 0 && (
        <>
          <Select title="Currency" value={value.currency} options={CURRENCIES} onChange={(currency) => set({ currency: currency || undefined })} />
          <Num title={`Minutes an unpaid order holds its tickets (30 to 120, default ${DEFAULT_HOLD})`} value={value.hold} min={30} max={120} onChange={(hold) => set({ hold })} />
        </>
      )}

      <span className="mt-4 mb-1 block text-xs font-semibold tracking-wider text-admin-muted uppercase">Emails</span>
      <p className="mb-2 text-xs text-admin-muted">Designed in the email builder, with the order's details as merge tags and an Order details block. An event can have its own, on its attendee list.</p>
      {EMAIL_KINDS.map(([kind, label]) => {
        const e = emails[kind] ?? {};
        const timed = kind === 'reminder' || kind === 'followUp';
        const hours = e.hours ?? (kind === 'reminder' ? DEFAULT_REMINDER_HOURS : DEFAULT_FOLLOW_UP_HOURS);
        return (
          <TicketEmailCard
            key={kind}
            kind={kind}
            label={label}
            help={HELP[kind]}
            value={e}
            note="Saved with the settings."
            onChange={(patch) => setEmail(kind, patch)}
            onReset={() => setEmail(kind, { design: undefined, text: undefined })}
          >
            {timed && (
              <>
                <Toggle title={`Send the ${label.toLowerCase()}`} value={e.on} onChange={(on) => setEmail(kind, { on })} />
                <Num title={`Hours ${kind === 'reminder' ? 'before the event starts' : 'after the event ends'}`} value={hours} min={1} onChange={(h) => setEmail(kind, { hours: h })} />
              </>
            )}
            {kind === 'admin' && <Toggle title="Send a copy of each order" value={value.notify !== false} onChange={(notify) => set({ notify })} />}
          </TicketEmailCard>
        );
      })}
      <p className="mt-2 text-xs text-admin-muted">Reminders and follow-ups are sent hourly by the site's scheduled function, on the deployed site only.</p>
    </>
  );
}
