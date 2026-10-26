// Regression tests for tickets, forms, sign-in cookies and sync restores.
import { describe, expect, it } from 'vitest';
import { remaining, ticketsOf } from '../src/lib/tickets/config';
import { hiddenFields } from '../src/lib/forms/logic';
import { redirectWith } from '../src/lib/auth';
import { removeAdded } from '../src/lib/sync';
import { siteDb } from '../src/lib/db/site';

describe('tickets', () => {
  it('reads an empty capacity as no limit and 0 as sold out', () => {
    const ev = ticketsOf({ tickets: { capacity: null, types: [{ id: 'a', name: 'A', price: 0, capacity: 0 }, { id: 'b', name: 'B', price: 0, capacity: null }] } });
    expect(remaining(ev, {}).types).toEqual({ a: 0, b: null });
    expect(remaining({ ...ev, capacity: 0 }, {}).total).toBe(0);
  });
});

describe('forms', () => {
  it('treats a field hidden by logic as empty in the rules that read it', () => {
    const form = {
      id: 1,
      title: 'F',
      fields: [
        { id: 'a', type: 'text', label: 'A' },
        { id: 'b', type: 'text', label: 'B', logic: { action: 'show', match: 'all', rules: [{ field: 'a', op: 'is', value: 'yes' }] } },
        { id: 'p', type: 'product', label: 'P', logic: { action: 'show', match: 'all', rules: [{ field: 'b', op: 'is', value: 'premium' }] } },
      ],
    } as any;
    expect([...hiddenFields(form, { a: 'no', b: 'premium' })].sort()).toEqual(['b', 'p']);
    expect([...hiddenFields(form, { a: 'yes', b: 'premium' })]).toEqual([]);
  });
});

describe('sign-in cookies', () => {
  it('sets the readable signed-in hint beside a session cookie, and clears it with one', () => {
    const signIn = redirectWith('/admin/', ['site.session_token=abc.def; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax']).headers.getSetCookie();
    expect(signIn[1]).toBe('site.signed_in=1; Path=/; SameSite=Lax; Max-Age=604800; Secure');
    const signOut = redirectWith('/', ['site.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax']).headers.getSetCookie();
    expect(signOut[1]).toBe('site.signed_in=; Path=/; Max-Age=0; SameSite=Lax');
    expect(redirectWith('/', []).headers.getSetCookie()).toEqual([]);
  });
});

describe('sync restores', () => {
  it('keep added rows other rows came to depend on', async () => {
    const db = siteDb();
    const add = async (table: string, row: Record<string, unknown>) => (await db.from(table).insert(row).select('id').single()).data!.id as number;
    const img = await add('media', { path: 'x/kept.jpg', mime_type: 'image/jpeg' });
    const img2 = await add('media', { path: 'x/gone.jpg', mime_type: 'image/jpeg' });
    const sold = await add('entries', { type: 'post', slug: 'sold', title: 'Sold' });
    const plain = await add('entries', { type: 'post', slug: 'plain', title: 'Plain', featured_media_id: img2 });
    const parent = await add('entries', { type: 'page', slug: 'parent', title: 'Parent' });
    const child = await add('entries', { type: 'page', slug: 'child', title: 'Child', parent_id: parent, featured_media_id: img });
    const term = await add('terms', { taxonomy: 'category', slug: 'used', name: 'Used' });
    const term2 = await add('terms', { taxonomy: 'category', slug: 'unused', name: 'Unused' });
    await db.from('entry_terms').insert([{ entry_id: child, term_id: term }, { entry_id: plain, term_id: term2 }]);
    await db.from('ticket_orders').insert({ entry_id: sold, email: 'a@b.org', name: 'A', status: 'paid', amount: 0, quantity: 1, token: 't', code: 'C1', provider: 'free' });

    await removeAdded(db, 'type', [sold, plain, parent].map(String));
    await removeAdded(db, 'taxonomy', [term, term2].map(String));
    await removeAdded(db, 'files', [img, img2].map(String));
    const has = async (table: string, id: number) => !!(await db.from(table).select('id').eq('id', id).maybeSingle()).data;
    expect({ sold: await has('entries', sold), plain: await has('entries', plain), parent: await has('entries', parent) }).toEqual({ sold: true, plain: false, parent: true });
    expect({ used: await has('terms', term), unused: await has('terms', term2) }).toEqual({ used: true, unused: false });
    expect({ featured: await has('media', img), unfeatured: await has('media', img2) }).toEqual({ featured: true, unfeatured: false });
  });
});
