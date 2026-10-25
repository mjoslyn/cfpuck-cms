// End-to-end editor check: edit a heading on /about/, publish, verify the public page, then restore.
//   npx tsx --env-file=.env scripts/admin-e2e.ts
import { chromium } from 'playwright';
import { siteDb } from '../src/lib/db/site';

const origin = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const sb = siteDb();
const { data: before } = await sb.from('entries').select('id, content, title, fields, excerpt_rendered').eq('type', 'page').eq('slug', 'about').single();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`${origin}/admin/login/`);
  await page.fill('input[name=email]', process.env.LOCAL_ADMIN_EMAIL!);
  await page.fill('input[name=password]', process.env.LOCAL_ADMIN_PASSWORD!);
  await Promise.all([page.waitForURL(/\/admin\/(?!login)/), page.click('button:has-text("Sign in")')]);
  await page.goto(`${origin}/admin/edit/${before!.id}/`, { waitUntil: 'networkidle' });
  const canvas = page.frameLocator('iframe#preview-frame, iframe').first();
  await canvas.locator('h2:has-text("The Village")').first().click();
  const editor = page.locator('[contenteditable=true]:visible').first();
  await editor.waitFor({ timeout: 10_000 });
  await editor.fill('The Village Today');
  await page.waitForTimeout(1200);
  const inCanvas = await canvas.locator('h2:has-text("The Village Today")').count();
  await page.screenshot({ path: 'reference/admin-e2e-after-typing.png' });
  const bodyText = (await page.locator('body').innerText()).slice(0, 300);
  void bodyText;
  await page.getByRole('button', { name: /^Publish( changes)?$/ }).click();
  await page.waitForTimeout(1500);
  const html = await (await fetch(`${origin}/about/`)).text();
  const published = html.includes('The Village Today');
  const layoutKept = html.includes('c-constrained');
  console.log(JSON.stringify({ canvasUpdated: inCanvas > 0, published, layoutKept, errors }, null, 1));
} finally {
  await sb.from('entries').update({ content: before!.content, title: before!.title, fields: before!.fields, excerpt_rendered: before!.excerpt_rendered }).eq('id', before!.id);
  await sb.from('revisions').delete().eq('entry_id', before!.id);
  await browser.close();
}
