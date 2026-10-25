// The query builder the code reads and writes with: the same chained calls the Supabase client had
// (from, select, eq, or, order, range, single...), so call sites keep their shape. It only describes a
// query (a QuerySpec); an Executor runs it: on the server, compiled to SQL (src/lib/db/sqlite.ts); in the
// admin's browser, posted to /api/admin/db, which runs it as the signed-in editor. Safe in the browser.

import type { Files } from '../storage';

// fts: a full-text query (FTS5's syntax) on the table's index (`fts`, every indexed column) or one of its columns.
export type Op = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'in' | 'cs' | 'cd' | 'fts';

/** A condition: a column (or JSON path, `fields->a->>b`) compared to a value, or a group of them. */
export type Filter =
  | { col: string; op: Op; value: unknown; not?: boolean }
  | { any: Filter[]; not?: boolean }
  | { all: Filter[]; not?: boolean };

/** Where a filter or order applies: the row (`path` empty) or an embedded relation (`terms`). */
export interface Scoped<T> { path: string; item: T }

export interface Order { col: string; ascending: boolean; nullsFirst?: boolean }

export interface QuerySpec {
  table: string;
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  /** The select string: the columns read, or returned by a write (`returning`). */
  columns: string;
  returning: boolean;
  values?: Record<string, unknown> | Record<string, unknown>[];
  onConflict?: string;
  ignoreDuplicates?: boolean;
  filters: Scoped<Filter>[];
  order: Scoped<Order>[];
  limit?: number;
  offset?: number;
  count?: 'exact';
  head?: boolean;
  single?: 'one' | 'maybe';
}

/** A call to one of the server's functions (src/lib/db/functions.ts). */
export interface CallSpec {
  fn: string;
  args: Record<string, unknown>;
  limit?: number;
  offset?: number;
  single?: 'one' | 'maybe';
}

export interface DbError { message: string; code: string; details?: string | null; hint?: string | null }
export interface Result<T = any> { data: T; error: DbError | null; count: number | null; status?: number }

export interface Executor {
  query(spec: QuerySpec): Promise<Result>;
  call(spec: CallSpec): Promise<Result>;
}

const SINGLE_ERROR: DbError = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null };

/** Applies single()/maybeSingle() to rows read or written. */
export function shape(result: Result, single?: 'one' | 'maybe'): Result {
  if (!single || result.error || !Array.isArray(result.data)) return result;
  const rows = result.data;
  if (rows.length === 1) return { ...result, data: rows[0] };
  if (single === 'maybe' && rows.length === 0) return { ...result, data: null };
  return { data: null, error: { ...SINGLE_ERROR, details: `The result contains ${rows.length} rows` }, count: result.count, status: 406 };
}

/** PostgREST's text form of a list: `(a,b,"c,d")`. */
function parseList(text: string): string[] {
  const inner = text.trim().replace(/^\(/, '').replace(/\)$/, '');
  return splitTop(inner).map(unquote);
}

const unquote = (s: string) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\(.)/g, '$1') : s);

/** Splits on commas outside parentheses, brackets and double quotes. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      cur += ch;
      if (ch === '\\' && i + 1 < text.length) cur += text[++i];
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const OPS = new Set<string>(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs', 'cd', 'fts']);

/** One condition in PostgREST's text form (`col.op.value`, `not.and(...)`), as used in or(). */
function parseCondition(text: string): Filter {
  let s = text.trim();
  let not = false;
  if (s.startsWith('not.and(') || s.startsWith('not.or(')) {
    not = true;
    s = s.slice(4);
  }
  const group = s.match(/^(and|or)\((.*)\)$/s);
  if (group) {
    const items = splitTop(group[2]).map(parseCondition);
    return group[1] === 'and' ? { all: items, not } : { any: items, not };
  }
  // The column can hold JSON arrows (`fields->a->>b`) but not dots; the operator follows the first dot.
  const dot = s.indexOf('.');
  if (dot < 0) throw new Error(`Unreadable condition: ${text}`);
  const col = s.slice(0, dot);
  let rest = s.slice(dot + 1);
  if (rest.startsWith('not.')) {
    not = true;
    rest = rest.slice(4);
  }
  const opEnd = rest.indexOf('.');
  const op = opEnd < 0 ? rest : rest.slice(0, opEnd);
  const raw = opEnd < 0 ? '' : rest.slice(opEnd + 1);
  if (!OPS.has(op)) throw new Error(`Unknown operator in condition: ${text}`);
  return { col, op: op as Op, value: parseValue(op as Op, raw), not };
}

