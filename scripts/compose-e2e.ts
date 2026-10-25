// Compose as a conversation, against the real API (needs ANTHROPIC_API_KEY): start on /admin/compose/
// with a brief, a text document, two library images (multi-select) and a YouTube link; land in the
// editor with the conversation docked; ask for a change; publish; reload and find the conversation
// and the pin kept. Deletes the page afterwards.
//   npx tsx --env-file=.env scripts/compose-e2e.ts
import { chromium } from 'playwright';
import { siteDb } from '../src/lib/supabase';

const origin = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const sb = siteDb();
const out: Record<string, unknown> = {};
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
let entryId = 0;
const sections = async () => (await sb.from('entries').select('content').eq('id', entryId).single()).data!.content.content.length;
try {
  await page.goto(`${origin}/admin/login/`);
  await page.fill('input[name=email]', process.env.LOCAL_ADMIN_EMAIL!);
  await page.fill('input[name=password]', process.env.LOCAL_ADMIN_PASSWORD!);
  await Promise.all([page.waitForURL(/\/admin\/(?!login)/), page.click('button:has-text("Sign in")')]);

  // 1. Start a page from the admin.
  await page.goto(`${origin}/admin/compose/`);
  await page.locator('textarea').fill('A short page about fall foliage weekends in our town: when to come, where to see the colours, and what else to do that weekend. Keep it to about four sections.');
  await page.locator('input[type=file]').setInputFiles({ name: 'foliage-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Peak colour is usually the first two weeks of October. The chairlift at the ski hill runs scenic rides on fall weekends. The Fall Festival is the weekend after Columbus Day.') });
  await page.getByRole('button', { name: 'Media library' }).click();
  const tiles = page.locator('button[aria-pressed]');
  await tiles.nth(0).click();
  await tiles.nth(1).click();
  out.multiSelected = await page.locator('button[aria-pressed="true"]').count();
  await page.getByRole('button', { name: /Add 2 selected/ }).click();
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByPlaceholder(/YouTube and Vimeo/).fill('https://www.youtube.com/watch?v=vAUEZhXa1DI');
  await page.getByPlaceholder(/YouTube and Vimeo/).press('Enter');
  await page.screenshot({ path: 'reference/compose-e2e-start.png' });
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForURL(/\/admin\/edit\/\d+\/\?compose=1/, { timeout: 300_000 }).catch(async (e) => {
    await page.screenshot({ path: 'reference/compose-e2e-failed.png' });
    console.log('chat:', (await page.locator('.overflow-auto').first().innerText()).slice(-1500));
    throw e;
  });
  entryId = Number(page.url().match(/edit\/(\d+)/)![1]);
  out.firstBuild = await sections();
  const seo = async () => (await sb.from('entries').select('fields').eq('id', entryId).single()).data!.fields?.seo;
  // Compose writes the page's SEO with the first build...
  out.seoFirst = await seo();

  // 2. The conversation is docked beside the editor; ask for a change.
  const panel = page.getByRole('complementary', { name: 'Compose with Claude' });
  await panel.waitFor();
  await panel.getByText('Updated the page').first().waitFor({ timeout: 30_000 });
  const updatesBefore = await panel.getByText('Updated the page').count();
  out.turnsShown = await panel.locator('.rounded-lg').count();
  await panel.locator('textarea').fill('Add a short FAQ section with two questions near the end, and make the first heading shorter.');
  await panel.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('aside p.text-xs').length && [...document.querySelectorAll('aside p')].filter((p) => p.textContent?.startsWith('Updated the page')).length > n, updatesBefore, { timeout: 300_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'reference/compose-e2e-editor.png' });
  const canvas = page.frameLocator('iframe').first();
  out.faqInCanvas = (await canvas.locator('h2').allInnerTexts()).some((t) => /question|faq/i.test(t));
  await page.getByRole('button', { name: /^Publish( changes)?$/ }).click();
  await page.waitForTimeout(2000);
  out.afterUpdate = await sections();
  // ...and keeps it current on later builds (through the editor's form, saved with the page).
  out.seoAfterUpdate = await seo();

  // 3. Pin, reload: the conversation and the pin are kept.
  await panel.getByRole('button', { name: 'Pin' }).click();
  await page.goto(`${origin}/admin/edit/${entryId}/`);
  await panel.waitFor();
  await panel.getByText('Updated the page').last().waitFor({ timeout: 30_000 });
  out.persistedTurns = await panel.locator('.rounded-lg').count();
  out.pinnedAfterReload = (await panel.getByRole('button', { name: 'Pinned' }).count()) === 1;
  await panel.getByRole('button', { name: 'Pinned' }).click();
  const { data: sess } = await sb.from('compose_sessions').select('turns, materials').eq('entry_id', entryId).single();
  out.session = { turns: sess!.turns.length, images: sess!.materials.images.length, videos: sess!.materials.videos.length, docs: sess!.materials.docs.length };
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
} finally {
  if (entryId) await sb.from('entries').delete().eq('id', entryId);
  await b.close();
}
