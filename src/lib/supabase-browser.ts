import { Db, type CallSpec, type Executor, type QuerySpec, type Result } from './db/query';

/** Runs the admin's queries on the server (/api/admin/db), as the signed-in editor. */
const remote: Executor = {
  query: (query: QuerySpec) => post({ query }),
  call: (call: CallSpec) => post({ call }),
};

async function post(body: { query?: QuerySpec; call?: CallSpec }): Promise<Result> {
  try {
    const res = await fetch('/api/admin/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.headers.get('content-type')?.includes('application/json')) return await res.json();
    return { data: null, count: null, error: { message: (await res.text()) || res.statusText, code: String(res.status) } };
  } catch (e) {
    return { data: null, count: null, error: { message: (e as Error).message, code: '' } };
  }
}

let client: Db | null = null;

/** The admin's connection in the browser, through the server with the admin session cookie. */
export function browserClient(): Db {
  client ??= new Db(remote);
  return client;
}
