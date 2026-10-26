// updated_at: a write that sets it keeps it (the *_touch triggers would set it to now); others get now.
import { expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';

const db = siteDb();
const old = '2020-01-01T00:00:00.000Z';

it('keeps an updated_at written on purpose, and moves it on an ordinary edit', async () => {
  const { data } = await db.from('entries').insert({ type: 'page', slug: 'dated', title: 'a', updated_at: old }).select('id').single();
  const id = data!.id;
  await db.from('entries').update({ title: 'b', updated_at: old }).eq('id', id);
  expect((await db.from('entries').select('updated_at').eq('id', id).single()).data!.updated_at).toBe(old);
  await db.from('entries').upsert({ id, type: 'page', slug: 'dated', title: 'c', updated_at: old });
  expect((await db.from('entries').select('updated_at').eq('id', id).single()).data!.updated_at).toBe(old);
  await db.from('entries').update({ title: 'd' }).eq('id', id);
  expect((await db.from('entries').select('updated_at').eq('id', id).single()).data!.updated_at).not.toBe(old);
  await db.from('entries').delete().eq('id', id);
});
