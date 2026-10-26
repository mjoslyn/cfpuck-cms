// D1's limits on one statement (https://developers.cloudflare.com/d1/platform/limits/), which local
// SQLite doesn't have: 32 arguments per SQL function, LIKE and GLOB patterns of 50 bytes, 100 bound
// values, 100 KB of SQL and 2 MB per value.
import type { D1Database, D1Statement } from '../../src/lib/db/d1';

export const D1_LIMITS = { functionArgs: 32, likePattern: 50, boundValues: 100, statement: 100_000, value: 2_000_000 };

type Token = { kind: 'word' | 'quoted' | 'string' | 'param' | 'punct' | 'other'; text: string };

function tokens(sql: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < sql.length; ) {
    const ch = sql[i];
    if (/\s/.test(ch)) i++;
    else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      let text = '';
      for (; j < sql.length; j++) {
        if (sql[j] === ch && sql[j + 1] === ch) (text += ch), j++;
        else if (sql[j] === ch) break;
        else text += sql[j];
      }
      out.push({ kind: ch === "'" ? 'string' : 'quoted', text });
      i = j + 1;
    } else if (ch === '?') {
      const m = /^\?(\d*)/.exec(sql.slice(i))!;
      out.push({ kind: 'param', text: m[1] });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i))!;
      out.push({ kind: 'word', text: m[0] });
      i += m[0].length;
    } else if (ch === '(' || ch === ')' || ch === ',') out.push({ kind: 'punct', text: ch }), i++;
    else if (ch === '-' && sql[i + 1] === '-') i = sql.indexOf('\n', i) === -1 ? sql.length : sql.indexOf('\n', i);
    else out.push({ kind: 'other', text: ch }), i++;
  }
  return out;
}

// Words before "(" that open a list or a subquery, not a function call.
const NOT_CALLS = new Set(['IN', 'VALUES', 'EXISTS', 'AS', 'CONFLICT', 'FROM', 'JOIN', 'WHERE', 'AND', 'OR', 'NOT', 'ON', 'USING', 'OVER', 'FILTER', 'CHECK', 'KEY', 'UNIQUE', 'REFERENCES', 'INTO', 'SELECT', 'WITH', 'THEN', 'ELSE', 'WHEN', 'CASE', 'IS', 'BY', 'SET', 'RETURNING', 'TABLE', 'INDEX', 'LIKE', 'GLOB', 'ESCAPE', 'DISTINCT', 'ALL', 'UNION', 'RECURSIVE']);

/** What in a statement D1 would refuse (none: []). */
export function limitProblems(sql: string, values: unknown[] = []): string[] {
  const problems: string[] = [];
  if (sql.length > D1_LIMITS.statement) problems.push(`statement of ${sql.length} bytes (D1 takes ${D1_LIMITS.statement})`);
  if (values.length > D1_LIMITS.boundValues) problems.push(`${values.length} bound values (D1 takes ${D1_LIMITS.boundValues})`);
  for (const v of values) if (typeof v === 'string' && Buffer.byteLength(v) > D1_LIMITS.value) problems.push(`a bound value of ${Buffer.byteLength(v)} bytes`);
  const ts = tokens(sql);
  const valueOf = (t: Token, anonymous: number) => (t.text ? values[Number(t.text) - 1] : values[anonymous]);
  let anonymous = 0;
  const frames: { name: string | null; args: number; empty: boolean }[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.kind === 'param' && !t.text) anonymous++;
    if (t.text === '(' && t.kind === 'punct') {
      const prev = ts[i - 1];
      const before = ts[i - 2];
      const call = prev?.kind === 'word' && !NOT_CALLS.has(prev.text.toUpperCase()) && !(before?.kind === 'word' && ['INTO', 'TABLE', 'INDEX'].includes(before.text.toUpperCase()));
      frames.push({ name: call ? prev.text : null, args: 1, empty: true });
      continue;
    }
    const top = frames[frames.length - 1];
    if (t.text === ')' && t.kind === 'punct') {
      frames.pop();
      if (top?.name && !top.empty && top.args > D1_LIMITS.functionArgs) problems.push(`${top.name}() with ${top.args} arguments (D1 takes ${D1_LIMITS.functionArgs})`);
      continue;
    }
    if (top) top.empty = false;
    if (t.text === ',' && t.kind === 'punct' && top) top.args++;
    if (t.kind === 'word' && /^(LIKE|GLOB)$/i.test(t.text)) {
      // The pattern: a literal, a bound value, or one wrapped in lower().
      let p = ts[i + 1];
      if (p?.kind === 'word' && /^lower$/i.test(p.text) && ts[i + 2]?.text === '(') p = ts[i + 3];
      const pattern = p?.kind === 'string' ? p.text : p?.kind === 'param' ? valueOf(p, anonymous) : undefined;
      if (typeof pattern === 'string' && Buffer.byteLength(pattern) > D1_LIMITS.likePattern) problems.push(`${t.text.toUpperCase()} pattern of ${Buffer.byteLength(pattern)} bytes (D1 takes ${D1_LIMITS.likePattern})`);
    }
  }
  return problems;
}

/** A database whose statements throw, before they run, when D1 would refuse them. */
export function checkedD1(db: D1Database): D1Database {
  const check = (sql: string, values: unknown[]) => {
    const problems = limitProblems(sql, values);
    if (problems.length) throw new Error(`D1 would refuse this statement: ${problems.join('; ')}\n${sql.slice(0, 500)}`);
  };
  const statement = (sql: string, values: unknown[] = []): D1Statement & { real(): D1Statement } => ({
    bind: (...v: unknown[]) => statement(sql, v),
    real: () => (check(sql, values), db.prepare(sql).bind(...values)),
    all: async <T,>() => (check(sql, values), db.prepare(sql).bind(...values).all<T>()),
    run: async () => (check(sql, values), db.prepare(sql).bind(...values).run()),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: (statements) => db.batch(statements.map((s) => (s as ReturnType<typeof statement>).real())),
    exec: (sql) => db.exec(sql),
  };
}
