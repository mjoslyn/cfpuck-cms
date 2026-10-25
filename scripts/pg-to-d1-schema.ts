// The D1 (SQLite) schema from the Postgres one (one-time, phase 5 of docs/cloudflare-migration.md):
// reads the local database's tables, keys, checks, defaults and indexes and writes
// db/migrations/<time>_init.sql. Declared types carry what the query layer needs to know (BOOLEAN,
// JSON_TEXT, ARRAY_TEXT, TIMESTAMPTZ, DATE, UUID) with SQLite's affinities (text stays text).
// Triggers: updated_at kept current unless set; body_text is computed by the query layer.
//   npx tsx --env-file=.env scripts/pg-to-d1-schema.ts
import fs from 'node:fs';
import pg from 'pg';

const out = process.argv[2] ?? 'db/migrations/20261025180000_init.sql';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const q = async (text: string) => (await client.query(text)).rows;

const tables = (await q(`select tablename from pg_tables where schemaname = 'public' order by tablename`)).map((r) => r.tablename as string);
const columns = await q(`
  select table_name, column_name, udt_name, is_nullable, column_default, is_identity, generation_expression
  from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`);
const constraints = await q(`
  select conrelid::regclass::text as t, conname, contype, pg_get_constraintdef(oid) as def
  from pg_constraint where connamespace = 'public'::regnamespace and contype in ('p', 'u', 'f', 'c') order by conrelid::regclass::text, contype, conname`);
const indexes = await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and indexname not in (select conname from pg_constraint) order by tablename, indexname`);
const touched = (await q(`select tgrelid::regclass::text as t from pg_trigger where not tgisinternal and tgname like '%\\_touch'`)).map((r) => r.t as string);
await client.end();

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const UUID = `(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))`;

function type(udt: string): string {
  if (['int8', 'int4', 'int2'].includes(udt)) return 'INTEGER';
  if (udt === 'bool') return 'BOOLEAN';
  if (udt === 'json' || udt === 'jsonb') return 'JSON_TEXT';
  if (udt.startsWith('_')) return 'ARRAY_TEXT';
  if (udt === 'timestamptz' || udt === 'timestamp') return 'TIMESTAMPTZ';
  if (udt === 'date') return 'DATE';
  if (udt === 'uuid') return 'UUID';
  if (udt === 'numeric' || udt.startsWith('float')) return 'REAL';
  if (udt === 'text' || udt === 'varchar') return 'TEXT';
  throw new Error(`no SQLite type for ${udt}`);
}

function defaultOf(d: string | null): string | null {
  if (d === null) return null;
  if (d === 'now()') return NOW;
  if (d === 'gen_random_uuid()') return UUID;
  if (d.startsWith('replace(((gen_random_uuid())::text || (gen_random_uuid())::text)')) return `(lower(hex(randomblob(32))))`;
  if (d.startsWith(`('cs'::text || substr(md5`)) return `('cs' || lower(hex(randomblob(4))))`;
  if (d === 'true') return '1';
  if (d === 'false') return '0';
  if (/^-?\d+$/.test(d)) return d;
  const m = d.match(/^'(.*)'::(text|jsonb|json|text\[\]|bigint\[\])$/s);
  if (m) {
    const v = m[2].endsWith('[]') ? '[]' : m[2].startsWith('json') ? JSON.stringify(JSON.parse(m[1].replace(/''/g, "'"))) : m[1].replace(/''/g, "'");
    return `'${v.replace(/'/g, "''")}'`;
  }
  throw new Error(`no SQLite default for ${d}`);
}

/** A Postgres expression (checks, generated columns, index predicates) in SQLite. */
function expr(e: string): string {
  return e
    .replace(/= ANY \(ARRAY\[([^\]]*)\]\)/g, (_, list) => `IN (${list})`)
    .replace(/'([^']*)'::text/g, "'$1'")
    .replace(/::text/g, '')
    .replace(/ ~~ /g, ' LIKE ')
    .replace(/\(send_time ~ '\^\\d\{2\}:\\d\{2\}\$'\)/, "(send_time GLOB '[0-9][0-9]:[0-9][0-9]')")
    .replace(/"right"\(from_path, 1\)/, 'substr(from_path, -1)')
    .replace(/btrim\(/g, 'trim(');
}

const lines: string[] = [
  '-- The site\'s database on D1 (SQLite), made from the Postgres schema (scripts/pg-to-d1-schema.ts).',
  '-- Times are ISO 8601 text in UTC (as JavaScript writes them), JSON columns are JSON text, arrays',
  '-- are JSON arrays and booleans 0 or 1; the query layer (src/lib/db) reads them back as before.',
  '',
];
for (const t of tables) {
  const cols = columns.filter((c) => c.table_name === t);
  const cons = constraints.filter((c) => c.t === t);
  const pk = cons.find((c) => c.contype === 'p');
  const pkCols = pk ? pk.def.match(/PRIMARY KEY \((.*)\)/)![1].split(', ') : [];
  const body: string[] = [];
  for (const c of cols) {
    const serial = pkCols.length === 1 && pkCols[0] === c.column_name && (c.is_identity === 'YES' || String(c.column_default ?? '').startsWith('nextval('));
    if (serial) {
      body.push(`  ${c.column_name} INTEGER PRIMARY KEY AUTOINCREMENT`);
      continue;
    }
    let d = `  ${c.column_name} ${type(c.udt_name)}`;
    if (c.generation_expression) d += ` GENERATED ALWAYS AS (${expr(c.generation_expression)}) VIRTUAL`;
    else {
      if (c.is_nullable === 'NO') d += ' NOT NULL';
      const def = defaultOf(c.column_default);
      if (def !== null) d += ` DEFAULT ${def}`;
    }
    body.push(d);
  }
  if (pk && !body.some((b) => b.includes('PRIMARY KEY AUTOINCREMENT'))) body.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
  for (const c of cons.filter((c) => c.contype === 'u')) body.push(`  ${c.def}`);
  for (const c of cons.filter((c) => c.contype === 'f')) body.push(`  ${c.def.replace(/REFERENCES (\w+)\(/, 'REFERENCES $1 (')}`);
  for (const c of cons.filter((c) => c.contype === 'c')) body.push(`  ${expr(c.def)}`);
  lines.push(`CREATE TABLE ${t} (\n${body.join(',\n')}\n);`);
  if (touched.includes(t)) {
    lines.push(`CREATE TRIGGER ${t}_touch AFTER UPDATE ON ${t} FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at\nBEGIN\n  UPDATE ${t} SET updated_at = ${NOW} WHERE rowid = NEW.rowid;\nEND;`);
  }
  lines.push('');
}
for (const i of indexes) {
  const def: string = i.indexdef;
  if (/USING gin/.test(def)) continue;
  let s = def.replace(/ ON public\./, ' ON ').replace(/ USING btree/, '');
  s = s.replace(/\(\(\(payment ->> '(\w+)'::text\)\)\)/, "(json_extract(payment, '$.$1'))").replace(/WHERE \(payment \? '(\w+)'::text\)/, "WHERE json_extract(payment, '$.$1') IS NOT NULL");
  s = s.replace(/WHERE (.*)$/, (_, w) => `WHERE ${expr(w)}`);
  lines.push(`${s};`);
}
fs.mkdirSync('db/migrations', { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`${out}: ${tables.length} tables, ${indexes.length} indexes`);
