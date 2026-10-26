// Unit checks for recurring event expansion.
//   npx tsx scripts/checks/recurrence.ts
import { occurrenceDates, expandEntry, localToUtc } from '../../src/lib/recurrence';
import { eventDates } from '../../src/lib/admin/save';
import { hasEnded } from '../../src/lib/events/model';

let bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

eq('daily x3', occurrenceDates('2026-10-01', { freq: 'daily', count: 3 }, '2028-01-01'), ['2026-10-01', '2026-10-02', '2026-10-03']);
eq('every 2 days until', occurrenceDates('2026-10-01', { freq: 'daily', interval: 2, until: '2026-10-07' }, '2028-01-01'), ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07']);
eq('weekly Tue+Thu x4 (start Thu)', occurrenceDates('2026-10-01', { freq: 'weekly', byweekday: [2, 4], count: 4 }, '2028-01-01'), ['2026-10-01', '2026-10-06', '2026-10-08', '2026-10-13']);
eq('weekly Wed+Fri x3 (start Mon) keeps the start', occurrenceDates('2026-10-26', { freq: 'weekly', byweekday: [3, 5], count: 3 }, '2028-01-01'), ['2026-10-26', '2026-10-28', '2026-10-30']);
eq('biweekly default weekday', occurrenceDates('2026-10-01', { freq: 'weekly', interval: 2, count: 3 }, '2028-01-01'), ['2026-10-01', '2026-10-15', '2026-10-29']);
eq('monthly by date skips short months', occurrenceDates('2026-01-31', { freq: 'monthly', count: 4 }, '2028-01-01'), ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
eq('monthly 2nd Tuesday', occurrenceDates('2026-10-13', { freq: 'monthly', monthlyBy: 'weekday', count: 3 }, '2028-01-01'), ['2026-10-13', '2026-11-10', '2026-12-08']);
eq('monthly last Friday', occurrenceDates('2026-10-30', { freq: 'monthly', monthlyBy: 'weekday', count: 3 }, '2028-01-01'), ['2026-10-30', '2026-11-27', '2026-12-25']);
eq('yearly Feb 29 skips non-leap', occurrenceDates('2028-02-29', { freq: 'yearly', count: 2 }, '2040-01-01'), ['2028-02-29', '2032-02-29']);
eq('exclude + include', occurrenceDates('2026-10-01', { freq: 'weekly', count: 3, exclude: ['2026-10-08'], include: ['2026-10-10'] }, '2028-01-01'), ['2026-10-01', '2026-10-10', '2026-10-15']);
eq('horizon caps open series', occurrenceDates('2026-10-01', { freq: 'monthly' }, '2026-12-31').length, 3);
const long = occurrenceDates('2020-01-01', { freq: 'daily' }, '2028-10-09');
eq('old open series still reaches the horizon', [long[long.length - 1], long[0] < '2026-10-09'], ['2028-10-09', true]);
eq('DST: 7pm ET in Nov is 00:00Z next day', localToUtc('2026-11-05 19:00:00', 'America/New_York'), '2026-11-06T00:00:00.000Z');
eq('DST: 7pm ET in Oct is 23:00Z', localToUtc('2026-10-29 19:00:00', 'America/New_York'), '2026-10-29T23:00:00.000Z');

const e: any = { id: 7, type: 'event', slug: 'jam', fields: { start: '2026-10-29 19:00:00', end: '2026-10-29 22:00:00', timezone: 'America/New_York', recurrence: { freq: 'weekly', count: 2 } } };
const occ = expandEntry(e, '2028-01-01') as any[];
eq('occurrences keep wall-clock times across DST', occ.map((o) => [o.occurrence, o.fields.start, o.fields.end, o.event_start]), [
  ['2026-10-29', '2026-10-29 19:00:00', '2026-10-29 22:00:00', '2026-10-29T23:00:00.000Z'],
  ['2026-11-05', '2026-11-05 19:00:00', '2026-11-05 22:00:00', '2026-11-06T00:00:00.000Z'],
]);
const saved = eventDates({ event_start: '2026-11-05T19:00', event_end: '2026-11-05T21:30', event_all_day: false }, { all_day: true, recurrence: { freq: 'weekly', interval: '2', count: 'x' } });
eq('save: fields from editor times', [saved.event_start, saved.event_end, saved.fields.start, saved.fields.end, saved.fields.all_day, saved.fields.recurrence], [
  '2026-11-06T00:00:00.000Z', '2026-11-06T02:30:00.000Z', '2026-11-05 19:00:00', '2026-11-05 21:30:00', false, { freq: 'weekly', interval: 2 },
]);
const allDay = eventDates({ event_start: '2026-10-10T04:00:00+00:00', event_end: '2026-10-12T03:59:59+00:00', event_all_day: true }, { recurrence: { freq: '' } });
eq('save: all-day spans whole days', [allDay.fields.start, allDay.fields.end, allDay.fields.all_day, 'recurrence' in allDay.fields], ['2026-10-10 00:00:00', '2026-10-11 23:59:59', true, false]);
// 8-9 pm in Los Angeles on a New York site, at 8:30 pm Pacific (11:30 pm Eastern): still on.
const la: any = { id: 8, type: 'event', fields: { start: '2026-10-26 20:00:00', end: '2026-10-26 21:00:00', timezone: 'America/Los_Angeles' } };
eq('ended: judged in the event\'s own timezone', [hasEnded(la, la.fields.end, new Date('2026-10-27T03:30:00Z')), hasEnded(la, la.fields.end, new Date('2026-10-27T04:30:00Z'))], [false, true]);
process.exitCode = bad ? 1 : 0;
