// Collections and tags from the editor: a new collection gets a card template; the settings panel sets
// content, card design and "load more"; tags added to events filter a collection and list at /tag/<slug>/.
//   npx tsx --env-file=.env scripts/collections-e2e.ts
import { chromium, type Page } from 'playwright';
import { siteDb } from '../src/lib/supabase';

const origin = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const sb = siteDb();
const out: Record<string, unknown> = {};
const slug = 'e2e-collections';

const { data: events } = await sb.from('entries').select('id, slug, title').eq('type', 'event').eq('status', 'publish').order('event_start', { ascending: false }).limit(2);
await sb.from('entries').delete().eq('type', 'page').eq('slug', slug);
const { data: pageRow, error } = await sb
  .from('entries')
  .insert({ type: 'page', slug, title: 'E2E Collections', status: 'publish', fields: {}, content: { root: { props: {} }, zones: {}, content: [{ type: 'collection', props: { id: 'e2e-col', attrs: { query: { postType: 'post', perPage: 6 } }, children: [] } }] } })
  .select('id')
  .single();
if (error) throw error;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const publish = async (p: Page) => {
  await p.getByRole('button', { name: /^Publish( changes)?$/ }).click();
  await p.waitForTimeout(1500);
};
const html = async (path: string) => (await fetch(origin + path)).text();

try {
  await page.goto(`${origin}/admin/login/`);
  await page.fill('input[name=email]', process.env.LOCAL_ADMIN_EMAIL!);
  await page.fill('input[name=password]', process.env.LOCAL_ADMIN_PASSWORD!);
  await Promise.all([page.waitForURL(/\/admin\/(?!login)/), page.click('button:has-text("Sign in")')]);

  // Tag the two latest events.
  for (const e of events!) {
    await page.goto(`${origin}/admin/edit/${e.id}/`, { waitUntil: 'networkidle' });
    // The tags field's search (a combobox); Enter adds the typed tag.
    const input = page.locator('input[role=combobox]:visible').first();
    await input.fill('E2E Tag');
    await input.press('Enter');
    await publish(page);
  }
  const { data: tag } = await sb.from('terms').select('id').eq('taxonomy', 'tag').eq('slug', 'e2e-tag').single();
  const { count: tagged } = await sb.from('entry_terms').select('*', { count: 'exact', head: true }).eq('term_id', tag!.id);
  out.tagged = tagged;
  const tagPage = await html('/tag/e2e-tag/');
  out.tagArchive = events!.map((e) => tagPage.includes(`/event/${e.slug}/`));

  // The collection: select it from the outline, then use its settings.
  await page.goto(`${origin}/admin/edit/${pageRow!.id}/`);
  await page.frameLocator('iframe').first().locator('[data-puck-component="e2e-col"]').waitFor();
  await page.getByRole('list').getByText('Outline').click();
  await page.locator('[class*="Layer"]').getByText('Collection', { exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Hand-picked' }).waitFor();
  await page.getByRole('checkbox', { name: 'Events', exact: true }).locator('visible=true').check();
  await page.getByRole('checkbox', { name: 'Posts', exact: true }).locator('visible=true').uncheck();
  await page.getByRole('checkbox', { name: 'E2E Tag', exact: true }).locator('visible=true').check();
  await page.getByLabel('How many').locator('visible=true').fill('1');
  await page.getByLabel('Card design').locator('visible=true').selectOption('event');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'reference/collections-e2e-after-card.png' });
  await page.getByLabel('Pagination').locator('visible=true').selectOption('load-more');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'reference/collections-e2e-editor.png' });
  const canvas = page.frameLocator('iframe').first();
  out.canvasCards = await canvas.locator('.c-entry').count();
  await publish(page);

  const pub = await html(`/${slug}/`);
  out.publicCards = (pub.match(/class="c-entry c-entry--event"/g) ?? []).length;
  out.loadMoreButton = pub.includes('c-collection__more-button');
  const view = await browser.newPage();
  view.on('pageerror', (e) => errors.push(e.message));
  await view.goto(`${origin}/${slug}/`);
  await view.locator('.c-collection__more-button').click();
  await view.waitForTimeout(2000);
  out.afterLoadMore = await view.locator('.c-entry--event').count();
  out.buttonGone = (await view.locator('.c-collection__more-button').count()) === 0;
  await view.screenshot({ path: 'reference/collections-e2e-public.png', fullPage: true });
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
} finally {
  await sb.from('entries').delete().eq('id', pageRow!.id);
  const { data: t } = await sb.from('terms').select('id').eq('taxonomy', 'tag').eq('slug', 'e2e-tag').maybeSingle();
  if (t) await sb.from('terms').delete().eq('id', t.id);
  for (const e of events!) await sb.from('revisions').delete().eq('entry_id', e.id);
  await browser.close();
}
