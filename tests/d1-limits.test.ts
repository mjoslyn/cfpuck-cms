// The query layer's statements stay inside D1's limits (tests/setup/d1-limits.ts checks every one).
import { describe, expect, it } from 'vitest';
import { limitProblems } from './setup/d1-limits';
import { siteDb } from '../src/lib/db/site';
import { SCHEMA } from '../src/lib/db/schema';
import { Loader, PUBLIC_SCOPE } from '../src/lib/data';

const pairs = (n: number) => Array.from({ length: n }, (_, i) => `'k${i}', ${i}`).join(', ');

describe('the limits check', () => {
  it('counts a function’s arguments, not lists', () => {
    expect(limitProblems(`SELECT json_object(${pairs(16)})`)).toEqual([]);
    expect(limitProblems(`SELECT json_object(${pairs(17)})`)).toEqual(['json_object() with 34 arguments (D1 takes 32)']);
    expect(limitProblems(`SELECT 1 WHERE x IN (${Array.from({ length: 50 }, (_, i) => i).join(', ')})`)).toEqual([]);
    expect(limitProblems(`INSERT INTO t (${Array.from({ length: 40 }, (_, i) => `c${i}`).join(', ')}) VALUES (1)`)).toEqual([]);
  });

  it('measures LIKE and GLOB patterns, bound or written', () => {
    const long = 'x'.repeat(51);
    expect(limitProblems('SELECT 1 WHERE a LIKE ?1', [long])).toHaveLength(1);
    expect(limitProblems('SELECT 1 WHERE lower(a) LIKE lower(?1)', [long])).toHaveLength(1);
    expect(limitProblems(`SELECT 1 WHERE a GLOB '${long}'`)).toHaveLength(1);
    expect(limitProblems('SELECT 1 WHERE a LIKE ?1', ['x'.repeat(50)])).toEqual([]);
  });

  it('counts bound values', () => {
    expect(limitProblems('SELECT ?', Array(101).fill(1))).toEqual(['101 bound values (D1 takes 100)']);
  });
});

describe('the query layer under D1’s limits', () => {
  const db = siteDb();

  it('reads every column of every table', async () => {
    for (const table of Object.keys(SCHEMA)) {
      const { error } = await db.from(table).select('*').limit(1);
      expect(error, table).toBeNull();
    }
  });

  it('keeps every column, in order, past 16 of them', async () => {
    const { data, error } = await db.from('campaigns').insert({ name: 'wide', subject: 's' }).select('*').single();
    expect(error).toBeNull();
    expect(Object.keys(data as object)).toEqual(Object.keys(SCHEMA.campaigns.columns));
    await db.from('campaigns').delete().eq('id', (data as any).id);
  });

  const long = 'a-long-address-that-goes-well-past-fifty-bytes-of-like-pattern';
  const slugs = async (q: PromiseLike<{ data: any; error: any }>) => {
    const { data, error } = await q;
    expect(error).toBeNull();
    return (data as { slug: string }[]).map((r) => r.slug).sort();
  };

  it('matches like and ilike patterns of any length', async () => {
    const rows = [long, `${long}-2`, '100%_sure', 'abc', 'aXc-end'].map((slug) => ({ type: 'post', slug, title: slug.toUpperCase(), status: 'publish' }));
    const { error } = await db.from('entries').insert(rows);
    expect(error).toBeNull();
    const e = () => db.from('entries').select('slug').eq('type', 'post');
    expect(await slugs(e().like('slug', `${long}%`))).toEqual([long, `${long}-2`]);
    expect(await slugs(e().like('slug', long))).toEqual([long]);
    expect(await slugs(e().like('slug', `%${long.slice(5)}`))).toEqual([long]);
    expect(await slugs(e().like('slug', `%${long.slice(3, 60)}%`))).toEqual([long, `${long}-2`]);
    expect(await slugs(e().like('slug', 'ABC%'))).toEqual([]);
    expect(await slugs(e().like('slug', '100\\%\\_%'))).toEqual(['100%_sure']);
    expect(await slugs(e().like('slug', 'a_c%'))).toEqual(['aXc-end', 'abc']);
    expect(await slugs(e().like('slug', 'ab*'))).toEqual(['abc']);
    expect(await slugs(e().ilike('title', `${long.toUpperCase()}%`))).toEqual([long, `${long}-2`]);
    expect(await slugs(e().or('title.ilike.%axc-e%,slug.ilike.abc'))).toEqual(['aXc-end', 'abc']);
    await db.from('entries').delete().eq('type', 'post');
  });

  it('loads an entry and a listing', async () => {
    const { error } = await db.from('entries').insert({ type: 'post', slug: long, title: 'Long', status: 'publish', published_at: new Date().toISOString() });
    expect(error).toBeNull();
    const loader = new Loader(db, undefined, PUBLIC_SCOPE);
    expect((await loader.entry('post', long))?.slug).toBe(long);
    expect((await loader.query({ postType: 'post', perPage: 10 } as any)).total).toBe(1);
    await db.from('entries').delete().eq('type', 'post');
  });
});