/** A text value in an or() condition, as the filter methods would have passed it. */
function parseValue(op: Op, raw: string): unknown {
  if (op === 'in') return parseList(raw);
  if (op === 'is') return raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : raw;
  return unquote(raw);
}

/** A list of conditions in PostgREST's text form, any of which may hold. */
export function parseOr(text: string): Filter {
  return { any: splitTop(text).map(parseCondition) };
}

/** Builds one query; awaiting it runs it. Methods change the query and return it, as Supabase's did. */
export class QueryBuilder<T = any[]> implements PromiseLike<Result<T>> {
  private spec: QuerySpec;

  constructor(private exec: Executor, table: string) {
    this.spec = { table, action: 'select', columns: '*', returning: false, filters: [], order: [] };
  }

  select(columns = '*', options: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean } = {}): this {
    this.spec.columns = columns;
    if (this.spec.action === 'select') {
      if (options.count) this.spec.count = 'exact';
      if (options.head) this.spec.head = true;
    } else this.spec.returning = true;
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[], options: { count?: 'exact' } = {}): this {
    return this.write('insert', values, options.count);
  }

  upsert(values: Record<string, unknown> | Record<string, unknown>[], options: { onConflict?: string; ignoreDuplicates?: boolean; count?: 'exact' } = {}): this {
    this.spec.onConflict = options.onConflict;
    this.spec.ignoreDuplicates = options.ignoreDuplicates;
    return this.write('upsert', values, options.count);
  }

  update(values: Record<string, unknown>, options: { count?: 'exact' } = {}): this {
    return this.write('update', values, options.count);
  }

  delete(options: { count?: 'exact' } = {}): this {
    this.spec.action = 'delete';
    if (options.count) this.spec.count = 'exact';
    return this;
  }

  private write(action: QuerySpec['action'], values: QuerySpec['values'], count?: 'exact'): this {
    this.spec.action = action;
    // As JSON would send them: undefined values are left out.
    this.spec.values = JSON.parse(JSON.stringify(values ?? {}));
    if (count) this.spec.count = 'exact';
    return this;
  }

  /** A filter on the row, or on an embedded relation when the column is `relation.column`. */
  private where(col: string, op: Op, value: unknown, not = false): this {
    const arrow = col.indexOf('->');
    const head = arrow < 0 ? col : col.slice(0, arrow);
    const dot = head.lastIndexOf('.');
    const path = dot < 0 ? '' : head.slice(0, dot);
    this.spec.filters.push({ path, item: { col: path ? col.slice(dot + 1) : col, op, value, not } });
    return this;
  }

  eq(col: string, value: unknown) { return this.where(col, 'eq', value); }
  neq(col: string, value: unknown) { return this.where(col, 'neq', value); }
  gt(col: string, value: unknown) { return this.where(col, 'gt', value); }
  gte(col: string, value: unknown) { return this.where(col, 'gte', value); }
  lt(col: string, value: unknown) { return this.where(col, 'lt', value); }
  lte(col: string, value: unknown) { return this.where(col, 'lte', value); }
  like(col: string, pattern: string) { return this.where(col, 'like', pattern); }
  ilike(col: string, pattern: string) { return this.where(col, 'ilike', pattern); }
  is(col: string, value: null | boolean) { return this.where(col, 'is', value); }
  in(col: string, values: readonly unknown[]) { return this.where(col, 'in', [...values]); }
  contains(col: string, value: unknown) { return this.where(col, 'cs', value); }
  containedBy(col: string, value: unknown) { return this.where(col, 'cd', value); }
  /** Rows the table's full-text index matches (`fts`: any indexed column; or one of them), in FTS5's query syntax. */
  textSearch(col: string, query: string) { return this.where(col, 'fts', query); }

  match(values: Record<string, unknown>): this {
    for (const [col, value] of Object.entries(values)) this.where(col, 'eq', value);
    return this;
  }

  /** `not(col, op, value)`; an `in` value can be PostgREST's text list, `(1,2,3)`. */
  not(col: string, op: string, value: unknown): this {
    if (!OPS.has(op)) throw new Error(`Unknown operator: ${op}`);
    const v = op === 'in' && typeof value === 'string' ? parseList(value) : value;
    return this.where(col, op as Op, v, true);
  }

  filter(col: string, op: string, value: unknown): this {
    if (op.startsWith('not.')) return this.not(col, op.slice(4), value);
    if (!OPS.has(op)) throw new Error(`Unknown operator: ${op}`);
    return this.where(col, op as Op, op === 'in' && typeof value === 'string' ? parseList(value) : value);
  }

  or(conditions: string, options: { referencedTable?: string; foreignTable?: string } = {}): this {
    this.spec.filters.push({ path: options.referencedTable ?? options.foreignTable ?? '', item: parseOr(conditions) });
    return this;
  }

  order(col: string, options: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string; foreignTable?: string } = {}): this {
    this.spec.order.push({ path: options.referencedTable ?? options.foreignTable ?? '', item: { col, ascending: options.ascending ?? true, nullsFirst: options.nullsFirst } });
    return this;
  }

  limit(n: number): this {
    this.spec.limit = n;
    return this;
  }

  range(from: number, to: number): this {
    this.spec.offset = from;
    this.spec.limit = to - from + 1;
    return this;
  }

  single<U = any>(): QueryBuilder<U> {
    this.spec.single = 'one';
    return this as unknown as QueryBuilder<U>;
  }

  maybeSingle<U = any>(): QueryBuilder<U> {
    this.spec.single = 'maybe';
    return this as unknown as QueryBuilder<U>;
  }

  /** Types the result for the caller; the data is as read. */
  returns<U>(): QueryBuilder<U> {
    return this as unknown as QueryBuilder<U>;
  }

  private throwing = false;
  throwOnError(): this {
    this.throwing = true;
    return this;
  }

  then<A = Result<T>, B = never>(resolve?: ((r: Result<T>) => A | PromiseLike<A>) | null, reject?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    const run = this.exec.query(this.spec).then((r) => {
      if (this.throwing && r.error) throw Object.assign(new Error(r.error.message), r.error);
      return r;
    });
    return run.then(resolve, reject);
  }
}

