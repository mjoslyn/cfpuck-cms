// A query that needs many rows reads them a page at a time (PostgREST answered at most 1000 rows; the
// query layer has no cap, and pages keep each answer small).
export const MAX_ROWS = 1000;

/**
 * The rows of a query from `from` on, up to `limit` (all by default), read in pages. The query must be
 * ordered (on a unique column last) so pages don't overlap. A range past the end on the first page is
 * returned as the error, as a single request would.
 */
export async function allRows<T = any>(q: any, from = 0, limit = Infinity): Promise<{ data: T[]; count: number | null; error: any }> {
  const data: T[] = [];
  let count: number | null = null;
  for (let at = from; data.length < limit; at += MAX_ROWS) {
    const take = Math.min(MAX_ROWS, limit - data.length);
    const res = await q.range(at, at + take - 1);
    if (res.error) return { data, count, error: at > from && res.error.code === 'PGRST103' ? null : res.error };
    data.push(...(res.data ?? []));
    count = res.count ?? count;
    if ((res.data?.length ?? 0) < take) break;
  }
  return { data, count, error: null };
}
