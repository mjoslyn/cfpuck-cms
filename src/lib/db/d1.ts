// The database: D1 (server only). In the Worker it is the DB binding. Scripts in Node use the same
// calls on the local D1 (the SQLite file `astro dev` and `wrangler d1 ... --local` keep under
// .wrangler/state), or on the deployed one through Cloudflare's API when CLOUDFLARE_ACCOUNT_ID,
// CLOUDFLARE_API_TOKEN and D1_DATABASE_ID are set.
import { bindings } from '../platform';

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number; last_row_id?: number };
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
  /** Statements run in order, all or none. */
  batch(statements: D1Statement[]): Promise<D1Result[]>;
  exec(sql: string): Promise<unknown>;
}

const env = (k: string) => process.env[k];

let node: Promise<D1Database> | null = null;

/** The site's database. */
export async function database(): Promise<D1Database> {
  const db = bindings()?.DB;
  if (db) return db;
  node ??= env('CLOUDFLARE_API_TOKEN') && env('D1_DATABASE_ID') ? Promise.resolve(remoteD1()) : localD1();
  return node;
}

/**
 * The database as a value to hand over now and use later (Better Auth takes one when it is made):
 * each statement finds the database when it runs.
 */
export function lazyD1(): D1Database {
  const statement = (sql: string, values: unknown[] = []): D1Statement & { real(db: D1Database): D1Statement } => ({
    bind: (...v: unknown[]) => statement(sql, v),
    real: (db) => db.prepare(sql).bind(...values),
    all: async <T,>() => (await database()).prepare(sql).bind(...values).all<T>(),
    run: async () => (await database()).prepare(sql).bind(...values).run(),
  });
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      const db = await database();
      return db.batch(statements.map((s) => (s as ReturnType<typeof statement>).real(db)));
    },
    exec: async (sql) => (await database()).exec(sql),
  };
}

// ----- scripts: the local file -----

interface SqliteStatement {
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  readonly reader?: boolean;
  columns?(): unknown[];
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
}

/** SQLite takes numbers, strings, null and bytes: booleans as 1 and 0. */
const param = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v);

function nodeStatement(db: SqliteDatabase, sql: string, values: unknown[] = []): D1Statement & { sync(): D1Result } {
  const sync = (): D1Result => {
    const st = db.prepare(sql);
    const params = values.map(param);
    // Statements that answer rows (reads, RETURNING) give them; others say what they changed.
    if (st.columns?.().length) {
      const results = st.all(...params);
      return { results, meta: { changes: results.length } };
    }
    const r = st.run(...params);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  return {
    bind: (...v: unknown[]) => nodeStatement(db, sql, v),
    all: async <T,>() => sync() as D1Result<T>,
    run: async () => sync(),
    sync,
  };
}

async function localD1(): Promise<D1Database> {
  const fs = await import(/* @vite-ignore */ 'node:fs');
  const path = await import(/* @vite-ignore */ 'node:path');
  const { DatabaseSync } = (await import(/* @vite-ignore */ 'node:sqlite' as string)) as { DatabaseSync: new (file: string) => SqliteDatabase };
  const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f: string) => f.endsWith('.sqlite') && f !== 'metadata.sqlite') : [];
  const file = env('D1_LOCAL_FILE') || (files.length === 1 ? path.join(dir, files[0]) : '');
  if (!file) throw new Error(files.length ? `Several local databases in ${dir}: set D1_LOCAL_FILE` : `No local database: run npx wrangler d1 migrations apply DB --local`);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return {
    prepare: (sql) => nodeStatement(db, sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => (s as ReturnType<typeof nodeStatement>).sync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}

// ----- scripts: the deployed database, through Cloudflare's API -----

function remoteD1(): D1Database {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env('CLOUDFLARE_ACCOUNT_ID')}/d1/database/${env('D1_DATABASE_ID')}/query`;
  const query = async (sql: string, params: unknown[]): Promise<D1Result> => {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${env('CLOUDFLARE_API_TOKEN')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params: params.map(param) }) });
    const json = (await res.json()) as { success: boolean; errors?: { message: string }[]; result?: { results: Record<string, unknown>[]; meta: { changes: number; last_row_id: number } }[] };
    if (!json.success) throw new Error(json.errors?.map((e) => e.message).join('; ') || `D1 answered ${res.status}`);
    return { results: json.result?.[0]?.results ?? [], meta: json.result?.[0]?.meta ?? { changes: 0 } };
  };
  const statement = (sql: string, values: unknown[] = []): D1Statement & { sql: string; values: unknown[] } => ({
    sql,
    values,
    bind: (...v: unknown[]) => statement(sql, v),
    all: async <T,>() => (await query(sql, values)) as D1Result<T>,
    run: () => query(sql, values),
  });
  return {
    prepare: (sql) => statement(sql),
    // One after another: the API runs each on its own (scripts only).
    async batch(statements) {
      const out: D1Result[] = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
    async exec(sql) {
      return query(sql, []);
    },
  };
}
