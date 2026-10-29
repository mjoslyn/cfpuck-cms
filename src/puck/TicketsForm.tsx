// An event's tickets, in its settings (fields.tickets; src/lib/tickets/config.ts): on or off, the
// ticket types with prices, capacities and sales windows, what buyers are asked (phone, address, the
// event's own questions) and the waitlist. Its emails are on its attendee list (Emails).
import { useEffect, useRef, useState } from 'react';
import { Num, Row, Select, Text, Toggle, inputClass } from './fields';
import { TICKETS_KEY, newId, parsePrice, type EventTickets, type TicketQuestion, type TicketType } from '../lib/tickets/config';
import { MIN_CHARGE } from '../lib/payments/money';
import type { MemberLevel } from '../lib/members/config';
import { useMemberSettings } from './member-settings';

const small = 'rounded-sm border border-admin-ink/20 px-2 py-1 text-xs font-semibold hover:border-admin-ink/50';

/** A price typed as dollars and cents, kept as cents. */
export function PriceInput({ value, onChange, title = 'Price (empty or 0: free)', optional }: { value: number | undefined; onChange: (cents: number | undefined) => void; title?: string; optional?: boolean }) {
  const [text, setText] = useState(value ? (value / 100).toFixed(2) : optional && value === 0 ? '0.00' : '');
  const bad = text.trim() !== '' && parsePrice(text) == null;
  const cents = bad ? null : parsePrice(text);
  // The providers take nothing smaller: an order that comes to less can't be paid.
  const low = cents != null && cents > 0 && cents < MIN_CHARGE;
  return (
    <Row title={title}>
      <input
        className={inputClass}
        inputMode="decimal"
        value={text}
        placeholder="0.00"
        aria-invalid={bad || undefined}
        onChange={(e) => {
          setText(e.target.value);
          const cents = parsePrice(e.target.value);
          if (cents != null || !e.target.value.trim()) onChange(cents ?? (optional ? undefined : 0));
        }}
      />
      {bad && <span className="mt-1 block text-xs text-[#b3261e]">Write a price like 25 or 12.50.</span>}
      {low && <span className="mt-1 block text-xs text-[#b3261e]">An order has to come to at least {(MIN_CHARGE / 100).toFixed(2)} to be paid online; one that comes to less is refused.</span>}
    </Row>
  );
}

/** A list of items with Up, Down and Remove, each opened to edit it. */
function List<T extends { id: string }>({ items, label, render, onChange }: { items: T[]; label: (x: T, i: number) => string; render: (x: T, set: (patch: Partial<T>) => void) => React.ReactNode; onChange: (items: T[]) => void }) {
  // Open: items added since the form opened (to fill them in), and those opened by hand.
  const seen = useRef<Set<string> | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  seen.current ??= new Set(items.map((x) => x.id));
  const added = items.filter((x) => !seen.current!.has(x.id));
  if (added.length) {
    for (const x of added) seen.current.add(x.id);
    setOpen((o) => new Set([...o, ...added.map((x) => x.id)]));
  }
  const move = (i: number, j: number) => {
    const r = [...items];
    [r[i], r[j]] = [r[j], r[i]];
    onChange(r);
  };
  return (
    <>
      {items.map((x, i) => (
        <details
          key={x.id}
          className="mb-1 rounded border border-admin-ink/10 bg-admin-bg"
          open={open.has(x.id)}
          onToggle={(e) => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open;
            setOpen((o) => (o.has(x.id) === isOpen ? o : isOpen ? new Set(o).add(x.id) : new Set([...o].filter((k) => k !== x.id))));
          }}
        >
          <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm">
            <span className="truncate">{label(x, i) || `Item ${i + 1}`}</span>
            <span className="ml-auto flex gap-1 text-xs text-admin-muted">
              <button type="button" disabled={i === 0} onClick={(e) => { e.preventDefault(); move(i, i - 1); }}>Up</button>
              <button type="button" disabled={i === items.length - 1} onClick={(e) => { e.preventDefault(); move(i, i + 1); }}>Down</button>
              <button type="button" className="text-[#c4592a]" onClick={(e) => { e.preventDefault(); onChange(items.filter((_, j) => j !== i)); }}>Remove</button>
            </span>
          </summary>
          <div className="border-t border-admin-ink/10 bg-white p-2">{render(x, (patch) => onChange(items.map((y, j) => (j === i ? { ...y, ...patch } : y))))}</div>
        </details>
      ))}
    </>
  );
}

