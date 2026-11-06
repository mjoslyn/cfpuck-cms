// An event's tickets on its page (src/render/c/tickets.ts ticketsAfterContent): shown under its content
// when its template has no Tickets or Event details block, once, and not for an event without tickets.
import { describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { renderRequest } from '../src/render/page';
import { createTicket } from '../src/lib/tickets/setup';

const doc = (content: unknown[]) => ({ root: { props: {} }, content, zones: {} });
const text = (id: string, content: string) => ({ type: 'text', props: { id, attrs: { content } } });

describe('event tickets', () => {
  it('puts an event’s tickets under its content when the template has no tickets of its own', async () => {
    const db = siteDb();
    const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
    await db.from('settings').upsert({ key: 'site', value: { ...((data?.value as object) ?? {}), events: { enabled: true } } });
    await db.from('templates').insert([
      { kind: 'template', slug: 'plain-event', title: 'Plain event', content: doc([{ type: 'entry-content', props: { id: 'pc', attrs: {} } }]) },
      { kind: 'template', slug: 'details-event', title: 'Details event', content: doc([{ type: 'event-details', props: { id: 'ed', attrs: {} } }]) },
    ]);
    const { id: ticket } = await createTicket(db, 'Gig tickets', { types: [{ id: 'ga', name: 'General admission', price: 0 }] });
    const fields = { start: '2099-06-01T19:00', end: '2099-06-01T21:00', ticket };
    await db.from('entries').insert([
      { type: 'event', slug: 'gig', title: 'Gig', status: 'publish', template: 'plain-event', fields, content: doc([text('t1', 'Bring a friend.')]) },
      { type: 'event', slug: 'talk', title: 'Talk', status: 'publish', template: 'details-event', fields, content: doc([text('t2', 'A talk.')]) },
      { type: 'event', slug: 'walk', title: 'Walk', status: 'publish', template: 'plain-event', fields: { start: fields.start, end: fields.end }, content: doc([text('t3', 'A walk.')]) },
    ]);

    const gig = (await renderRequest(new URL('http://localhost/event/gig/'), db)).html;
    expect(gig).toContain('Bring a friend.');
    expect(gig).toContain('<section class="c-tickets" id="tickets"');
    expect(gig).toContain('General admission');

    // Event details shows them itself: once.
    const talk = (await renderRequest(new URL('http://localhost/event/talk/'), db)).html;
    expect(talk.match(/id="tickets"/g)).toHaveLength(1);

    const walk = (await renderRequest(new URL('http://localhost/event/walk/'), db)).html;
    expect(walk).toContain('A walk.');
    expect(walk).not.toContain('c-tickets');
  });

  it('shows the ticket a Tickets block names: one event’s, or several under the ticket’s name', async () => {
    const db = siteDb();
    const { id: solo } = await createTicket(db, 'Solo tickets', { types: [{ id: 'a', name: 'Solo seat', price: 0 }] });
    const { id: pass } = await createTicket(db, 'Weekend pass', { types: [{ id: 'p', name: 'Pass', price: 0 }] });
    const at = (d: string) => ({ start: `2099-07-0${d}T19:00`, end: `2099-07-0${d}T21:00` });
    const none = doc([]);
    const { error } = await db.from('entries').insert([
      { type: 'event', content: none, slug: 'solo', title: 'Solo show', status: 'publish', fields: { ...at('1'), ticket: solo } },
      { type: 'event', content: none, slug: 'fri', title: 'Friday night', status: 'publish', fields: { ...at('3'), ticket: pass } },
      { type: 'event', content: none, slug: 'sat', title: 'Saturday night', status: 'publish', fields: { ...at('4'), ticket: pass } },
      { type: 'event', content: none, slug: 'sun', title: 'Sunday draft', status: 'draft', fields: { ...at('5'), ticket: pass } },
      {
        type: 'page', slug: 'buy', title: 'Buy', status: 'publish', template: 'plain-event', fields: {},
        content: doc([
          { type: 'tickets', props: { id: 'tk1', attrs: { ticket: solo } } },
          { type: 'tickets', props: { id: 'tk2', attrs: { ticket: pass } } },
          { type: 'tickets', props: { id: 'tk3', attrs: { ticket: 999999 } } },
        ]),
      },
    ]);
    expect(error).toBeNull();
    const html = (await renderRequest(new URL('http://localhost/buy/'), db)).html;
    expect(html).toContain(`id="tickets-${solo}"`);
    expect(html).toContain('Solo seat');
    expect(html).toContain('>Solo show</a>');
    expect(html).toContain(`id="tickets-${pass}"`);
    expect(html).toContain('<p class="c-tickets__event">Weekend pass</p>');
    expect(html).toContain('>Friday night</a>');
    expect(html).toContain('>Saturday night</a>');
    // A draft event isn't listed; a ticket that isn't there shows nothing.
    expect(html).not.toContain('Sunday draft');
    expect(html.match(/<section class="c-tickets/g)).toHaveLength(2);
  });

  it('shows a paid order in place of the form, with a link back to it; a cancelled one keeps the form', async () => {
    const db = siteDb();
    const { id: ticket } = await createTicket(db, 'Fair tickets', { types: [{ id: 'ga', name: 'Fair admission', price: 0 }] });
    await db.from('entries').insert({ type: 'event', slug: 'fair', title: 'Fair', status: 'publish', template: 'plain-event', content: doc([]), fields: { start: '2099-08-01T10:00', end: '2099-08-01T16:00', ticket } });
    const order = (token: string, status: string) => ({ token, code: token.slice(0, 9), entry_id: ticket, status, provider: 'free', name: 'Mike Example', email: 'mike@example.org', items: [{ type: 'ga', name: 'Fair admission', price: 0, quantity: 1 }], quantity: 1, amount: 0 });
    const paid = 'paidtoken-0123456789abcdefghij';
    const cancelled = 'canctoken-0123456789abcdefghij';
    const { error } = await db.from('ticket_orders').insert([order(paid, 'paid'), order(cancelled, 'cancelled')]);
    expect(error).toBeNull();

    const shown = (await renderRequest(new URL(`http://localhost/event/fair/?order=${paid}`), db)).html;
    expect(shown).toContain('going, Mike!');
    expect(shown).not.toContain('<form');
    expect(shown).toContain('<a href="/event/fair/#tickets">Order more tickets</a>');

    const again = (await renderRequest(new URL(`http://localhost/event/fair/?order=${cancelled}`), db)).html;
    expect(again).toContain('is cancelled');
    expect(again).toContain('<form');
  });
});
