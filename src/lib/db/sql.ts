// Runs QuerySpecs (src/lib/db/query.ts) against Postgres, server only. A query compiles to one SQL
// statement whose result is the JSON PostgREST would have answered with (json_agg over the rows), so
// what the code reads is unchanged: timestamps as ISO strings, bigints as numbers, embedded relations
// as objects or arrays. Identifiers are checked against the schema (src/lib/db/schema.ts) and every
// value is a parameter. For roles other than the server's, the policies (src/lib/db/policies.ts)
// decide which rows a query sees and which writes it may make, as the database's row security did.
import pg from 'pg';
import { SCHEMA, type TableSchema } from './schema';
import { shape, type CallSpec, type DbError, type Executor, type Filter, type Order, type QuerySpec, type Result, type Scoped } from './query';
import { policyFor, type Ctx, type Rule } from './policies';
import { callFunction } from './functions';
import { bindings, currentScope } from '../platform';

let pool: pg.Pool | null = null;

/**
 * The database connections: in a Worker, the request's own (through Hyperdrive, which pools them; a
 * Worker can't keep a connection past the request that opened it); in Node (scripts), one pool from
 * DATABASE_URL.
 */
export function getPool(): pg.Pool {
  const hyperdrive = bindings()?.HYPERDRIVE;
  if (hyperdrive) {
    const scope = currentScope();
    if (!scope) throw new Error('No request to connect for');
    return (scope.pool ??= new pg.Pool({ connectionString: hyperdrive.connectionString, max: 5 })) as pg.Pool;
  }
  const url = process.env.DATABASE_URL ?? import.meta.env?.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  pool ??= new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 5), idleTimeoutMillis: 10_000, allowExitOnIdle: true });
  return pool;
}

/** Something that runs SQL: the pool, or one connection inside a transaction. */
export type Runner = Pick<pg.Pool | pg.PoolClient, 'query'>;

export class SqlError extends Error {
  constructor(readonly error: DbError) {
    super(error.message);
  }
}

const fail = (message: string, code = 'PGRST100'): never => {
  throw new SqlError({ message, code, details: null, hint: null });
};

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

function tableOf(name: string): TableSchema {
  return SCHEMA[name] ?? fail(`Could not find the table 'public.${name}' in the schema cache`, 'PGRST205');
}

