// Runs QuerySpecs (src/lib/db/query.ts) on D1 (SQLite), server only. A read compiles to one statement
// whose rows are JSON objects built in SQLite (json_object), typed as the code has always read them:
// booleans as true/false, JSON columns and arrays as values, embedded relations as objects or arrays
// (their keys in jsonb's order, as PostgREST had them). Identifiers are checked against the schema
// (src/lib/db/schema.ts) and values are bound (?1, ?2...); lists and written rows go as one JSON value
// each, so a query stays inside D1's 100 bound values. Times are ISO strings in UTC. For roles other than
// the server's, the policies (src/lib/db/policies.ts) decide what a query sees and may write; D1 has no
// transactions to roll a refused write back, so rows are checked before they are written.
import { SCHEMA, type TableSchema } from './schema';
import { shape, type CallSpec, type DbError, type Executor, type Filter, type Order, type QuerySpec, type Result, type Scoped } from './query';
import { policyFor, type Ctx, type Rule } from './policies';
import { callFunction } from './functions';
import { database, type D1Database } from './d1';
import { bodyText } from '../content/body-text';
import { createHash } from 'node:crypto';

export class SqlError extends Error {
  constructor(readonly error: DbError) {
    super(error.message);
  }
}

const fail = (message: string, code = 'PGRST100'): never => {
  throw new SqlError({ message, code, details: null, hint: null });
};

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

function tableOf(name: string): TableSchema {
  return SCHEMA[name] ?? fail(`Could not find the table 'public.${name}' in the schema cache`, 'PGRST205');
}

/** Bound values, numbered ?1, ?2... in the order they are added. */
class Params {
  values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v === undefined ? null : v);
    return `?${this.values.length}`;
  }
}

// ----- types -----

const isBool = (t: string) => t === 'bool';
const isJson = (t: string) => t === 'json' || t === 'jsonb' || t.startsWith('_');
const isTime = (t: string) => t === 'timestamptz' || t === 'timestamp';
const isInt = (t: string) => t === 'int8' || t === 'int4' || t === 'int2';
const isText = (t: string) => t === 'text' || t === 'uuid' || t === 'date' || isTime(t);

/** A time as the database keeps it: ISO 8601 in UTC with milliseconds. Anything else as it is. */
function isoTime(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return v;
}

/** A Postgres array literal ({a,b}) or JSON, as an array or value. */
function jsonValue(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    const m = v.match(/^\{(.*)\}$/s);
    if (m) return m[1] === '' ? [] : m[1].split(',').map((x) => x.trim().replace(/^"(.*)"$/, '$1'));
    return v;
  }
}