/** A function call; like a query, it can be paged or narrowed to one row. */
export class CallBuilder implements PromiseLike<Result> {
  private spec: CallSpec;

  constructor(private exec: Executor, fn: string, args: Record<string, unknown>) {
    this.spec = { fn, args: JSON.parse(JSON.stringify(args ?? {})) };
  }

  range(from: number, to: number): this {
    this.spec.offset = from;
    this.spec.limit = to - from + 1;
    return this;
  }

  limit(n: number): this {
    this.spec.limit = n;
    return this;
  }

  single(): this {
    this.spec.single = 'one';
    return this;
  }

  maybeSingle(): this {
    this.spec.single = 'maybe';
    return this;
  }

  then<A = Result, B = never>(resolve?: ((r: Result) => A | PromiseLike<A>) | null, reject?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.exec.call(this.spec).then(resolve, reject);
  }
}

/**
 * A connection to the site's data, as some role: the server's (`service`, everything), an editor's or
 * admin's (what the policies in src/lib/db/policies.ts allow), or anyone else's (nothing). On the
 * server it carries the site's files too (`storage`, src/lib/storage.ts).
 */
export class Db {
  constructor(
    private exec: Executor,
    private storageOf?: () => Files,
  ) {}

  get storage(): Files {
    if (!this.storageOf) throw new Error('No storage here');
    return this.storageOf();
  }

  from(table: string): QueryBuilder {
    return new QueryBuilder(this.exec, table);
  }

  rpc(fn: string, args: Record<string, unknown> = {}): CallBuilder {
    return new CallBuilder(this.exec, fn, args);
  }

  /** Runs a query or call built elsewhere (the admin's, sent from the browser). */
  run(body: { query?: QuerySpec; call?: CallSpec }): Promise<Result> {
    return body.query ? this.exec.query(body.query) : this.exec.call(body.call!);
  }
}
