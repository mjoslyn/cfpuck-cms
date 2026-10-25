// Events calendar check: a temporary weekly event shows as occurrences in the list, month and day
// views and in search, each occurrence page and .ics works, old calendar URLs redirect. Cleans up.
//   npx tsx --env-file=.env scripts/events-e2e.ts
import { siteDb } from '../src/lib/db/site';
import { eventDates } from '../src/lib/admin/save';

const origin = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const sb = siteDb();
const slug = 'e2e-trivia-night';
const get = async (p: string) => {
  const r = await fetch(origin + p, { redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location') ?? '', body: r.status === 200 ? await r.text() : '' };
};
const out: Record<string, unknown> = {};

await sb.from('entries').delete().eq('slug', slug);
const { data: src } = await sb.from('entries').select('*').eq('type', 'event').eq('status', 'publish').order('id').limit(1).single();
const { id: _id, ...rest } = src!;
const d = eventDates({ event_start: '2026-10-01T19:00', event_end: '2026-10-01T21:00', event_all_day: false }, { ...rest.fields, recurrence: { freq: 'weekly', count: 4 } });
const { error } = await sb.from('entries').insert({ ...rest, status: 'publish', slug, title: 'E2E Trivia Night', title_rendered: 'E2E Trivia Night', excerpt: 'Weekly quiz', ...d });
if (error) throw error;
try {
  const list = await get('/events/?q=trivia');
  out.listOccurrences = [...list.body.matchAll(new RegExp(`/event/${slug}/(\\d{4}-\\d{2}-\\d{2})/`, 'g'))].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);
  const month = await get('/events/month/2026-10/?q=trivia');
  out.monthChips = (month.body.match(/class="c-cal-chip/g) ?? []).length;
  const day = await get('/events/day/2026-10-15/');
  out.dayHasIt = day.body.includes('E2E Trivia Night');
  const occ = await get(`/event/${slug}/2026-10-08/`);
  out.occurrencePage = occ.status;
  out.occurrenceHours = occ.body.match(/c-event__hours">([^<]*)/)?.[1];
  const ics = await get(`/event/${slug}/2026-10-08/event.ics`);
  out.occurrenceIcs = ics.body.match(/DTSTART;TZID[^\r\n]*/)?.[0];
  out.series = (await get(`/event/${slug}/`)).location;
  console.log(JSON.stringify(out, null, 1));
} finally {
  await sb.from('entries').delete().eq('slug', slug);
}
