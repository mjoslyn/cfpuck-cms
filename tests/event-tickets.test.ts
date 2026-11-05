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
});
