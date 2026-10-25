// The other copy's queries during a sync (src/lib/sync-remote.ts): signed with the shared SYNC_SECRET,
// run as the server on the tables a sync uses. Not found while this copy has no secret. Writes clear the
// page cache (the middleware, as for an admin's writes).
import type { APIRoute } from 'astro';
import type { CallSpec, QuerySpec } from '../../../lib/db/query';
import { siteDb } from '../../../lib/db/site';
import { allowed, verified } from '../../../lib/sync-remote';

export const POST: APIRoute = async ({ request }) => {
  const text = await request.text();
  const check = verified(request.headers.get('x-sync-time'), request.headers.get('x-sync-signature'), text);
  if (!check.ok) return new Response(check.message, { status: check.status });
  let body: { query?: QuerySpec; call?: CallSpec } | null = null;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!body || !allowed(body)) return Response.json({ data: null, count: null, error: { message: 'Not a query a sync makes', code: '400' } }, { status: 400 });
  return Response.json(await siteDb().run(body));
};
