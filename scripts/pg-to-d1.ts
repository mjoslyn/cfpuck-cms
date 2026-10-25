// Copies a site's data from its Postgres database (DATABASE_URL: the hosted Supabase project, or the
// local stack) into D1, once, when the site moves (docs/cloudflare-migration.md, "Moving an existing
// site"). Every table D1 has (src/lib/db/schema.ts) is read whole and written as D1 keeps it: booleans
// as 1 and 0, JSON and arrays as JSON text, times as ISO strings in UTC with milliseconds, a contact's
// address hash. Generated columns are left to D1.
//   npx tsx --env-file=.env scripts/pg-to-d1.ts [--replace]          # into the local D1 (or the remote one, see src/lib/db/d1.ts)
//   npx tsx --env-file=.env scripts/pg-to-d1.ts --out data.sql       # a file for: npx wrangler d1 execute DB --remote --file data.sql
// The target must be empty (its migrations applied); --replace empties it first.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { SCHEMA } from '../src/lib/db/schema';
import { database } from '../src/lib/db/d1';

const args = process.argv.slice(2);
const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const replace = args.includes('--replace');

// Times and dates as Postgres writes them, not as Dates in the machine's time zone.
for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, (v: string) => v);
pg.types.setTypeParser(20, (v: string) => Number(v));
pg.types.setTypeParser(1700, (v: string) => Number(v));

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const pgColumns = new Map<string, Set<string>>();
for (const r of (await client.query(`select table_name, column_name from information_schema.columns where table_schema = 'public'`)).rows) {
  if (!pgColumns.has(r.table_name)) pgColumns.set(r.table_name, new Set());
  pgColumns.get(r.table_name)!.add(r.column_name);
}

/** Tables with those they point to first (self-references aside: foreign keys are deferred). */
function ordered(): string[] {
  const out: string[] = [];
  const visit = (t: string, path: Set<string>) => {
    if (out.includes(t) || path.has(t)) return;
    path.add(t);
    for (const [, ref] of SCHEMA[t].fks) if (ref !== t && SCHEMA[ref]) visit(ref, path);
    out.push(t);
  };
  for (const t of Object.keys(SCHEMA).sort()) visit(t, new Set());
  return out;
}

function iso(v: string): string {
  // '2026-10-25 18:00:00.123456+00' and the like.
  const t = v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const d = new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`not a time: ${v}`);
  return d.toISOString();
}

function convert(type: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (type === 'bool') return v ? 1 : 0;
  if (type === 'jsonb' || type.startsWith('_')) return JSON.stringify(v);
  if (type === 'timestamptz') return iso(String(v));
  if (type === 'date') return String(v).slice(0, 10);
  return v;
}

/** A value as SQL text. Long strings are split so no statement passes D1's limit (100 KB). */
const CHUNK = 40_000;
const lit = (v: unknown): string => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const statements: string[] = [];
const counts: Record<string, number> = {};
for (const table of ordered()) {
  const schema = SCHEMA[table];
  const have = pgColumns.get(table);
  if (!have) {
    console.log(`${table}: not in Postgres, left empty`);
    continue;
  }
  const cols = Object.keys(schema.columns).filter((c) => !schema.generated.includes(c) && (have.has(c) || (table === 'contacts' && c === 'email_hash')));
  const read = cols.filter((c) => have.has(c));
  const order = schema.pk.length ? ` order by ${schema.pk.map((k) => `"${k}"`).join(', ')}` : '';
  const { rows } = await client.query(`select ${read.map((c) => `"${c}"`).join(', ')} from public."${table}"${order}`);
  counts[table] = rows.length;
  for (const row of rows) {
    if (table === 'contacts') row.email_hash = createHash('sha256').update(String(row.email).trim().toLowerCase()).digest('hex');
    const values = cols.map((c) => convert(schema.columns[c], row[c]));
    const long: [string, string][] = [];
    const first = values.map((v, i) => {
      if (typeof v === 'string' && v.length > CHUNK) {
        long.push([cols[i], v.slice(CHUNK)]);
        return lit(v.slice(0, CHUNK));
      }
      return lit(v);
    });
    statements.push(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${first.join(', ')});`);
    if (long.length) {
      if (!schema.pk.length) throw new Error(`${table}: a long value in a table without a key`);
      const where = schema.pk.map((k) => `"${k}" = ${lit(convert(schema.columns[k], row[k]))}`).join(' AND ');
      for (const [col, rest] of long) for (let i = 0; i < rest.length; i += CHUNK) statements.push(`UPDATE "${table}" SET "${col}" = "${col}" || ${lit(rest.slice(i, i + CHUNK))} WHERE ${where};`);
    }
  }
}
await client.end();

if (outFile) {
  // Foreign keys are checked when the file's work is done, so rows can come in any order.
  fs.writeFileSync(outFile, ['PRAGMA defer_foreign_keys = on;', ...statements, ''].join('\n'));
  console.log(`${outFile}: ${statements.length} statements`, counts);
  process.exit(0);
}

const db = await database();
const existing = Number(((await db.prepare('SELECT count(*) AS n FROM entries').all<{ n: number }>()).results[0]).n);
if (existing && !replace) throw new Error('The database already has entries: pass --replace to empty it first');
const empty = replace ? [...ordered()].reverse().map((t) => db.prepare(`DELETE FROM "${t}"`)) : [];
// One batch: all or none, foreign keys checked at the end.
await db.batch([db.prepare('PRAGMA defer_foreign_keys = on'), ...empty, ...statements.map((s) => db.prepare(s))]);
console.log('copied', counts);
