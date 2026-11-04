// One of the Stats screen's tables as CSV (editors): GET /api/admin/stats.csv?table=daily|pages|links|referrers
// with the screen's range (days, or from and to) and sort.
import type { APIRoute } from 'astro';
import { STATS_TABLES, statsCsv, statsRange, statsSummary, type StatsTable } from '../../../lib/stats';

export const GET: APIRoute = async ({ url, locals }) => {
  const table = (STATS_TABLES as readonly string[]).includes(url.searchParams.get('table') ?? '') ? (url.searchParams.get('table') as StatsTable) : 'pages';
  const range = statsRange(url.searchParams);
  const sort = url.searchParams.get('sort') === 'clicks' ? 'clicks' : 'views';
  const s = await statsSummary(locals.db, range, sort);
  return new Response(statsCsv(s, table), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="stats-${table}-${range.from}-to-${range.to}.csv"`, 'Cache-Control': 'no-store' },
  });
};
