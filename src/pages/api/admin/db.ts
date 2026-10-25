// The admin's queries from the browser (src/lib/supabase-browser.ts), run as the signed-in editor or
// admin: the policies (src/lib/db/policies.ts) decide what they read and write, as the database's row
// security did for the database API before. Its writes clear the page cache, its reads don't
// (src/lib/cache.ts).
import type { APIRoute } from 'astro';
import type { CallSpec, QuerySpec } from '../../../lib/db/query';

export const POST: APIRoute = async ({ request, locals }) => {
  const body = (await request.json().catch(() => null)) as { query?: QuerySpec; call?: CallSpec } | null;
  const valid = body && (body.query ? typeof body.query.table === 'string' && Array.isArray(body.query.filters) && Array.isArray(body.query.order) : typeof body.call?.fn === 'string');
  if (!valid) return Response.json({ data: null, count: null, error: { message: 'Not a query', code: '400' } }, { status: 400 });
  return Response.json(await locals.db.run(body));
};
