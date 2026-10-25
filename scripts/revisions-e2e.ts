// Revisions in the editor's left rail: saves are listed (newest first, with what the save did); a
// revision previews as it was and restores into the editor as undoable, unsaved changes.
//   npx tsx --env-file=.env scripts/revisions-e2e.ts
import { chromium, type Page } from 'playwright';
import { siteDb } from '../src/lib/supabase';

const origin = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const sb = siteDb();
const content = { root: { props: {} }, zones: {}, content: [{ type: 'section', props: { id: 'r1', attrs: { layout: { type: 'constrained', contentSize: '720px' } }, children: [{ type: 'heading', props: { id: 'r1h', attrs: { level: 2, content: 'Version A' } } }] } }] };
await sb.from('entries').delete().eq('type', 'page').eq('slug', 'e2e-revisions');
const { data: row, error } = await sb.from('entries').insert({ type: 'page', slug: 'e2e-revisions', title: 'E2E Revisions', status: 'publish', fields: {}, content }).select('id').single();
if (error) throw error;
const id = row!.id;
const live = async () => ((await (await fetch(`${origin}/e2e-revisions/`)).text()).match(/<h2[^>]*>([^<]*)</)?.[1] ?? '');
const out: Record<string, unknown> = {};
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const canvas = page.frameLocator('iframe').first();
const heading = () => canvas.locator('h2').first().innerText();
const setHeading = async (p: Page, text: string) => {
  await canvas.locator('h2').first().click();
  const ed = p.locator('[contenteditable=true]:visible').first();
  await ed.waitFor();
  await ed.fill(text);
  await p.waitForTimeout(1000);
};
try {
  await page.goto(`${origin}/admin/login/`);
  await page.fill('input[name=email]', process.env.LOCAL_ADMIN_EMAIL!);
  await page.fill('input[name=password]', process.env.LOCAL_ADMIN_PASSWORD!);
  await Promise.all([page.waitForURL(/\/admin\/(?!login)/), page.click('button:has-text("Sign in")')]);
  await page.goto(`${origin}/admin/edit/${id}/`);
  await canvas.locator('h2').first().waitFor();

  await setHeading(page, 'Version B');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByText(/Draft saved \d/).waitFor();
  await setHeading(page, 'Version C');
  await page.getByRole('button', { name: 'Publish changes' }).click();
  await page.getByText(/Published \d/).waitFor();
  out.liveNow = await live();

  // The rail: Revisions below Blocks and Outline.
  await page.getByText('Revisions', { exact: true }).first().click();
  const list = page.locator('ol li').filter({ hasText: /Draft saved|Published/ });
  await list.first().waitFor();
  out.listed = (await list.allInnerTexts()).map((t) => t.split('\n').slice(0, 2).join(' | '));

  // Preview the draft revision (B).
  const draftRow = list.filter({ hasText: 'Draft saved' }).first();
  const [tab] = await Promise.all([page.context().waitForEvent('page'), draftRow.getByRole('link', { name: 'Preview' }).click()]);
  await tab.waitForLoadState();
  out.previewOfDraft = { heading: await tab.locator('h2').first().innerText(), bar: await tab.getByText(/Preview of the version saved/).count() };
  await tab.close();

  // Restore it: the canvas shows B, unsaved; Undo brings back C.
  await draftRow.getByRole('button', { name: 'Restore' }).click();
  await page.waitForTimeout(1500);
  out.afterRestore = { heading: await heading(), status: (await page.getByText(/Restored the version/).count()) > 0, live: await live() };
  await page.locator('header button[title="undo"]').first().click();
  await page.waitForTimeout(1200);
  out.afterUndo = await heading();
  await page.locator('header button[title="redo"]').first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Publish changes' }).click();
  await page.getByText(/Published \d/).waitFor();
  out.liveAfterRestorePublish = await live();
  // The save that kept the restored version says so.
  await page.getByText(/Restored from/).first().waitFor({ timeout: 10000 });
  out.restoredNote = await page.getByText(/Restored from/).first().innerText();
  await page.screenshot({ path: 'reference/revisions-e2e.png' });
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
} finally {
  await sb.from('entries').delete().eq('id', id);
  await b.close();
}