const DateTime = ({ title, value, onChange }: { title: string; value?: string; onChange: (v: string | undefined) => void }) => (
  <Row title={title}>
    <input type="datetime-local" className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />
  </Row>
);

/** Members' prices by level, and whether only members (of some levels) may buy a ticket type. */
function MemberPricing({ type, levels, onChange }: { type: TicketType; levels: MemberLevel[]; onChange: (patch: Partial<TicketType>) => void }) {
  const prices = type.memberPrices ?? {};
  const setPrice = (level: string, cents: number | undefined) => {
    const next = { ...prices };
    if (cents == null) delete next[level];
    else next[level] = cents;
    onChange({ memberPrices: Object.keys(next).length ? next : undefined });
  };
  const chosen = type.levels ?? [];
  return (
    <div className="mb-3 rounded border border-admin-ink/10 p-2">
      <span className="mb-1 block text-xs font-medium text-admin-muted">Members</span>
      {levels.map((l) => (
        <PriceInput key={l.id} title={`${l.name} price (empty: the price above)`} value={prices[l.id]} optional onChange={(cents) => setPrice(l.id, cents)} />
      ))}
      <Toggle title="Members only" value={type.membersOnly} onChange={(membersOnly) => onChange({ membersOnly: membersOnly || undefined })} />
      {type.membersOnly && levels.length > 1 && (
        <fieldset className="mb-2">
          <legend className="mb-1 text-xs text-admin-muted">Levels that may buy it (none ticked: all)</legend>
          {levels.map((l) => (
            <label key={l.id} className="mr-3 inline-flex items-center gap-1 text-sm">
              <input type="checkbox" checked={chosen.includes(l.id)} onChange={(e) => onChange({ levels: e.target.checked ? [...chosen, l.id] : chosen.filter((x) => x !== l.id) })} />
              {l.name}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

export function TicketsForm({ fields, onChange }: { fields: Record<string, any>; onChange: (fields: Record<string, any>) => void }) {
  const members = useMemberSettings();
  const t: EventTickets = { types: [], ...(fields[TICKETS_KEY] ?? {}) };
  // `enabled` isn't stored any more: an event sells tickets while it has ticket types.
  const { enabled: _enabled, ...stored } = t;
  const set = (patch: Partial<EventTickets>) => onChange({ ...fields, [TICKETS_KEY]: { ...stored, ...patch } });
  // The attendee list, for an event that has been saved (/admin/edit/<id>/).
  const [entryId, setEntryId] = useState<string | null>(null);
  useEffect(() => setEntryId(location.pathname.match(/\/admin\/edit\/(\d+)/)?.[1] ?? null), []);

  return (
    <>
      {/* The event sells tickets (or takes registrations) while it has ticket types. */}
      {!t.types.length && <p className="mb-2 text-xs text-admin-muted">Add a ticket type to sell tickets or take registrations (a price of 0 is free).</p>}
      {entryId && t.types.length > 0 && (
        <p className="mb-3 text-xs">
          <a className="text-admin-accent underline" href={`/admin/tickets/${entryId}/`} target="_blank" rel="noopener">Attendee list and orders</a>
        </p>
      )}
      {t.types.length > 0 && <Text title="Heading" value={t.heading} placeholder="Tickets" onChange={(heading) => set({ heading: heading || undefined })} />}
      {t.types.length > 0 && <span className="mb-1 block text-xs font-medium text-admin-muted">Ticket types</span>}
      <List<TicketType>
        items={t.types}
        label={(x) => `${x.name || 'Ticket'}${x.hidden ? ' (not offered)' : ''}`}
        onChange={(types) => set({ types })}
        render={(x, setType) => (
          <>
            <Text title="Name" value={x.name} onChange={(name) => setType({ name })} />
            <Row title="Description">
              <textarea className={inputClass} rows={2} value={x.description ?? ''} onChange={(e) => setType({ description: e.target.value || undefined })} />
            </Row>
            <PriceInput value={x.price} onChange={(price) => setType({ price: price ?? 0 })} />
            {members?.enabled && members.levels.length > 0 && <MemberPricing type={x} levels={members.levels} onChange={setType} />}
            <Num title="How many (empty: no limit of its own; 0: sold out)" value={x.capacity ?? undefined} min={0} onChange={(capacity) => setType({ capacity: capacity ?? null })} />
            <Num title="Most in one order" value={x.maxPerOrder ?? undefined} min={1} onChange={(maxPerOrder) => setType({ maxPerOrder: maxPerOrder ?? null })} />
            <DateTime title="On sale from (empty: now)" value={x.salesStart} onChange={(salesStart) => setType({ salesStart })} />
            <DateTime title="On sale until (empty: until the event ends)" value={x.salesEnd} onChange={(salesEnd) => setType({ salesEnd })} />
            <Toggle title="No longer offered (kept for past orders)" value={x.hidden} onChange={(hidden) => setType({ hidden: hidden || undefined })} />
          </>
        )}
      />
      <button type="button" className={`${small} mb-3`} onClick={() => set({ types: [...t.types, { id: newId('t'), name: t.types.length ? '' : 'General admission', price: 0 }] })}>
        Add ticket type
      </button>
      {t.types.length > 0 && (
        <>
          <p className="-mt-1 mb-3 text-xs text-admin-muted">Times are in the event's timezone. A recurring event sells tickets for each date separately.</p>
          <Num title="Capacity: tickets of all types together (empty: no limit; 0: sold out)" value={t.capacity ?? undefined} min={0} onChange={(capacity) => set({ capacity: capacity ?? null })} />
          <Num title="Most tickets in one order (default 10)" value={t.maxPerOrder ?? undefined} min={1} onChange={(maxPerOrder) => set({ maxPerOrder: maxPerOrder ?? null })} />
          <Select title="Waitlist when sold out" value={t.waitlist} options={[['off', 'Off'], ['auto', 'On: email people as tickets free up'], ['manual', 'On: notify people from the attendee list']]} onChange={(v) => set({ waitlist: (v as EventTickets['waitlist']) ?? 'off' })} />

          <span className="mt-4 mb-1 block text-xs font-semibold tracking-wider text-admin-muted uppercase">Buyers are asked</span>
          <p className="mb-2 text-xs text-admin-muted">Name and email always.</p>
          <Select title="Phone" value={t.phone} options={[['off', 'Not asked'], ['optional', 'Optional'], ['required', 'Required']]} onChange={(v) => set({ phone: (v as EventTickets['phone']) ?? 'off' })} />
          <Select title="Address" value={t.address} options={[['off', 'Not asked'], ['paid', 'For paid orders'], ['always', 'Always']]} onChange={(v) => set({ address: (v as EventTickets['address']) ?? 'off' })} />
          <span className="mb-1 block text-xs font-medium text-admin-muted">Questions of your own</span>
          <List<TicketQuestion>
            items={t.questions ?? []}
            label={(q) => q.label}
            onChange={(questions) => set({ questions })}
            render={(q, setQ) => (
              <>
                <Text title="Question" value={q.label} onChange={(label) => setQ({ label })} />
                <Select title="Answer" value={q.type} options={[['text', 'Short text'], ['textarea', 'Long text'], ['select', 'Choose one'], ['checkbox', 'Checkbox (yes)'], ['number', 'Number']]} onChange={(v) => setQ({ type: (v as TicketQuestion['type']) ?? 'text' })} />
                {q.type === 'select' && (
                  <Row title="Choices, one per line">
                    <textarea className={inputClass} rows={3} value={(q.choices ?? []).join('\n')} onChange={(e) => setQ({ choices: e.target.value.split('\n') })} />
                  </Row>
                )}
                <Text title="Help text" value={q.help} onChange={(help) => setQ({ help: help || undefined })} />
                <Toggle title="Required" value={q.required} onChange={(required) => setQ({ required: required || undefined })} />
              </>
            )}
          />
          <button type="button" className={`${small} mb-3`} onClick={() => set({ questions: [...(t.questions ?? []), { id: newId('q'), label: '', type: 'text' }] })}>
            Add question
          </button>

          <span className="mt-4 mb-1 block text-xs font-semibold tracking-wider text-admin-muted uppercase">Emails</span>
          <p className="mb-3 text-xs text-admin-muted">
            Buyers get the emails designed under Settings &gt; Tickets.{' '}
            {entryId ? (
              <a className="text-admin-accent underline" href={`/admin/tickets/${entryId}/?view=emails`} target="_blank" rel="noopener">
                Give this event its own
              </a>
            ) : (
              'Save the event to give it its own.'
            )}
          </p>
        </>
      )}
    </>
  );
}
