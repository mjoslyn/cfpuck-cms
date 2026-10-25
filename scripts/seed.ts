// Starter content for a new install: the header and footer parts, the base templates (index, page,
// single, search), a home page set as the front page, and the site settings; with Events on (Settings >
// Events), the event templates, a sample event and venue, and events on the home page and in the header.
// Anything that already exists is left alone, so it is safe to run again (after turning Events on, it
// adds the event templates and the sample event) and on a hosted project.
//   npx tsx --env-file=.env scripts/seed.ts
import { siteDb } from '../src/lib/db/site';
import { buildPage } from '../src/lib/compose/build';
import { site } from '../src/lib/site';
import type { PuckItem } from '../src/lib/puck/types';
import { eventDates } from '../src/lib/admin/save';
import { SEARCH_TEMPLATE } from '../src/lib/content/search-template';
import { eventsOn } from '../src/lib/events/on';

const sb = siteDb();
const { data: current } = await sb.from('settings').select('value').eq('key', 'site').maybeSingle();
const events = eventsOn(current?.value);

let n = 0;
const node = (type: string, attrs: Record<string, any> = {}, children?: PuckItem[]): PuckItem =>
  ({ type, props: { id: `seed-${type}-${n++}`, attrs, ...(children ? { children } : {}) } }) as PuckItem;
const doc = (content: PuckItem[]) => ({ root: { props: {} }, content, zones: {} });
const pad = (top: string, bottom = top) => ({ top, right: 'var(--space-50)', bottom, left: 'var(--space-50)' });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const header = [
  node('section', { tag: 'header', style: { background: 'var(--color-dark)', padding: pad('var(--space-40)') }, layout: { type: 'constrained', contentSize: '1280px' } }, [
    node('section', { layout: { type: 'row', justify: 'space-between', align: 'center' } }, [
      node('text', { content: `<a href="/">${esc(site.name)}</a>`, style: { color: 'var(--color-on-dark)', linkColor: 'var(--color-on-dark)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-x-large)' } }),
      node('text', { content: `${events ? '<a href="/events/">Events</a> &nbsp; ' : ''}<a href="/about/">About</a> &nbsp; <a href="/search/">Search</a>`, style: { color: 'var(--color-on-dark)', linkColor: 'var(--color-on-dark)' } }),
    ]),
  ]),
];

const footer = [
  node('section', { tag: 'footer', style: { background: 'var(--color-dark)', padding: pad('var(--space-70)') }, layout: { type: 'constrained', contentSize: '1280px' } }, [
    node('text', { content: `&copy; ${esc(site.organization)}`, style: { color: 'var(--color-on-dark)', fontSize: 'var(--text-small)' } }),
  ]),
];

const part = (slug: string) => node('part', { slug });
const main = (children: PuckItem[], top = 'var(--space-70)') =>
  node('section', { tag: 'main', style: { padding: pad(top, 'var(--space-80)') }, layout: { type: 'constrained', contentSize: '1280px' } }, children);
const page = (children: PuckItem[]) => [part('header'), ...children, part('footer')];

const templates: Record<string, PuckItem[]> = {
  index: page([
    main([
      node('archive-title', { kind: 'archive', level: 1 }),
      node('collection', { query: { perPage: 10, postType: 'post', order: 'desc', orderBy: 'date', inherit: true }, display: 'list', pagination: 'numbers', card: 'custom' }, [
        node('collection-items', { layout: { type: 'flow' } }, [
          node('section', { style: { padding: { bottom: 'var(--space-60)' }, margin: { bottom: 'var(--space-60)' }, borderBottom: { width: '1px', color: 'var(--color-surface-alt)' } }, layout: { type: 'flow' } }, [
            node('entry-title', { level: 2, link: true, style: { fontFamily: 'var(--font-display)' } }),
            node('entry-date', { style: { color: 'var(--color-muted)', fontSize: '0.875rem' } }),
            node('entry-excerpt', { length: 30, moreText: 'Read more' }),
          ]),
        ]),
      ]),
    ], 'var(--space-80)'),
  ]),
  page: page([node('section', { tag: 'main', layout: { type: 'flow' } }, [node('entry-content', { layout: { type: 'constrained', contentSize: '1280px', wideSize: '1280px' } })])]),
  single: page([
    main([
      node('entry-title', { level: 1 }),
      node('entry-date', { style: { color: 'var(--color-muted)', fontSize: '0.875rem' } }),
      node('entry-image', { width: 'wide', style: { radius: '6px' } }),
      node('entry-content', { layout: { type: 'constrained', contentSize: '720px' } }),
    ]),
  ]),
  'single-event': page([node('event-details')]),
  'archive-events': page([node('events-calendar')]),
  search: SEARCH_TEMPLATE,
};
if (!events) for (const slug of ['single-event', 'archive-events']) delete templates[slug];