/** Bound values, numbered $1, $2... in the order they are added. */
class Params {
  values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

// ----- columns and JSON paths -----

interface ColumnRef { column: string; steps: { op: '->' | '->>'; key: string }[]; cast?: string }

const CASTS = new Set(['text', 'int', 'int4', 'int8', 'bigint', 'numeric', 'boolean', 'bool', 'date', 'timestamptz', 'json', 'jsonb']);

/** `fields->access->>members`, `id::text`. */
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

/** The SQL for a column reference on a table alias, and its type. */
function refSql(alias: string, table: string, ref: ColumnRef, params: Params): { sql: string; type: string } {
  const schema = tableOf(table);
  const base = schema.columns[ref.column] ?? fail(`column ${table}.${ref.column} does not exist`, '42703');
  let sql = `${alias}.${ident(ref.column)}`;
  let type = base;
  for (const step of ref.steps) {
    const key = /^\d+$/.test(step.key) ? step.key : `${params.add(step.key)}::text`;
    sql = `${sql}${step.op}${key}`;
    type = step.op === '->>' ? 'text' : base === 'json' ? 'json' : 'jsonb';
  }
  if (ref.cast) {
    sql = `(${sql})::${ref.cast}`;
    type = ref.cast;
  }
  return { sql, type };
}

/** The name a selected column is answered under: its alias, else the last JSON key, else the column. */
const outputName = (ref: ColumnRef) => (ref.steps.length ? ref.steps[ref.steps.length - 1].key : ref.column);

// ----- select strings -----

type Item =
  | { kind: 'star' }
  | { kind: 'count' }
  | { kind: 'col'; alias?: string; ref: ColumnRef }
  | { kind: 'embed'; alias?: string; name: string; hint?: string; inner: boolean; items: Item[] };

/** Splits on commas outside parentheses. */
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

interface Relation {
  table: string;
  many: boolean;
  /** The join condition between the parent's alias and the related table's. */
  on: (parent: string, child: string) => string;
}

/** How `name` relates to `table`, through a foreign key either way (`hint`: the key's column). */
function relationOf(table: string, name: string, hint?: string): Relation {
  const parent = tableOf(table);
  const child = tableOf(name);
  const join = (a: string, ac: string[], b: string, bc: string[]) => ac.map((c, i) => `${a}.${ident(c)} = ${b}.${ident(bc[i])}`).join(' and ');
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

/** A value as a parameter for a comparison with a column of `type`. */
function bind(params: Params, type: string, value: unknown): string {
  if (value instanceof Date) return params.add(value.toISOString());
  if (value !== null && typeof value === 'object') {
    // Arrays for array columns go as arrays; anything else as JSON.
    if (Array.isArray(value) && type.startsWith('_')) return params.add(value);
    return `${params.add(JSON.stringify(value))}::jsonb`;
  }
  return params.add(value);
}

const likePattern = (v: unknown) => String(v).replace(/\*/g, '%');

function conditionSql(f: Filter, alias: string, table: string, params: Params): string {
  let sql: string;
  if ('any' in f) sql = f.any.length ? `(${f.any.map((x) => conditionSql(x, alias, table, params)).join(' or ')})` : 'false';
  else if ('all' in f) sql = f.all.length ? `(${f.all.map((x) => conditionSql(x, alias, table, params)).join(' and ')})` : 'true';
  else {
    const { sql: col, type } = refSql(alias, table, parseRef(f.col), params);
    const v = f.value;
    switch (f.op) {
      case 'eq': sql = `${col} = ${bind(params, type, v)}`; break;
      case 'neq': sql = `${col} <> ${bind(params, type, v)}`; break;
      case 'gt': sql = `${col} > ${bind(params, type, v)}`; break;
      case 'gte': sql = `${col} >= ${bind(params, type, v)}`; break;
      case 'lt': sql = `${col} < ${bind(params, type, v)}`; break;
      case 'lte': sql = `${col} <= ${bind(params, type, v)}`; break;
      case 'like': sql = `${col} like ${params.add(likePattern(v))}`; break;
      case 'ilike': sql = `${col} ilike ${params.add(likePattern(v))}`; break;
      case 'is': sql = `${col} is ${v === null ? 'null' : v === true ? 'true' : v === false ? 'false' : fail(`Unsupported is value: ${v}`)}`; break;
      case 'in': {
        const list = Array.isArray(v) ? v : fail('in() needs a list');
        sql = list.length ? `${col} in (${list.map((x) => bind(params, type, x)).join(', ')})` : 'false';
        break;
      }
      case 'cs':
      case 'cd': {
        const op = f.op === 'cs' ? '@>' : '<@';
        if (type === 'jsonb' || type === 'json') sql = `(${col})::jsonb ${op} ${params.add(typeof v === 'string' ? v : JSON.stringify(v))}::jsonb`;
        else sql = `${col} ${op} ${params.add(v)}`;
        break;
      }
    }
  }
  return f.not ? `not ${sql}` : sql;
}

// ----- reads -----

interface Scope {
  spec: Pick<QuerySpec, 'filters' | 'order'>;
  params: Params;
  ctx: Ctx;
  counter: { n: number };
}

const scopedTo = <T>(list: Scoped<T>[], path: string) => list.filter((s) => s.path === path).map((s) => s.item);

/** The conditions on one table at `path`: its filters and what the policies let the role read. */
function whereFor(table: string, alias: string, path: string, scope: Scope, extra: string[] = []): string[] {
  const conds = [...extra, ...scopedTo(scope.spec.filters, path).map((f) => conditionSql(f, alias, table, scope.params))];
  const read = policyFor(table, 'select', scope.ctx);
  if (read === false) conds.push('false');
  else if (read !== true) conds.push(conditionSql(read, alias, table, scope.params));
  return conds;
}

function orderSql(orders: Order[], alias: string, table: string, params: Params): string {
  if (!orders.length) return '';
  const parts = orders.map((o) => {
    const { sql } = refSql(alias, table, parseRef(o.col), params);
    const nulls = o.nullsFirst === undefined ? '' : o.nullsFirst ? ' nulls first' : ' nulls last';
    return `${sql} ${o.ascending ? 'asc' : 'desc'}${nulls}`;
  });
  return ` order by ${parts.join(', ')}`;
}

/** The select list for `items` on a table, and the existence checks its inner embeds add. */
function selectList(items: Item[], table: string, alias: string, path: string, scope: Scope): { list: string[]; inner: string[] } {
  const list: string[] = [];
  for (const item of items) {
    if (item.kind === 'star') list.push(`${alias}.*`);
    else if (item.kind === 'count') list.push('count(*) as "count"');
    else if (item.kind === 'col') list.push(`${refSql(alias, table, item.ref, scope.params).sql} as ${ident(item.alias ?? outputName(item.ref))}`);
    else {
      const rel = relationOf(table, item.name, item.hint);
      const key = item.alias ?? item.name;
      const childPath = path ? `${path}.${key}` : key;
      const child = `t${++scope.counter.n}`;
      const row = `r${scope.counter.n}`;
      const on = rel.on(alias, child);
      const countOnly = item.items.length === 1 && item.items[0].kind === 'count';
      if (countOnly) {
        const conds = whereFor(rel.table, child, childPath, scope, [on]).join(' and ');
        const count = `jsonb_build_object('count', count(*))`;
        list.push(`(select ${rel.many ? `jsonb_build_array(${count})` : count} from ${ident(rel.table)} as ${child} where ${conds}) as ${ident(key)}`);
      } else {
        const sub = selectList(item.items, rel.table, child, childPath, scope);
        const conds = whereFor(rel.table, child, childPath, scope, [on, ...sub.inner]).join(' and ');
        const order = orderSql(scopedTo(scope.spec.order, childPath), child, rel.table, scope.params);
        const rows = `select ${sub.list.join(', ')} from ${ident(rel.table)} as ${child} where ${conds}${order}`;
        // As jsonb, as PostgREST embedded them (their keys in jsonb's order).
        list.push(rel.many
          ? `(select coalesce(jsonb_agg(${row}), '[]'::jsonb) from (${rows}) as ${row}) as ${ident(key)}`
          : `(select to_jsonb(${row}) from (${rows} limit 1) as ${row}) as ${ident(key)}`);
      }
    }
  }
  return { list, inner: innerExists(items, table, alias, path, scope) };
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
    const conds = whereFor(rel.table, probe, childPath, scope, [rel.on(alias, probe), ...nested]).join(' and ');
    out.push(`exists (select 1 from ${ident(rel.table)} as ${probe} where ${conds})`);
  }
  return out;
}

interface Compiled { text: string; values: unknown[] }

/** A read: its rows as JSON (`data`), and, when asked, how many rows match (`count`). */
function compileSelect(spec: QuerySpec, ctx: Ctx): { data?: Compiled; count?: Compiled } {
  const out: { data?: Compiled; count?: Compiled } = {};
  const items = parseSelect(spec.columns);
  const build = (forCount: boolean): Compiled => {
    const scope: Scope = { spec, params: new Params(), ctx, counter: { n: 0 } };
    const { list, inner } = forCount ? { list: [], inner: innerExists(items, spec.table, 't0', '', scope) } : selectList(items, spec.table, 't0', '', scope);
    const where = whereFor(spec.table, 't0', '', scope, inner);
    const from = ` from ${ident(spec.table)} as t0${where.length ? ` where ${where.join(' and ')}` : ''}`;
    if (forCount) return { text: `select count(*)::int as count${from}`, values: scope.params.values };
    const order = orderSql(scopedTo(spec.order, ''), 't0', spec.table, scope.params);
    const limit = spec.limit !== undefined ? ` limit ${Math.max(0, Math.floor(spec.limit))}` : '';
    const offset = spec.offset ? ` offset ${Math.max(0, Math.floor(spec.offset))}` : '';
    return { text: `select coalesce(json_agg(r0), '[]'::json) as data from (select ${list.join(', ')}${from}${order}${limit}${offset}) as r0`, values: scope.params.values };
  };
  if (!spec.head) out.data = build(false);
  if (spec.count) out.count = build(true);
  return out;
}

// ----- writes -----

/** The columns written: every key of the values, in the order first seen. */
function writeColumns(table: string, rows: Record<string, unknown>[]): string[] {
  const schema = tableOf(table);
  const cols: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!cols.includes(key)) cols.push(key);
  for (const c of cols) if (!(c in schema.columns)) fail(`Could not find the '${c}' column of '${table}' in the schema cache`, 'PGRST204');
  return cols;
}

