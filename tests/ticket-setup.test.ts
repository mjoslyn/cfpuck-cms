// An event's ticket setup is saved from the Tickets admin (src/lib/tickets/setup.ts): into the live event
// and its changes kept aside, keeping updated_at; the editor's saves keep the stored setup (keepTickets).
import { describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { attachTickets, detachTickets, keepTickets, saveTicketSetup, sharingEvents, storedTickets } from '../src/lib/tickets/setup';
import { renderRequest } from '../src/render/page';

describe('ticket setup', () => {
  it('keeps the stored setup whatever an editor save brings', () => {
    const stored = { tickets: { types: [{ id: 'a', name: 'Adult', price: 1000 }] } };
    expect(keepTickets({ cost: '$10', tickets: { types: [] } }, stored)).toEqual({ cost: '$10', tickets: stored.tickets });
    expect(keepTickets({ cost: '$10', tickets: { types: [{ id: 'old' }] } }, {})).toEqual({ cost: '$10' });
    expect(storedTickets({ types: [] })).toBeUndefined();
  });

  it('saves into the live event and its changes kept aside, keeping updated_at', async () => {
    const db = siteDb();
    const { data: ev } = await db.from('entries').insert({ type: 'event', slug: 'fair', title: 'Fair', status: 'publish', fields: { cost: 'Free' }, content: { content: [], root: { props: {} } } }).select('id, updated_at').single();
    await db.from('entry_drafts').insert({ entry_id: ev!.id, draft: { entry: { title: 'Fair', fields: { cost: 'Free', note: 'draft' } } } });
    expect(await saveTicketSetup(db, ev!.id, { types: [{ id: 'ga', name: 'General admission', price: 0 }], waitlist: 'auto' })).toBeNull();
    const { data: after } = await db.from('entries').select('fields, updated_at').eq('id', ev!.id).single();
    expect(after!.updated_at).toBe(ev!.updated_at);
    expect(after!.fields.cost).toBe('Free');
    expect(after!.fields.tickets.types[0]).toMatchObject({ id: 'ga', name: 'General admission' });
    expect(after!.fields.tickets.waitlist).toBe('auto');
    expect(after!.fields.tickets.enabled).toBeUndefined();
    const { data: kept } = await db.from('entry_drafts').select('draft').eq('entry_id', ev!.id).single();
    expect(kept!.draft.entry.fields).toMatchObject({ note: 'draft', tickets: { types: [{ id: 'ga' }] } });

    // Removing every type and question takes the setup away.
    expect(await saveTicketSetup(db, ev!.id, { types: [] })).toBeNull();
    const { data: off } = await db.from('entries').select('fields').eq('id', ev!.id).single();
    expect(off!.fields.tickets).toBeUndefined();
    expect(await saveTicketSetup(db, 999999, { types: [] })).toBe('No such event.');
  });

  it('shares one event’s tickets with others, sold from one pool on their pages', async () => {
    const db = siteDb();
    const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
    await db.from('settings').upsert({ key: 'site', value: { ...((data?.value as object) ?? {}), events: { enabled: true } } });
    await db.from('templates').insert([
      { kind: 'template', slug: 'pc-event', title: 'Content only', content: { root: { props: {} }, content: [{ type: 'entry-content', props: { id: 'pc', attrs: {} } }], zones: {} } },
      { kind: 'template', slug: 'ed-event', title: 'Details', content: { root: { props: {} }, content: [{ type: 'event-details', props: { id: 'ed', attrs: {} } }], zones: {} } },
    ]);
    const content = { content: [], root: { props: {} } };
    const dates = { start: '2099-07-01T18:00', end: '2099-07-01T22:00' };
    const { data: rows } = await db.from('entries').insert([
      { type: 'event', slug: 'festival', title: 'Festival', status: 'publish', template: 'pc-event', fields: { ...dates, tickets: { types: [{ id: 'pass', name: 'Festival pass', price: 0 }] } }, content },
      { type: 'event', slug: 'concert', title: 'Concert', status: 'publish', template: 'pc-event', fields: { ...dates }, content },
      { type: 'event', slug: 'talk-two', title: 'Talk', status: 'publish', template: 'ed-event', fields: { ...dates }, content },
      { type: 'event', slug: 'market', title: 'Market', status: 'publish', template: 'pc-event', fields: { ...dates, tickets: { types: [{ id: 'stall', name: 'Stall', price: 0 }] } }, content },
    ]).select('id, slug');
    const id = (slug: string) => rows!.find((r) => r.slug === slug)!.id;

    expect(await attachTickets(db, id('concert'), id('concert'))).toBe('Choose another event.');
    expect(await attachTickets(db, id('concert'), id('talk-two'))).toBe('That event has no tickets to share.');
    expect(await attachTickets(db, id('concert'), id('festival'))).toBeNull();
    expect(await attachTickets(db, id('talk-two'), id('festival'))).toBeNull();
    // No chains, and the festival keeps its own while others share it.
    expect(await attachTickets(db, id('talk-two'), id('concert'))).toMatch(/shares another/);
    expect(await attachTickets(db, id('festival'), id('market'))).toMatch(/Other events share/);
    expect((await sharingEvents(db, id('festival'))).map((e) => e.title)).toEqual(['Concert', 'Talk']);
    expect(await saveTicketSetup(db, id('concert'), { types: [] })).toMatch(/shares another/);

    // The concert's page sells the festival's tickets, named, under the festival's anchor.
    const concert = (await renderRequest(new URL('http://localhost/event/concert/'), db)).html;
    expect(concert).toContain(`id="tickets-${id('festival')}"`);
    expect(concert).toContain('Festival pass');
    expect(concert).toContain(`data-event="${id('festival')}"`);
    // With Event details, once, and its sidebar links to it.
    const talk = (await renderRequest(new URL('http://localhost/event/talk-two/'), db)).html;
    expect(talk.match(new RegExp(`id="tickets-${id('festival')}"`, 'g'))).toHaveLength(1);
    expect(talk).toContain(`href="#tickets-${id('festival')}">Get tickets`);

    expect(await detachTickets(db, id('concert'))).toBeNull();
    const after = (await renderRequest(new URL('http://localhost/event/concert/'), db)).html;
    expect(after).not.toContain('c-tickets');
    // The editor's saves keep the sharing.
    expect(keepTickets({ cost: '1' }, { tickets_from: 7 })).toEqual({ cost: '1', tickets_from: 7 });
  });
});
