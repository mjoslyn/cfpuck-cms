// Venue picker check: choose a venue on an event, publish, see it on the event page; add a new venue
// inline and use it; remove it; create a venue from the admin list. Restores the event afterwards.
//   npx tsx --env-file=.env scripts/venue-e2e.ts
import { chromium } from 'playwright';
import { siteDb } from '../src/lib/supabase';

const origin = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const sb = siteDb();
const { data: ev } = await sb.from('entries').select('id, slug, fields, content, title').eq('type', 'event').eq('status', 'publish').order('event_start', { ascending: false }).limit(1).single();
const eventPage = async () => (await fetch(`${origin}/event/${ev!.slug}/`, { redirect: 'follow' })).text();
const venueOnPage = (html: string) => html.match(/c-event__venue">([^<]*)/)?.[1] ?? null;
const out: Record<string, unknown> = {};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const created: number[] = [];
const publish = async () => {
  const overlay = await page.locator("vite-error-overlay").count();
  if (overlay) throw new Error(`vite overlay: ${await page.evaluate(() => (document.querySelector("vite-error-overlay")?.shadowRoot?.innerHTML ?? "").replace(/<style[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 900))}`);
  await page.getByRole('button', { name: /^Publish( changes)?$/ }).click();
  await page.waitForTimeout(1500);
};
// A venue to choose, made here so the check doesn't depend on a site's venues.
const chosen = `E2E Town Hall ${Date.now()}`;
const { data: made } = await sb.from('entries').insert({ type: 'venue', slug: chosen.toLowerCase().replace(/\s+/g, '-'), title: chosen, status: 'publish', published_at: new Date().toISOString(), content: { root: { props: {} }, content: [] } }).select('id').single();
if (made) created.push(made.id);
try {
  await sb.from('entries').update({ fields: { ...ev!.fields, venue: null } }).eq('id', ev!.id);
  await page.goto(`${origin}/admin/login/`);
  await page.fill('input[name=email]', process.env.LOCAL_ADMIN_EMAIL!);
  await page.fill('input[name=password]', process.env.LOCAL_ADMIN_PASSWORD!);
  await Promise.all([page.waitForURL(/\/admin\/(?!login)/), page.click('button:has-text("Sign in")')]);

  // Choose an existing venue.
  await page.goto(`${origin}/admin/edit/${ev!.id}/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Choose venue' }).click();
  await page.getByPlaceholder('Search venues').fill(chosen);
  await page.waitForTimeout(800);
  out.searchResults = await page.locator(`li button:has-text("${chosen}")`).count();
  await page.locator(`li button:has-text("${chosen}")`).first().click();
  await page.screenshot({ path: 'reference/venue-e2e-picked.png' });
  await publish();
  out.pickedOnPage = venueOnPage(await eventPage());

  // Add a new venue inline.
  await page.goto(`${origin}/admin/edit/${ev!.id}/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByPlaceholder('Search venues').fill('E2E Hall');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /New venue "E2E Hall"/ }).click();
  const form = page.locator('div:has(> button:has-text("Add venue"))').locator('..');
  await form.getByLabel('Street address').fill('12 Test Street');
  await form.getByLabel('City').fill('Springfield');
  await form.getByLabel('State').fill('NY');
  await page.screenshot({ path: 'reference/venue-e2e-create.png' });
  await page.getByRole('button', { name: 'Add venue' }).click();
  await page.waitForTimeout(800);
  const { data: hall } = await sb.from('entries').select('id, status, fields').eq('type', 'venue').eq('slug', 'e2e-hall').maybeSingle();
  if (hall) created.push(hall.id);
  out.newVenue = hall && { status: hall.status, fields: hall.fields };
  await publish();
  const html = await eventPage();
  out.newOnPage = [venueOnPage(html), html.match(/c-event__address">([^<]*)/)?.[1]];

  // Remove it.
  await page.goto(`${origin}/admin/edit/${ev!.id}/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await publish();
  out.removedOnPage = venueOnPage(await eventPage());

  // "New Venue" from the admin list opens the editor on a draft.
  await page.goto(`${origin}/admin/?type=venue`);
  await Promise.all([page.waitForURL(/\/admin\/edit\/\d+\//), page.getByRole('button', { name: 'New Venue' }).click()]);
  const newId = Number(page.url().match(/edit\/(\d+)/)![1]);
  created.push(newId);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'reference/venue-e2e-new.png' });
  // The record form: name it, add an address, save.
  await page.getByLabel('Name').fill('E2E Barn');
  await page.getByLabel('Street address').fill('1 Barn Road');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1000);
  const { data: draft } = await sb.from('entries').select('type, status, title, slug, fields').eq('id', newId).single();
  out.listCreate = draft;
  await page.goto(`${origin}/admin/?type=venue`);
  out.listShowsAddress = await page.locator('text=1 Barn Road').count();
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
} finally {
  await sb.from('entries').update({ fields: ev!.fields, content: ev!.content, title: ev!.title }).eq('id', ev!.id);
  await sb.from('revisions').delete().eq('entry_id', ev!.id);
  if (created.length) await sb.from('entries').delete().in('id', created);
  await browser.close();
}