/**
 * A write as a statement returning the rows it wrote (`returning *`), wrapped so the result carries
 * them in full (`rows`, for the policies' checks), as the caller selected them (`data`) and counted.
 */
function compileWrite(spec: QuerySpec, ctx: Ctx, rule: Rule | null): Compiled {
  const params = new Params();
  const table = ident(spec.table);
  const record = `null::public.${table}`;
  let statement: string;
  if (spec.action === 'delete' || spec.action === 'update') {
    const where = scopedTo(spec.filters, '').map((f) => conditionSql(f, 't0', spec.table, params));
    if (rule) {
      const using = rule.using(ctx);
      if (using === false) where.push('false');
      else if (using !== true) where.push(conditionSql(using, 't0', spec.table, params));
    }
    const cond = where.length ? ` where ${where.join(' and ')}` : '';
    if (spec.action === 'delete') statement = `delete from ${table} as t0${cond} returning t0.*`;
    else {
      const values = spec.values as Record<string, unknown>;
      const cols = writeColumns(spec.table, [values]);
      if (!cols.length) fail('Empty or invalid json', 'PGRST102');
      const set = cols.map((c) => `${ident(c)} = v.${ident(c)}`).join(', ');
      statement = `update ${table} as t0 set ${set} from json_populate_record(${record}, ${params.add(JSON.stringify(values))}::json) as v${cond} returning t0.*`;
    }
  } else {
    const rows = Array.isArray(spec.values) ? spec.values : [spec.values ?? {}];
    const cols = writeColumns(spec.table, rows);
    const list = cols.map(ident).join(', ');
    const source = `select ${list} from json_populate_recordset(${record}, ${params.add(JSON.stringify(rows))}::json)`;
    statement = cols.length ? `insert into ${table} (${list}) ${source}` : `insert into ${table} default values`;
    if (spec.action === 'upsert') {
      const target = (spec.onConflict ? spec.onConflict.split(',').map((c) => c.trim()) : tableOf(spec.table).pk);
      for (const c of target) if (!(c in tableOf(spec.table).columns)) fail(`column ${c} does not exist`, '42703');
      const conflict = `(${target.map(ident).join(', ')})`;
      statement += spec.ignoreDuplicates || !cols.length
        ? ` on conflict ${conflict} do nothing`
        : ` on conflict ${conflict} do update set ${cols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`;
    }
    statement += ' returning *';
  }
  const scope: Scope = { spec: { filters: [], order: spec.order }, params, ctx, counter: { n: 0 } };
  const parts = [`(select count(*)::int from w) as count`];
  if (rule) parts.push(`(select coalesce(json_agg(w), '[]'::json) from w) as rows`);
  if (spec.returning) {
    const { list } = selectList(parseSelect(spec.columns), spec.table, 't0', '', scope);
    parts.push(`(select coalesce(json_agg(r0), '[]'::json) from (select ${list.join(', ')} from w as t0) as r0) as data`);
  }
  return { text: `with w as (${statement}) select ${parts.join(', ')}`, values: params.values };
}

