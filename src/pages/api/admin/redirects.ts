// Redirects screen API.
// POST { id?, from, to, status, note }: add or change a redirect. The Not found entries it now covers
// are cleared (for a wildcard, every entry under its prefix); the answer lists them ({ redirect,
// cleared, warning? }) so the screen drops exactly those.
// DELETE ?id=: remove a redirect; DELETE ?notFound=<path>|all: clear Not found entries.
import type { APIRoute } from 'astro';
import type { Db } from '../../../lib/db/query';
import { cleanTarget, loopReason, normalizePath, ruleCovers } from '../../../lib/redirects';
import { allRows } from '../../../lib/rows';

/** Clear the Not found entries a rule covers; returns their paths, or the error. */
async function clearCovered(db: Db, from: string): Promise<{ cleared: string[]; error?: string }> {
  const { data, error } = await allRows<{ path: string }>(db.from('not_found').select('path').order('path'));
  if (error) return { cleared: [], error: error.message };
  const covered = data.map((r) => r.path).filter((path) => ruleCovers(from, path));
  const cleared: string[] = [];
  for (let i = 0; i < covered.length; i += 200) {
    const batch = covered.slice(i, i + 200);
    const { error: e } = await db.from('not_found').delete().in('path', batch);
    if (e) return { cleared, error: e.message };
    cleared.push(...batch);
  }
  return { cleared };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const from = normalizePath(String(body.from ?? ''));
  const to = cleanTarget(String(body.to ?? ''));
  if (from === '/' || from === '/*') return new Response('Choose an old address other than the home page.', { status: 400 });
  if (!to) return new Response('The new address must start with / (a page on this site) or https://.', { status: 400 });
  const loop = loopReason(from, to);
  if (loop) return new Response(loop, { status: 400 });
  const row = { from_path: from, to_url: to, status: Number(body.status) === 302 ? 302 : 301, note: String(body.note ?? '').slice(0, 300) };
  const { data, error } = body.id
    ? await locals.db.from('redirects').update(row).eq('id', Number(body.id)).select().single()
    : await locals.db.from('redirects').insert(row).select().single();
  if (error) return new Response(error.code === '23505' ? `There is already a redirect from ${from}.` : error.message, { status: 400 });
  const { cleared, error: clearError } = await clearCovered(locals.db, from);
  return Response.json({ redirect: data, cleared, ...(clearError ? { warning: `Saved, but its Not found entries could not be cleared: ${clearError}` } : {}) });
};

export const DELETE: APIRoute = async ({ url, locals }) => {
  const id = Number(url.searchParams.get('id'));
  const nf = url.searchParams.get('notFound');
  const { error } = id
    ? await locals.db.from('redirects').delete().eq('id', id)
    : nf === 'all'
      ? await locals.db.from('not_found').delete().neq('path', '')
      : nf
        ? await locals.db.from('not_found').delete().eq('path', nf)
        : { error: { message: 'Nothing to delete.' } };
  if (error) return new Response(error.message, { status: 400 });
  return Response.json({ ok: true });
};
