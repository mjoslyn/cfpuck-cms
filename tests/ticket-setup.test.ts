// Tickets are their own records (src/lib/tickets/setup.ts): made and set up in the Tickets admin, with
// any number of events attached, all selling from the ticket's one pool; the editor's saves keep the
// stored attachment (keepTickets). The migration turns events' own tickets into ticket records.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { attachEvent, createTicket, deleteTicket, keepTickets, saveTicketSetup, ticketEvents } from '../src/lib/tickets/setup';
import { loadEvent, ticketsAt } from '../src/lib/tickets/orders';
import { renderRequest } from '../src/render/page';

const content = { content: [], root: { props: {} } };
const doc = (items: unknown[]) => ({ root: { props: {} }, content: items, zones: {} });
const PASS = { types: [{ id: 'pass', name: 'Festival pass', price: 0 }] };

beforeAll(async () => {
  const db = siteDb();
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  await db.from('settings').upsert({ key: 'site', value: { ...((data?.value as object) ?? {}), events: { enabled: true } } });
  await db.from('templates').insert([
    { kind: 'template', slug: 'pc-event', title: 'Content only', content: doc([{ type: 'entry-content', props: { id: 'pc', attrs: {} } }]) },
    { kind: 'template', slug: 'ed-event', title: 'Details', content: doc([{ type: 'event-details', props: { id: 'ed', attrs: {} } }]) },
  ]);
});

async function events(rows: { slug: string; title: string; template?: string; fields?: Record<string, any> }[]) {
  const dates = { start: '2099-07-01T18:00', end: '2099-07-01T22:00' };
  const { data } = await siteDb().from('entries').insert(rows.map((r) => ({ type: 'event', status: 'publish', template: 'pc-event', content, ...r, fields: { ...dates, ...r.fields } }))).select('id, slug');
  return (slug: string) => data!.find((r) => r.slug === slug)!.id;
}