// ----- running -----

export function toDbError(e: unknown): DbError {
  if (e instanceof SqlError) return e.error;
  const err = e as { message?: string; code?: string; detail?: string; hint?: string };
  return { message: err.message ?? String(e), code: err.code ?? '', details: err.detail ?? null, hint: err.hint ?? null };
}

const rlsError = (table: string): DbError => ({ message: `new row violates row-level security policy for table "${table}"`, code: '42501', details: null, hint: null });

async function runSelect(run: Runner, spec: QuerySpec, ctx: Ctx): Promise<Result> {
  const { data, count } = compileSelect(spec, ctx);
  const [rows, total] = await Promise.all([
    data ? run.query(data.text, data.values).then((r) => r.rows[0].data as unknown[]) : null,
    count ? run.query(count.text, count.values).then((r) => r.rows[0].count as number) : null,
  ]);
  // A range past the last row, with a count asked for, is refused, as PostgREST did.
  if (total !== null && spec.offset && spec.offset > total) {
    return { data: null, count: null, status: 416, error: { code: 'PGRST103', message: 'Requested range not satisfiable', details: `An offset of ${spec.offset} was requested, but there are only ${total} rows.`, hint: null } };
  }
  return shape({ data: rows, error: null, count: total, status: 200 }, spec.single);
}