const home = buildPage(
  {
    title: 'Home',
    sections: [
      { kind: 'hero', eyebrow: site.organization, heading: `Welcome to ${site.name}`, body: 'Edit this page in the editor, or ask Compose to write a new one.', buttons: events ? [{ label: 'Upcoming events', url: '/events/' }] : [] },
      { kind: 'text', heading: 'About us', body: 'Say who you are and what visitors will find here.' },
      ...(events ? [{ kind: 'listing', heading: 'Upcoming events', listing: { content_type: 'event', count: 3 }, background: 'tint' }] : []),
    ],
  } as any,
  { images: new Map(), videos: new Map(), tags: new Map() },
  'seed-home',
);

async function ensureTemplate(kind: string, slug: string, content: PuckItem[]) {
  const { data } = await sb.from('templates').select('id').eq('kind', kind).eq('slug', slug).maybeSingle();
  if (data) return console.log(`${kind} ${slug}: exists`);
  const { error } = await sb.from('templates').insert({ kind, slug, title: slug, content: doc(content) });
  if (error) throw error;
  console.log(`${kind} ${slug}: added`);
}

async function ensureEntry(type: string, slug: string, title: string, content: PuckItem[], extra: Record<string, any> = {}): Promise<number> {
  const { data } = await sb.from('entries').select('id').eq('type', type).eq('slug', slug).maybeSingle();
  if (data) {
    console.log(`${type} ${slug}: exists`);
    return data.id;
  }
  const { data: row, error } = await sb.from('entries').insert({ type, slug, title, status: 'publish', content: doc(content), ...extra }).select('id').single();
  if (error) throw error;
  console.log(`${type} ${slug}: added`);
  return row.id;
}
const ensurePage = (slug: string, title: string, content: PuckItem[]) => ensureEntry('page', slug, title, content);

await ensureTemplate('part', 'header', header);
await ensureTemplate('part', 'footer', footer);
for (const [slug, content] of Object.entries(templates)) await ensureTemplate('template', slug, content);
const homeId = await ensurePage('home', 'Home', home);
await ensurePage('about', 'About', buildPage({ title: 'About', sections: [{ kind: 'text', heading: 'About', body: 'Tell visitors about the organisation.' }] } as any, { images: new Map(), videos: new Map(), tags: new Map() }, 'seed-about'));

// With Events on: a sample event two weeks out, at a sample venue, so the listing and the calendar show something.
if (events) {
  const venue = await ensureEntry('venue', 'town-hall', 'Town Hall', [], { fields: { address: '1 Main Street' } });
  const day = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  await ensureEntry('event', 'welcome-evening', 'Welcome evening', [node('text', { content: 'Meet your neighbours. Replace this sample event with your own.' })], {
    excerpt: 'Meet your neighbours.',
    ...eventDates({ event_start: `${day}T18:00`, event_end: `${day}T20:00`, event_all_day: false }, { venue, cost: 'Free' }),
  });
} else console.log('events: off (turn them on under Settings > Events, then run this again for the event templates and a sample event)');

const value = { name: site.name, description: site.organization, ...(current?.value ?? {}) };
if (!value.front_page_id) value.front_page_id = homeId;
const { error } = await sb.from('settings').upsert({ key: 'site', value });
if (error) throw error;
console.log(`settings site: front page ${value.front_page_id}`);