describe('tickets as their own records', () => {
  it('keeps the stored ticket whatever an editor save brings', () => {
    expect(keepTickets({ cost: '$10', ticket: 9, tickets: { types: [] } }, { ticket: 4 })).toEqual({ cost: '$10', ticket: 4 });
    expect(keepTickets({ cost: '$10', ticket: 9, tickets_from: 3 }, {})).toEqual({ cost: '$10' });
  });

  it('makes a ticket, saves its setup and name, and attaches and detaches events, keeping their updated_at', async () => {
    const db = siteDb();
    const id = await events([{ slug: 'fair', title: 'Fair', fields: { cost: 'Free' } }]);
    const { data: before } = await db.from('entries').select('updated_at').eq('id', id('fair')).single();
    await db.from('entry_drafts').insert({ entry_id: id('fair'), draft: { entry: { title: 'Fair', fields: { cost: 'Free', note: 'draft' } } } });

    const made = await createTicket(db, '  Fair tickets ');
    expect(made.id).toBeGreaterThan(0);
    expect(await saveTicketSetup(db, made.id!, { types: [{ id: 'ga', name: 'General admission', price: 0 }], waitlist: 'auto' }, 'Fair entry')).toBeNull();
    const { data: ticket } = await db.from('entries').select('type, title, fields').eq('id', made.id!).single();
    expect(ticket).toMatchObject({ type: 'ticket', title: 'Fair entry', fields: { tickets: { waitlist: 'auto', types: [{ id: 'ga' }] } } });
    expect(ticket!.fields.tickets.enabled).toBeUndefined();

    expect(await attachEvent(db, id('fair'), made.id!)).toBeNull();
    const { data: after } = await db.from('entries').select('fields, updated_at').eq('id', id('fair')).single();
    expect(after).toMatchObject({ updated_at: before!.updated_at, fields: { cost: 'Free', ticket: made.id } });
    const { data: kept } = await db.from('entry_drafts').select('draft').eq('entry_id', id('fair')).single();
    expect(kept!.draft.entry.fields).toEqual({ cost: 'Free', note: 'draft', ticket: made.id });
    expect((await ticketEvents(db, made.id!)).map((e) => e.title)).toEqual(['Fair']);

    expect(await attachEvent(db, id('fair'), 0)).toBeNull();
    const { data: off } = await db.from('entries').select('fields').eq('id', id('fair')).single();
    expect(off!.fields.ticket).toBeUndefined();
    expect(await attachEvent(db, id('fair'), 999999)).toBe('No such ticket.');
    expect(await attachEvent(db, made.id!, made.id!)).toBe('No such event.');
    expect(await saveTicketSetup(db, 999999, { types: [] })).toBe('No such ticket.');
  });

  it('sells one ticket from every event attached to it, each on its own page', async () => {
    const db = siteDb();
    const id = await events([
      { slug: 'concert', title: 'Concert' },
      { slug: 'talk-two', title: 'Talk', template: 'ed-event' },
      { slug: 'picnic', title: 'Picnic' },
    ]);
    const { id: pass } = await createTicket(db, 'Festival pass', PASS);
    for (const e of ['concert', 'talk-two']) expect(await attachEvent(db, id(e), pass!)).toBeNull();

    // Each attached event's page sells the ticket as its own: #tickets, posting the ticket's id.
    const concert = (await renderRequest(new URL('http://localhost/event/concert/'), db)).html;
    expect(concert).toContain('<section class="c-tickets" id="tickets"');
    expect(concert).toContain(`data-event="${pass}"`);
    expect(concert).toContain('Festival pass');
    // With Event details, once, and its sidebar links to it.
    const talk = (await renderRequest(new URL('http://localhost/event/talk-two/'), db)).html;
    expect(talk.match(/id="tickets"/g)).toHaveLength(1);
    expect(talk).toContain('href="#tickets">Get tickets');
    // An event without a ticket sells nothing.
    expect((await renderRequest(new URL('http://localhost/event/picnic/'), db)).html).not.toContain('c-tickets');

    // Orders see one pool: the ticket's name, both pages, the first date and the last end.
    const ev = await loadEvent(db, pass!, '');
    expect(ev).toMatchObject({ title: 'Festival pass', occurrence: '', paths: ['/event/concert/', '/event/talk-two/'] });
    expect(ev!.events.map((e) => e.title)).toEqual(['Concert', 'Talk']);
    expect(ticketsAt(ev!, '/event/talk-two/')).toEqual({ path: '/event/talk-two/', anchor: '#tickets' });
    expect(ticketsAt(ev!, '/whats-on/')).toEqual({ path: '/whats-on/', anchor: `#tickets-${pass}` });
    // With one event, it is named after the event; with none, the site can't sell it.
    expect(await attachEvent(db, id('talk-two'), 0)).toBeNull();
    expect((await loadEvent(db, pass!, ''))!.title).toBe('Concert');
    expect(await attachEvent(db, id('concert'), 0)).toBeNull();
    expect(await loadEvent(db, pass!, '')).toBeNull();
    expect(await loadEvent(db, pass!, '', null)).not.toBeNull();
  });

  it('shows a ticket on another page with a Tickets block naming one of its events', async () => {
    const db = siteDb();
    const id = await events([{ slug: 'gala', title: 'Gala' }]);
    const { id: ticket } = await createTicket(db, 'Gala seats', PASS);
    await attachEvent(db, id('gala'), ticket!);
    await db.from('entries').insert({ type: 'page', slug: 'whats-on', title: 'What’s on', status: 'publish', template: 'pc-event', content: doc([{ type: 'tickets', props: { id: 'tk', attrs: { event: id('gala') } } }]) });
    const html = (await renderRequest(new URL('http://localhost/whats-on/'), db)).html;
    expect(html).toContain(`id="tickets-${ticket}"`);
    expect(html).toContain('href="/event/gala/">Gala</a>');
  });

  it('deletes a ticket without orders, detaching its events, and keeps one with orders', async () => {
    const db = siteDb();
    const id = await events([{ slug: 'quiz', title: 'Quiz' }]);
    const { id: a } = await createTicket(db, 'Quiz', PASS);
    const { id: b } = await createTicket(db, 'Old quiz', PASS);
    await attachEvent(db, id('quiz'), a!);
    await db.from('ticket_orders').insert({ entry_id: b, occurrence: '', code: 'QZ1', token: 'tok-qz-1', name: 'Ann', email: 'ann@example.org', items: [{ type: 'pass', name: 'Pass', price: 0, quantity: 1 }], quantity: 1, amount: 0, currency: 'usd', status: 'paid', provider: 'free' });
    expect(await deleteTicket(db, b!)).toMatch(/has orders/);
    expect(await deleteTicket(db, a!)).toBeNull();
    const { data: quiz } = await db.from('entries').select('fields').eq('id', id('quiz')).single();
    expect(quiz!.fields.ticket).toBeUndefined();
    expect((await db.from('entries').select('id').eq('id', a!).maybeSingle()).data).toBeNull();
  });

  it('turns events’ own and shared tickets into ticket records (migration)', async () => {
    const db = siteDb();
    const id = await events([
      { slug: 'm-festival', title: 'Old festival', fields: { tickets: PASS } },
      { slug: 'm-sharer', title: 'Old sharer', fields: { tickets: { types: [{ id: 'own', name: 'Own', price: 0 }] } } },
      { slug: 'm-plain', title: 'Old plain' },
    ]);
    const { data: sharer } = await db.from('entries').select('fields, updated_at').eq('id', id('m-sharer')).single();
    await db.from('entries').update({ fields: { ...sharer!.fields, tickets_from: id('m-festival') } }).eq('id', id('m-sharer'));
    const { data: stamped } = await db.from('entries').select('updated_at').eq('id', id('m-festival')).single();
    const order = (entry: number, code: string) => ({ entry_id: entry, occurrence: '', code, token: `tok-${code}`, name: 'Bo', email: 'bo@example.org', items: [], quantity: 1, amount: 0, currency: 'usd', status: 'paid', provider: 'free' });
    await db.from('ticket_orders').insert([order(id('m-festival'), 'MF1'), order(id('m-sharer'), 'MS1')]);
    await db.from('ticket_emails').insert({ entry_id: id('m-festival'), kind: 'confirmation', subject: 'See you' });

    new DatabaseSync(process.env.D1_LOCAL_FILE!).exec(readFileSync('db/migrations/20261105150000_tickets_own_records.sql', 'utf8'));

    const { data: rows } = await db.from('entries').select('id, title, fields, updated_at').in('id', [id('m-festival'), id('m-sharer'), id('m-plain')]);
    const get = (slug: string) => rows!.find((r) => r.id === id(slug))!;
    const festivalTicket = get('m-festival').fields.ticket;
    expect(festivalTicket).toBeGreaterThan(0);
    expect(get('m-festival').fields.tickets).toBeUndefined();
    expect(get('m-festival').updated_at).toBe(stamped!.updated_at);
    expect(get('m-sharer').fields).not.toHaveProperty('tickets_from');
    expect(get('m-sharer').fields.ticket).toBe(festivalTicket);
    expect(get('m-plain').fields.ticket).toBeUndefined();
    const { data: ticket } = await db.from('entries').select('type, title, fields').eq('id', festivalTicket).single();
    expect(ticket).toMatchObject({ type: 'ticket', title: 'Old festival', fields: { tickets: PASS } });
    expect(ticket!.fields.from_event).toBeUndefined();
    const { data: moved } = await db.from('ticket_orders').select('code, entry_id').in('code', ['MF1', 'MS1']).order('code');
    expect(moved![0].entry_id).toBe(festivalTicket);
    // The sharer's orders from before keep a ticket of their own, attached to nothing.
    const { data: own } = await db.from('entries').select('type, title').eq('id', moved![1].entry_id).single();
    expect(own).toMatchObject({ type: 'ticket', title: 'Old sharer' });
    expect((await db.from('ticket_emails').select('entry_id').eq('subject', 'See you').single()).data!.entry_id).toBe(festivalTicket);
  });
});