async function runWrite(run: Runner, spec: QuerySpec, ctx: Ctx): Promise<Result> {
  const op = spec.action === 'upsert' ? 'insert' : spec.action;
  const rule = ctx.role === 'service' ? null : policyFor(spec.table, op as 'insert' | 'update' | 'delete', ctx, true);
  // A role with no policy for the write: inserts are refused, updates and deletes reach no rows.
  if (rule === false) {
    if (op === 'insert') return { data: null, count: null, error: rlsError(spec.table), status: 403 };
    return shape({ data: spec.returning ? [] : null, error: null, count: spec.count ? 0 : null, status: 200 }, spec.single);
  }
  const compiled = compileWrite(spec, ctx, rule === true ? null : rule);
  const checked = rule !== true && rule !== null;
  const exec = async (r: Runner) => {
    const res = (await r.query(compiled.text, compiled.values)).rows[0];
    if (checked && (res.rows as Record<string, unknown>[]).some((row) => !(rule as Rule).check(ctx, row))) throw new SqlError(rlsError(spec.table));
    return res;
  };
  // Checks run on the rows as written, so a refused write is rolled back.
  const res = checked ? await transaction(run, exec) : await exec(run);
  return shape({ data: spec.returning ? res.data : null, error: null, count: spec.count ? res.count : null, status: spec.action === 'insert' ? 201 : 200 }, spec.single);
}

/** Runs `fn` in a transaction: on its own connection from the pool, or inside the one already open. */
export async function transaction<T>(run: Runner, fn: (r: Runner) => Promise<T>): Promise<T> {
  if (!(run instanceof pg.Pool)) return fn(run);
  const client = await run.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Runs queries as `ctx` (the server, or a signed-in person's role) on `run` (the pool by default). */
export class SqlExecutor implements Executor {
  constructor(readonly ctx: Ctx, private runner?: Runner) {}

  get run(): Runner {
    return this.runner ?? getPool();
  }

  async query(spec: QuerySpec): Promise<Result> {
    try {
      tableOf(spec.table);
      return spec.action === 'select' ? await runSelect(this.run, spec, this.ctx) : await runWrite(this.run, spec, this.ctx);
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
}
