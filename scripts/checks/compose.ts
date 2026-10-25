// Compose without Claude: a fixed page plan using every section kind is gathered and built like a real
// one, saved as a temporary page and screenshotted (reference/compose-*.png). Also checks that the
// materials step reads text documents and video links and refuses private addresses.
//   npx tsx --env-file=.env scripts/checks/compose.ts
import { chromium } from 'playwright';
import { siteDb } from '../../src/lib/db/site';
import { blocksFor, buildMaterials, emptyRegistry, ingest } from '../../src/lib/compose/materials';
import { buildPage } from '../../src/lib/compose/build';
import { MediaStore } from '../../src/lib/media/process';
import type { PagePlan } from '../../src/lib/compose/spec';

const origin = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const sb = siteDb();
const { data: imgs } = await sb.from('media').select('id').like('mime_type', 'image/jpeg').gt('width', 1200).order('id', { ascending: false }).limit(4);

const doc = new File(['Summer Music Festival 2026\n\nThree days of live music on the village square, July 10-12.'], 'notes.txt', { type: 'text/plain' });
const reg = emptyRegistry();
const { added, notes } = await ingest(sb, 'check', reg, {
  docs: [doc],
  mediaIds: imgs!.map((i) => i.id),
  links: ['https://www.youtube.com/watch?v=vAUEZhXa1DI', 'http://127.0.0.1:54621/rest/v1/', 'http://localhost/secret'],
});
const blocks = await blocksFor(sb, new MediaStore(sb), reg, added);
const materials = await buildMaterials(sb, reg);
const out: Record<string, unknown> = {
  added,
  blocks: blocks.map((b) => b.type).join(','),
  jpeg: blocks.filter((b) => b.type === 'image').every((b: any) => b.source.media_type === 'image/jpeg' && Buffer.from(b.source.data, 'base64').subarray(0, 3).toString('hex') === 'ffd8ff'),
  docText: blocks.some((b) => b.type === 'text' && b.text.includes('village square')),
  privateRefused: notes.filter((n) => n.includes('private address')).length,
};

const plan: PagePlan = {
  title: 'Compose Check',
  slug: 'compose-check',
  excerpt: 'A page built from a fixed plan.',
  sections: [
    { kind: 'hero', eyebrow: 'July 10-12, 2026', heading: 'Summer Music Festival', body: 'Three days of **live music** on the village square.', image: 'image-1', buttons: [{ label: 'See events', url: '/events/' }, { label: 'Plan your trip', url: '/plan-your-trip/', style: 'outline' }] },
    { kind: 'text', heading: 'About the festival', body: 'First paragraph with a [link](/about/).\n\n- One\n- Two\n- Three\n\n### Getting there\nPark at the village lots.' },
    { kind: 'media_text', heading: 'On the square', body: 'Bands play from noon until late.', image: 'image-2', image_side: 'right', background: 'soft' },
    { kind: 'stats', heading: 'By the numbers', stats: [{ value: '3', label: 'days' }, { value: '20+', label: 'bands' }, { value: '1', label: 'village' }], background: 'dark' },
    { kind: 'cards', heading: 'Stages', cards: [{ title: 'Main stage', body: 'Headliners.', image: 'image-3' }, { title: 'Park stage', body: 'Local acts.', image: 'image-4', link_url: '/about/', link_label: 'More' }, { title: 'Kids tent', body: 'All day.' }] },
    { kind: 'video', heading: 'Last year', video: 'video-1', caption: 'Highlights' },
    { kind: 'video', heading: 'More clips', videos: ['video-1', 'video-1'], gallery_display: 'slider' },
    { kind: 'gallery', heading: 'Photos', images: ['image-1', 'image-2', 'image-3'] },
    { kind: 'quote', quote: 'The best weekend of the summer.', citation: 'A visitor' },
    { kind: 'faq', heading: 'Questions', items: [{ question: 'Is it free?', answer: 'Yes.' }, { question: 'Dogs?', answer: 'On a leash.' }] },
    { kind: 'listing', heading: 'Upcoming events', listing: { content_type: 'event', count: 3 } },
    { kind: 'listing', heading: 'Latest news', listing: { content_type: 'post', count: 4, display: 'slider', shuffle: true } },
    { kind: 'cta', heading: 'See you there', body: 'Bring a chair.', buttons: [{ label: 'All events', url: '/events/' }] },
  ],
};
const items = buildPage(plan, materials);
out.sections = items.length;

await sb.from('entries').delete().eq('type', 'page').eq('slug', 'compose-check');
const { data: row, error } = await sb.from('entries').insert({ type: 'page', slug: 'compose-check', title: plan.title, status: 'publish', fields: {}, content: { root: { props: {} }, content: items, zones: {} } }).select('id').single();
if (error) throw error;
try {
  const html = await (await fetch(`${origin}/compose-check/`)).text();
  out.rendered = { h1: (html.match(/<h1/g) ?? []).length, hero: html.includes('c-hero'), videoGallery: html.includes('c-gallery is-video is-slider'), shuffledSlider: /class="c-slider"[^>]*data-shuffle="4"/.test(html), embed: html.includes('youtube-nocookie.com/embed/'), gallery: html.includes('c-gallery'), quote: html.includes('c-quote'), listing: (html.match(/c-entry--event/g) ?? []).length };
  const b = await chromium.launch();
  for (const [name, width] of [['desktop', 1440], ['phone', 390]] as const) {
    const p = await b.newPage({ viewport: { width, height: 900 } });
    await p.goto(`${origin}/compose-check/`);
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `reference/compose-${name}.png`, fullPage: true });
  }
  await b.close();
} finally {
  await sb.from('entries').delete().eq('id', row!.id);
}
console.log(JSON.stringify(out, null, 1));