/** A value as SQLite compares it with a column of `type`. */
function sqlValue(type: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (isBool(type)) return v === true || v === 'true' || v === 1 || v === '1' ? 1 : v === false || v === 'false' || v === 0 || v === '0' ? 0 : v;
  if (isTime(type)) return isoTime(v);
  if (isInt(type) && typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  if (type === 'text' && (typeof v === 'number' || typeof v === 'boolean')) return String(v);
  if (isJson(type)) return typeof v === 'string' ? v : JSON.stringify(v);
  return v;
}

/** A value to write to a column of `type`. */
function storedValue(type: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (isJson(type)) return JSON.stringify(type.startsWith('_') ? jsonValue(v) : v);
  return sqlValue(type, v);
}

/** A column's stored value as the code reads it. */
function readValue(type: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (isBool(type)) return v === 1 || v === true || v === '1';
  if (isJson(type) && typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

// ----- columns and JSON paths -----

interface ColumnRef { column: string; steps: { op: '->' | '->>'; key: string }[]; cast?: string }

const CASTS = new Set(['text', 'int', 'int4', 'int8', 'bigint', 'numeric', 'boolean', 'bool', 'date', 'timestamptz', 'json', 'jsonb']);

function parseRef(ref: string): ColumnRef {
  let text = ref.trim();
  let cast: string | undefined;
  const castAt = text.lastIndexOf('::');
  if (castAt > 0) {
    cast = text.slice(castAt + 2);
    text = text.slice(0, castAt);
    if (!CASTS.has(cast)) fail(`Unsupported cast: ${cast}`);
  }
  const parts = text.split(/(->>|->)/);
  const steps: ColumnRef['steps'] = [];
  for (let i = 1; i < parts.length; i += 2) steps.push({ op: parts[i] as '->' | '->>', key: parts[i + 1] });
  return { column: parts[0], steps, cast };
}

/** A JSON path ($."a"[0]) for SQLite's JSON functions. */
const jsonPath = (keys: string[]) => '$' + keys.map((k) => (/^\d+$/.test(k) ? `[${k}]` : `."${k.replace(/["\\]/g, '\\$&')}"`)).join('');

/** A JSON value's text, as Postgres's ->> gave it ('true', '12', the JSON of an object). */
const jsonText = (doc: string, path: string) =>
  `(CASE json_type(${doc}, ${lit(path)}) WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN NULL WHEN 'object' THEN json_extract(${doc}, ${lit(path)}) WHEN 'array' THEN json_extract(${doc}, ${lit(path)}) ELSE CAST(json_extract(${doc}, ${lit(path)}) AS TEXT) END)`;

/** The SQL for a column reference on a table alias, and its type. */
function refSql(alias: string, table: string, ref: ColumnRef): { sql: string; type: string } {
  const schema = tableOf(table);
  const base = schema.columns[ref.column] ?? fail(`column ${table}.${ref.column} does not exist`, '42703');
  let sql = `${alias}.${ident(ref.column)}`;
  let type = base;
  if (ref.steps.length) {
    const path = jsonPath(ref.steps.map((s) => s.key));
    if (ref.steps[ref.steps.length - 1].op === '->>') {
      sql = jsonText(sql, path);
      type = 'text';
    } else {
      sql = `(${sql} -> ${lit(path)})`;
      type = 'jsonb';
    }
  }
  if (ref.cast) {
    const c = ref.cast;
    if (c === 'text') [sql, type] = [`CAST(${sql} AS TEXT)`, 'text'];
    else if (['int', 'int4', 'int8', 'bigint'].includes(c)) [sql, type] = [`CAST(${sql} AS INTEGER)`, 'int8'];
    else if (c === 'numeric') [sql, type] = [`CAST(${sql} AS REAL)`, 'numeric'];
    else if (c === 'json' || c === 'jsonb') [sql, type] = [`json(${sql})`, 'jsonb'];
    else type = c === 'boolean' ? 'bool' : c;
  }
  return { sql, type };
}

const outputName = (ref: ColumnRef) => (ref.steps.length ? ref.steps[ref.steps.length - 1].key : ref.column);

/** An expression as a value inside json_object: booleans as JSON booleans, JSON as JSON. */
function outValue(sql: string, type: string): string {
  if (isBool(type)) return `(CASE WHEN ${sql} IS NULL THEN NULL WHEN ${sql} THEN json('true') ELSE json('false') END)`;
  if (isJson(type)) return `json(${sql})`;
  return sql;
}

/** A row as a JSON object. D1 takes at most 32 arguments per SQL function, so the first 16 pairs are
 * json_object's and the rest are added 15 at a time by json_insert, which keeps their order. */
function jsonObject(pairs: [string, string][]): string {
  let sql = `json_object(${pairs.slice(0, 16).map(([k, v]) => `${lit(k)}, ${v}`).join(', ')})`;
  for (let i = 16; i < pairs.length; i += 15) {
    const more = pairs.slice(i, i + 15).map(([k, v]) => `${lit(`$."${k.includes('"') ? fail(`Unsupported key: ${k}`) : k}"`)}, ${v}`);
    sql = `json_insert(${sql}, ${more.join(', ')})`;
  }
  return sql;
}

const byJsonbOrder = ([a]: [string, string], [b]: [string, string]) => {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return x.length - y.length;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

// ----- select strings -----

type Item =
  | { kind: 'star' }
  | { kind: 'count' }
  | { kind: 'col'; alias?: string; ref: ColumnRef }
  | { kind: 'embed'; alias?: string; name: string; hint?: string; inner: boolean; items: Item[] };

function splitItems(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const EMBED = /^(?:(\w+):)?(\w+)((?:!\w+)*)\((.*)\)$/s;

export function parseSelect(text: string): Item[] {
  const clean = text.replace(/\s+/g, '');
  if (!clean) return [{ kind: 'star' }];
  return splitItems(clean).map((token): Item => {
    if (token === '*') return { kind: 'star' };
    if (token === 'count' || token === 'count()') return { kind: 'count' };
    const embed = token.match(EMBED);
    if (embed) {
      const marks = embed[3].split('!').filter(Boolean);
      return { kind: 'embed', alias: embed[1], name: embed[2], hint: marks.find((m) => m !== 'inner' && m !== 'left'), inner: marks.includes('inner'), items: parseSelect(embed[4]) };
    }
    const aliased = token.match(/^(\w+):(.+)$/);
    return aliased ? { kind: 'col', alias: aliased[1], ref: parseRef(aliased[2]) } : { kind: 'col', ref: parseRef(token) };
  });
}

// ----- relations -----

interface Relation { table: string; many: boolean; on: (parent: string, child: string) => string }

function relationOf(table: string, name: string, hint?: string): Relation {
  const parent = tableOf(table);
  const child = tableOf(name);
  const join = (a: string, ac: string[], b: string, bc: string[]) => ac.map((c, i) => `${a}.${ident(c)} = ${b}.${ident(bc[i])}`).join(' AND ');
  const found: Relation[] = [];
  for (const [cols, ref, refCols] of parent.fks) {
    if (ref !== name || (hint && !cols.includes(hint))) continue;
    found.push({ table: name, many: false, on: (p, c) => join(c, refCols, p, cols) });
  }
  for (const [cols, ref, refCols] of child.fks) {
    if (ref !== table || (hint && !cols.includes(hint)) || name === table) continue;
    found.push({ table: name, many: true, on: (p, c) => join(c, cols, p, refCols) });
  }
  if (found.length === 0) fail(`Could not find a relationship between '${table}' and '${name}' in the schema cache`, 'PGRST200');
  if (found.length > 1) fail(`More than one relationship was found for '${table}' and '${name}'`, 'PGRST201');
  return found[0];
}

// ----- conditions -----

type LikePart = { lit: string } | '%' | '_';

/** A LIKE pattern as literal runs and wildcards (a backslash escapes the next character). */
function likeParts(pattern: string): LikePart[] {
  const parts: LikePart[] = [];
  for (let i = 0; i < pattern.length; i++) {
    let ch = pattern[i];
    if (ch === '%' || ch === '_') {
      if (!(ch === '%' && parts.at(-1) === '%')) parts.push(ch);
      continue;
    }
    if (ch === '\\' && i + 1 < pattern.length) ch = pattern[++i];
    const last = parts.at(-1);
    if (typeof last === 'object') last.lit += ch;
    else parts.push({ lit: ch });
  }
  return parts;
}

/**
 * A LIKE (case-sensitive, as Postgres's) or ILIKE condition. D1 refuses LIKE and GLOB patterns over 50
 * bytes, so the shapes the code uses (exact, prefix%, %contains%, %suffix) are compared as strings,
 * which takes any length; other patterns go to LIKE (ILIKE) or GLOB (LIKE).
 */
function likeSql(col: string, pattern: string, insensitive: boolean, params: Params): string {
  const parts = likeParts(pattern);
  const text = (p: LikePart | undefined) => (typeof p === 'object' ? p.lit : null);
  const c = insensitive ? `lower(${col})` : col;
  const v = (s: string) => (insensitive ? `lower(${params.add(s)})` : params.add(s));
  const chars = (s: string) => [...s].length;
  const [a, b, d] = parts;
  if (parts.length === 0) return `${col} = ''`;
  if (parts.length === 1 && a === '%') return `${col} IS NOT NULL`;
  if (parts.length === 1 && text(a) !== null) return `${c} = ${v(text(a)!)}`;
  if (parts.length === 2 && text(a) !== null && b === '%') return `substr(${c}, 1, ${chars(text(a)!)}) = ${v(text(a)!)}`;
  if (parts.length === 2 && a === '%' && text(b) !== null) return `substr(${c}, -${chars(text(b)!)}) = ${v(text(b)!)}`;
  if (parts.length === 3 && a === '%' && text(b) !== null && d === '%') return `instr(${c}, ${v(text(b)!)}) > 0`;
  return insensitive ? `lower(${col}) LIKE lower(${params.add(pattern)}) ESCAPE '\\'` : `${col} GLOB ${params.add(globOf(pattern))}`;
}

/** LIKE's pattern as GLOB's, which is case-sensitive as LIKE was in Postgres. */
function globOf(like: string): string {
  let out = '';
  for (let i = 0; i < like.length; i++) {
    const ch = like[i];
    if (ch === '\\' && i + 1 < like.length) {
      const next = like[++i];
      out += next === '*' || next === '?' || next === '[' ? `[${next}]` : next;
    } else if (ch === '%') out += '*';
    else if (ch === '_') out += '?';
    else if (ch === '*' || ch === '?' || ch === '[') out += `[${ch}]`;
    else out += ch;
  }
  return out;
}

/** `doc` (JSON text) contains `value`, as jsonb's @> did for arrays of values and objects of them. */
function containsSql(doc: string, value: unknown, params: Params): string {
  if (Array.isArray(value)) {
    if (!value.length) return `json_type(${doc}) = 'array'`;
    return `NOT EXISTS (SELECT 1 FROM json_each(${params.add(JSON.stringify(value))}) AS v WHERE NOT EXISTS (SELECT 1 FROM json_each(${doc}) AS c WHERE c.value IS v.value))`;
  }
  if (value && typeof value === 'object') {
    const parts = Object.entries(value).map(([k, v]) => {
      const path = jsonPath([k]);
      if (v !== null && typeof v === 'object') return containsSql(`json_extract(${doc}, ${lit(path)})`, v, params);
      if (v === null) return `json_type(${doc}, ${lit(path)}) = 'null'`;
      return `json_extract(${doc}, ${lit(path)}) = ${params.add(typeof v === 'boolean' ? (v ? 1 : 0) : v)}`;
    });
    return parts.length ? `(${parts.join(' AND ')})` : `json_type(${doc}) = 'object'`;
  }
  return `json(${doc}) = json(${params.add(JSON.stringify(value))})`;
}

function conditionSql(f: Filter, alias: string, table: string, params: Params): string {
  let sql: string;
  if ('any' in f) sql = f.any.length ? `(${f.any.map((x) => conditionSql(x, alias, table, params)).join(' OR ')})` : 'false';
  else if ('all' in f) sql = f.all.length ? `(${f.all.map((x) => conditionSql(x, alias, table, params)).join(' AND ')})` : 'true';
  else if (f.op === 'fts') {
    // The table's FTS5 index, keyed by its rows' id; one column of it with FTS5's column filter.
    const fts = tableOf(table).fts ?? fail(`'${table}' has no full-text index`, '42883');
    if (f.col !== 'fts' && !fts.columns.includes(f.col)) fail(`'${f.col}' is not in the full-text index of '${table}'`, '42703');
    const query = f.col === 'fts' ? String(f.value) : `{${f.col}} : (${String(f.value)})`;
    sql = `${alias}.${ident(fts.key)} IN (SELECT rowid FROM ${ident(fts.table)} WHERE ${ident(fts.table)} MATCH ${params.add(query)})`;
  } else {
    const { sql: col, type } = refSql(alias, table, parseRef(f.col));
    const v = f.value;
    const json = isJson(type);
    const cmp = (op: string) => (json ? `json(${col}) ${op} json(${params.add(sqlValue(type, v))})` : `${col} ${op} ${params.add(sqlValue(type, v))}`);
    switch (f.op) {
      case 'eq': sql = cmp('='); break;
      case 'neq': sql = cmp('<>'); break;
      case 'gt': sql = cmp('>'); break;
      case 'gte': sql = cmp('>='); break;
      case 'lt': sql = cmp('<'); break;
      case 'lte': sql = cmp('<='); break;
      case 'like': sql = likeSql(col, String(v).replace(/\*/g, '%'), false, params); break;
      case 'ilike': sql = likeSql(col, String(v).replace(/\*/g, '%'), true, params); break;
      case 'is': sql = `${col} IS ${v === null ? 'NULL' : v === true ? 'TRUE' : v === false ? 'FALSE' : fail(`Unsupported is value: ${v}`)}`; break;
      case 'in': {
        const list = Array.isArray(v) ? v : fail('in() needs a list');
        sql = list.length ? `${col} IN (SELECT value FROM json_each(${params.add(JSON.stringify(list.map((x) => (json ? x : sqlValue(type, x)))))}))` : 'false';
        break;
      }
      case 'cs':
        sql = containsSql(col, jsonValue(v), params);
        break;
      case 'cd': {
        const list = jsonValue(v);
        sql = Array.isArray(list)
          ? `NOT EXISTS (SELECT 1 FROM json_each(${col}) AS c WHERE NOT EXISTS (SELECT 1 FROM json_each(${params.add(JSON.stringify(list))}) AS v WHERE v.value IS c.value))`
          : fail('cd needs a list');
        break;
      }
    }
  }
  return f.not ? `NOT ${sql}` : sql;
}

// ----- reads -----

interface Scope {
  spec: Pick<QuerySpec, 'filters' | 'order'>;
  params: Params;
  ctx: Ctx;
  counter: { n: number };
}

const scopedTo = <T>(list: Scoped<T>[], path: string) => list.filter((s) => s.path === path).map((s) => s.item);

function whereFor(table: string, alias: string, path: string, scope: Scope, extra: string[] = []): string[] {
  const conds = [...extra, ...scopedTo(scope.spec.filters, path).map((f) => conditionSql(f, alias, table, scope.params))];
  const read = policyFor(table, 'select', scope.ctx);
  if (read === false) conds.push('false');
  else if (read !== true) conds.push(conditionSql(read, alias, table, scope.params));
  return conds;
}

/** ORDER BY as Postgres sorted: nulls last going up and first going down, text without regard to case. */
function orderSql(orders: Order[], alias: string, table: string): string {
  if (!orders.length) return '';
  const parts = orders.map((o) => {
    const { sql, type } = refSql(alias, table, parseRef(o.col));
    const nullsFirst = o.nullsFirst ?? !o.ascending;
    return `${sql}${type === 'text' ? ' COLLATE NOCASE' : ''} ${o.ascending ? 'ASC' : 'DESC'} NULLS ${nullsFirst ? 'FIRST' : 'LAST'}`;
  });
  return ` ORDER BY ${parts.join(', ')}`;
}

/** The json_object pairs for `items` on a table. */
function selectPairs(items: Item[], table: string, alias: string, path: string, scope: Scope): [string, string][] {
  const pairs: [string, string][] = [];
  for (const item of items) {
    if (item.kind === 'star') for (const [c, t] of Object.entries(tableOf(table).columns)) pairs.push([c, outValue(`${alias}.${ident(c)}`, t)]);
    else if (item.kind === 'count') pairs.push(['count', 'count(*)']);
    else if (item.kind === 'col') {
      const { sql, type } = refSql(alias, table, item.ref);
      pairs.push([item.alias ?? outputName(item.ref), outValue(sql, type)]);
    } else {
      const rel = relationOf(table, item.name, item.hint);
      const key = item.alias ?? item.name;
      const childPath = path ? `${path}.${key}` : key;
      const child = `t${++scope.counter.n}`;
      const on = rel.on(alias, child);
      if (item.items.length === 1 && item.items[0].kind === 'count') {
        const count = `(SELECT count(*) FROM ${ident(rel.table)} AS ${child} WHERE ${whereFor(rel.table, child, childPath, scope, [on]).join(' AND ')})`;
        pairs.push([key, rel.many ? `json_array(json_object('count', ${count}))` : `json_object('count', ${count})`]);
        continue;
      }
      // As PostgREST embedded them: keys in jsonb's order.
      const sub = selectPairs(item.items, rel.table, child, childPath, scope).sort(byJsonbOrder);
      const inner = innerExists(item.items, rel.table, child, childPath, scope);
      const conds = whereFor(rel.table, child, childPath, scope, [on, ...inner]).join(' AND ');
      const order = orderSql(scopedTo(scope.spec.order, childPath), child, rel.table);
      const rows = `SELECT ${jsonObject(sub)} AS r FROM ${ident(rel.table)} AS ${child} WHERE ${conds}${order}`;
      // json() again outside each subquery: a value loses its JSON subtype crossing one.
      pairs.push([key, rel.many ? `json((SELECT json_group_array(json(r)) FROM (${rows})))` : `json((${rows} LIMIT 1))`]);
    }
  }
  return pairs;
}

/** For each inner embed: the row needs a related row that passes the relation's filters (and its own inner embeds). */
function innerExists(items: Item[], table: string, alias: string, path: string, scope: Scope): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.kind !== 'embed' || !item.inner) continue;
    const rel = relationOf(table, item.name, item.hint);
    const childPath = path ? `${path}.${item.alias ?? item.name}` : item.alias ?? item.name;
    const probe = `t${++scope.counter.n}`;
    const nested = innerExists(item.items, rel.table, probe, childPath, scope);
    const conds = whereFor(rel.table, probe, childPath, scope, [rel.on(alias, probe), ...nested]).join(' AND ');
    out.push(`EXISTS (SELECT 1 FROM ${ident(rel.table)} AS ${probe} WHERE ${conds})`);
  }
  return out;
}

interface Compiled { text: string; values: unknown[] }

function compileSelect(spec: Pick<QuerySpec, 'table' | 'columns' | 'filters' | 'order' | 'limit' | 'offset'>, ctx: Ctx, forCount = false): Compiled {
  const scope: Scope = { spec, params: new Params(), ctx, counter: { n: 0 } };
  const items = parseSelect(spec.columns);
  const pairs = forCount ? [] : selectPairs(items, spec.table, 't0', '', scope);
  const where = whereFor(spec.table, 't0', '', scope, innerExists(items, spec.table, 't0', '', scope));
  const from = ` FROM ${ident(spec.table)} AS t0${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  if (forCount) return { text: `SELECT count(*) AS count${from}`, values: scope.params.values };
  const order = orderSql(scopedTo(spec.order, ''), 't0', spec.table);
  const limit = spec.limit !== undefined ? ` LIMIT ${Math.max(0, Math.floor(spec.limit))}` : spec.offset ? ' LIMIT -1' : '';
  const offset = spec.offset ? ` OFFSET ${Math.max(0, Math.floor(spec.offset))}` : '';
  return { text: `SELECT ${jsonObject(pairs)} AS r${from}${order}${limit}${offset}`, values: scope.params.values };
}

// ----- writes -----

const now = () => new Date().toISOString();

/** A whole stored row as the code reads it. */
function readRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const cols = tableOf(table).columns;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, readValue(cols[k] ?? 'text', v)]));
}

/** A selected value from a whole row, in JavaScript: what refSql gives in SQL. */
function pick(row: Record<string, unknown>, ref: ColumnRef): unknown {
  let v = row[ref.column];
  for (const s of ref.steps) v = v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[s.key] ?? null : null;
  const last = ref.steps[ref.steps.length - 1];
  if (last?.op === '->>' && v !== null && v !== undefined) v = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (ref.cast === 'text' && v !== null && typeof v !== 'string') v = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return v ?? null;
}

/** The columns written: every key of the values, in the order first seen. */
function writeColumns(table: string, rows: Record<string, unknown>[]): string[] {
  const schema = tableOf(table);
  const cols: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!cols.includes(key)) cols.push(key);
  for (const c of cols) if (!(c in schema.columns)) fail(`Could not find the '${c}' column of '${table}' in the schema cache`, 'PGRST204');
  return cols;
}

const emailHash = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

/** Rows as written: their values stored as SQLite keeps them, an entry's readable text with its content and a contact's address hash with its email. */
function storedRows(table: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const cols = tableOf(table).columns;
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = storedValue(cols[k] ?? 'text', v);
    if (table === 'entries' && 'content' in row) out.body_text = bodyText(row.content);
    if (table === 'contacts' && typeof row.email === 'string') out.email_hash = emailHash(row.email);
    return out;
  });
}

const rlsError = (table: string): DbError => ({ message: `new row violates row-level security policy for table "${table}"`, code: '42501', details: null, hint: null });

/** SQLite's constraint errors under Postgres's codes, which the code checks (23505: already there). */
export function toDbError(e: unknown): DbError {
  if (e instanceof SqlError) return e.error;
  const message = String((e as Error)?.message ?? e).replace(/^D1_ERROR:\s*/, '');
  const code = /UNIQUE constraint failed/i.test(message) ? '23505'
    : /FOREIGN KEY constraint failed/i.test(message) ? '23503'
    : /NOT NULL constraint failed/i.test(message) ? '23502'
    : /CHECK constraint failed/i.test(message) ? '23514'
    : (e as { code?: string })?.code ?? '';
  return { message, code, details: null, hint: null };
}

/** Runs QuerySpecs as `ctx` (the server, or a signed-in person's role) on D1. */
export class SqliteExecutor implements Executor {
  constructor(readonly ctx: Ctx) {}

  db(): Promise<D1Database> {
    return database();
  }

  /** The same database as another role (the functions that run with the server's rights). */
  as(ctx: Ctx): SqliteExecutor {
    return new SqliteExecutor(ctx);
  }

  /**
   * Inserts `row` into `table` only if `cond` holds when the statement runs (one statement, so
   * nothing else is written between the check and the insert): the row written, or null.
   */
  async insertIf(table: string, row: Record<string, unknown>, cond: (add: (v: unknown) => string) => string): Promise<Record<string, unknown> | null> {
    const params = new Params();
    const [stored] = storedRows(table, [row]);
    const cols = writeColumns(table, [stored]);
    const v = params.add(JSON.stringify(stored));
    const text = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) SELECT ${cols.map((c) => `json_extract(${v}, ${lit(jsonPath([c]))})`).join(', ')} WHERE ${cond((x) => params.add(x))} RETURNING *`;
    const [written] = await this.rows(text, params.values);
    return written ? readRow(table, written) : null;
  }

  /** Rows of a statement (the functions' own SQL). */
  async rows<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await (await this.db()).prepare(text).bind(...values).all<T>()).results;
  }

  /** How many rows a statement changed. */
  async changes(text: string, values: unknown[] = []): Promise<number> {
    return (await (await this.db()).prepare(text).bind(...values).run()).meta.changes;
  }

  async query(spec: QuerySpec): Promise<Result> {
    try {
      tableOf(spec.table);
      return spec.action === 'select' ? await this.select(spec) : await this.write(spec);
    } catch (e) {
      return { data: null, error: toDbError(e), count: null, status: 400 };
    }
  }

  async call(spec: CallSpec): Promise<Result> {
    try {
      const { data, paged } = await callFunction(this, spec);
      const rows = Array.isArray(data) && !paged && (spec.offset !== undefined || spec.limit !== undefined)
        ? data.slice(spec.offset ?? 0, spec.limit === undefined ? undefined : (spec.offset ?? 0) + spec.limit)
        : data;
      return shape({ data: rows, error: null, count: null, status: 200 }, spec.single);
    } catch (e) {
      return { data: null, error: toDbError(e), count: null, status: 400 };
    }
  }

  private async select(spec: QuerySpec): Promise<Result> {
    const db = await this.db();
    const data = spec.head ? null : compileSelect(spec, this.ctx);
    const count = spec.count ? compileSelect(spec, this.ctx, true) : null;
    const [rows, total] = await Promise.all([
      data ? db.prepare(data.text).bind(...data.values).all<{ r: string }>().then((r) => r.results.map((x) => JSON.parse(x.r))) : null,
      count ? db.prepare(count.text).bind(...count.values).all<{ count: number }>().then((r) => Number(r.results[0]?.count ?? 0)) : null,
    ]);
    if (total !== null && spec.offset && spec.offset > total) {
      return { data: null, count: null, status: 416, error: { code: 'PGRST103', message: 'Requested range not satisfiable', details: `An offset of ${spec.offset} was requested, but there are only ${total} rows.`, hint: null } };
    }
    return shape({ data: rows, error: null, count: total, status: 200 }, spec.single);
  }

  /** The rows a write by this role may reach (update, delete), checked as written would be (update). */
  private async reachable(spec: QuerySpec, rule: Rule): Promise<Record<string, unknown>[]> {
    const db = await this.db();
    const using = rule.using(this.ctx);
    const filters = [...spec.filters.filter((f) => f.path === ''), ...(using === true ? [] : [{ path: '', item: using as Filter }])];
    const c = compileSelect({ table: spec.table, columns: '*', filters, order: [] }, { role: 'service' });
    const rows = (await db.prepare(c.text).bind(...c.values).all<{ r: string }>()).results.map((x) => JSON.parse(x.r));
    if (spec.action === 'update' && rows.some((row) => !rule.check(this.ctx, { ...row, ...(spec.values as Record<string, unknown>) }))) throw new SqlError(rlsError(spec.table));
    return rows;
  }

  private async write(spec: QuerySpec): Promise<Result> {
    const op = spec.action === 'upsert' ? 'insert' : spec.action;
    const rule = this.ctx.role === 'service' ? true : policyFor(spec.table, op as 'insert' | 'update' | 'delete', this.ctx, true);
    // A role with no policy for the write: inserts are refused, updates and deletes reach no rows.
    if (rule === false) {
      if (op === 'insert') return { data: null, count: null, error: rlsError(spec.table), status: 403 };
      return shape({ data: spec.returning ? [] : null, error: null, count: spec.count ? 0 : null, status: 200 }, spec.single);
    }
    const schema = tableOf(spec.table);
    const params = new Params();
    let text: string;
    // The write sets updated_at itself (a date kept on purpose), which the touch trigger replaces.
    let stamped = false;
    if (spec.action === 'update' || spec.action === 'delete') {
      const where = scopedTo(spec.filters, '').map((f) => conditionSql(f, 't0', spec.table, params));
      if (rule !== true) {
        // Only the rows this role may change, as they were checked.
        const rows = await this.reachable(spec, rule);
        if (!rows.length) return shape({ data: spec.returning ? [] : null, error: null, count: spec.count ? 0 : null, status: 200 }, spec.single);
        // The rule again in the write, so a row that stopped qualifying since it was read is left alone.
        const using = rule.using(this.ctx);
        if (using !== true) where.push(conditionSql(using as Filter, 't0', spec.table, params));
        where.push(`(${schema.pk.map((k) => `t0.${ident(k)}`).join(', ')}) IN (SELECT ${schema.pk.map((k) => `json_extract(value, ${lit(jsonPath([k]))})`).join(', ')} FROM json_each(${params.add(JSON.stringify(rows.map((r) => Object.fromEntries(schema.pk.map((k) => [k, r[k]])))))}))`);
      }
      const cond = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      if (spec.action === 'delete') text = `DELETE FROM ${ident(spec.table)} AS t0${cond} RETURNING *`;
      else {
        const values = { ...(spec.values as Record<string, unknown>) };
        if (schema.touch && 'updated_at' in values) stamped = true;
        if (schema.touch && !('updated_at' in values)) values.updated_at = now();
        const [row] = storedRows(spec.table, [values]);
        const cols = writeColumns(spec.table, [row]);
        if (!cols.length) fail('Empty or invalid json', 'PGRST102');
        const v = params.add(JSON.stringify(row));
        text = `UPDATE ${ident(spec.table)} AS t0 SET ${cols.map((c) => `${ident(c)} = json_extract(${v}, ${lit(jsonPath([c]))})`).join(', ')}${cond} RETURNING *`;
      }
    } else {
      const given = Array.isArray(spec.values) ? spec.values : [spec.values ?? {}];
      if (rule !== true && given.some((row) => !rule.check(this.ctx, { ...schema.defaults, ...row }))) return { data: null, count: null, error: rlsError(spec.table), status: 403 };
      const rows = storedRows(spec.table, given);
      const cols = writeColumns(spec.table, rows);
      const list = cols.map(ident).join(', ');
      if (!cols.length) text = `INSERT INTO ${ident(spec.table)} DEFAULT VALUES`;
      else {
        const v = params.add(JSON.stringify(rows));
        // WHERE true: SQLite's parser needs it before an upsert's ON CONFLICT.
        text = `INSERT INTO ${ident(spec.table)} (${list}) SELECT ${cols.map((c) => `json_extract(value, ${lit(jsonPath([c]))})`).join(', ')} FROM json_each(${v}) WHERE true`;
      }
      if (spec.action === 'upsert') {
        const target = spec.onConflict ? spec.onConflict.split(',').map((c) => c.trim()) : schema.pk;
        for (const c of target) if (!(c in schema.columns)) fail(`column ${c} does not exist`, '42703');
        const conflict = `(${target.map(ident).join(', ')})`;
        if (spec.ignoreDuplicates || !cols.length) text += ` ON CONFLICT ${conflict} DO NOTHING`;
        else {
          const update = await this.upsertRule(spec.table, given, target);
          if (update === false) return { data: null, count: null, error: rlsError(spec.table), status: 403 };
          const sets = cols.map((c) => `${ident(c)} = excluded.${ident(c)}`);
          if (schema.touch && !cols.includes('updated_at')) sets.push(`"updated_at" = ${params.add(now())}`);
          else if (schema.touch) stamped = true;
          // The update rule's rows only, as the rows were when they were checked.
          const only = update === true ? '' : ` WHERE ${conditionSql(update, ident(spec.table), spec.table, params)}`;
          text += ` ON CONFLICT ${conflict} DO UPDATE SET ${sets.join(', ')}${only}`;
        }
      }
      text += ' RETURNING *';
    }
    const db = await this.db();
    const raw = (await db.prepare(text).bind(...params.values).all()).results;
    if (stamped && raw.length) await this.restamp(spec.table, raw);
    const written = raw.map((r) => readRow(spec.table, r));
    let data: unknown[] | null = null;
    if (spec.returning) data = await this.project(spec, written);
    return shape({ data, error: null, count: spec.count ? written.length : null, status: spec.action === 'insert' ? 201 : 200 }, spec.single);
  }

  /**
   * Puts back the updated_at a write set on purpose. The *_touch triggers fire when an update leaves
   * updated_at as it was, a date written back unchanged included, and set it to now; written again
   * here, it differs from what the trigger left, so the trigger lets it stand. RETURNING reports what
   * the write set, which is what is stored once this has run.
   */
  private async restamp(table: string, rows: Record<string, unknown>[]): Promise<void> {
    const pk = tableOf(table).pk;
    const keys = JSON.stringify(rows.map((r) => [r.updated_at, ...pk.map((k) => r[k])]));
    const w = `SELECT json_extract(value, '$[0]') AS u${pk.map((_, i) => `, json_extract(value, '$[${i + 1}]') AS k${i}`).join('')} FROM json_each(?)`;
    const on = pk.map((k, i) => `${ident(table)}.${ident(k)} = w.k${i}`).join(' AND ');
    await (await this.db()).prepare(`UPDATE ${ident(table)} SET "updated_at" = w.u FROM (${w}) AS w WHERE ${on} AND ${ident(table)}."updated_at" IS NOT w.u`).bind(keys).run();
  }

  /**
   * An upsert writes over the rows it conflicts with, so it is an update of those: each must be a row
   * this role may update, and pass the update rule as written. False when one doesn't; else the rule's
   * condition on the rows (true: none).
   */
  private async upsertRule(table: string, given: Record<string, unknown>[], target: string[]): Promise<boolean | Filter> {
    if (this.ctx.role === 'service') return true;
    const rule = policyFor(table, 'update', this.ctx, true);
    if (rule === true) return true;
    // No update at all: a row that appears before the write is left as it is.
    const using: boolean | Filter = rule === false ? { any: [] } : rule.using(this.ctx);
    const keyOf = (row: Record<string, unknown>) => JSON.stringify(target.map((c) => row[c] ?? null));
    const byKey: Filter = { any: given.filter((row) => target.every((c) => row[c] != null)).map((row) => ({ all: target.map((c) => ({ col: c, op: 'eq' as const, value: row[c] })) })) };
    const db = await this.db();
    const read = async (filters: Filter[]) => {
      const c = compileSelect({ table, columns: '*', filters: filters.map((item) => ({ path: '', item })), order: [] }, { role: 'service' });
      return (await db.prepare(c.text).bind(...c.values).all<{ r: string }>()).results.map((x) => JSON.parse(x.r) as Record<string, unknown>);
    };
    const existing = 'any' in byKey && byKey.any.length ? await read([byKey]) : [];
    if (!existing.length) return using;
    if (rule === false) return false;
    if (using !== true && (await read([byKey, using as Filter])).length < existing.length) return false;
    const rows = new Map(given.map((row) => [keyOf(row), row]));
    return existing.every((row) => rule.check(this.ctx, { ...row, ...rows.get(keyOf(row)) })) ? using : false;
  }

  /** Written rows as the caller selected them: read again for embedded relations, else picked here. */
  private async project(spec: QuerySpec, rows: Record<string, unknown>[]): Promise<unknown[]> {
    const items = parseSelect(spec.columns);
    if (items.some((i) => i.kind === 'embed') && spec.action !== 'delete' && rows.length) {
      const pk = tableOf(spec.table).pk;
      const filters: Scoped<Filter>[] = pk.length === 1 ? [{ path: '', item: { col: pk[0], op: 'in', value: rows.map((r) => r[pk[0]]) } }] : [];
      const c = compileSelect({ table: spec.table, columns: spec.columns, filters, order: [] }, this.ctx);
      const read = (await (await this.db()).prepare(c.text).bind(...c.values).all<{ r: string }>()).results.map((x) => JSON.parse(x.r));
      const byKey = new Map(read.map((r: Record<string, unknown>) => [String(r[pk[0]]), r]));
      return rows.map((r) => byKey.get(String(r[pk[0]])) ?? r);
    }
    return rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const item of items) {
        if (item.kind === 'star') Object.assign(out, row);
        else if (item.kind === 'col') out[item.alias ?? outputName(item.ref)] = pick(row, item.ref);
      }
      return out;
    });
  }
}
