// Save draft / Publish in the page editor, on a temporary published page: a draft keeps the live page
// unchanged (and is listed as unpublished changes); publishing applies it; discard goes back to the
// live version; unpublish takes the page off the site and publish brings it back.
//   npx tsx --env-file=.env scripts/publishing-e2e.ts
import { chromium, type Page } from 'playwright';
import { siteDb } from '../src/lib/supabase';

const origin = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const sb = siteDb();
const content = { root: { props: {} }, zones: {}, content: [{ type: 'section', props: { id: 'p1', attrs: { layout: { type: 'constrained', contentSize: '720px' }, style: { padding: { top: 'var(--space-80)', bottom: 'var(--space-80)' } } }, children: [{ type: 'heading', props: { id: 'p1h', attrs: { level: 2, content: 'Original heading' } } }] } }] };
await sb.from('entries').delete().eq('type', 'page').eq('slug', 'e2e-publishing');
const { data: row, error } = await sb.from('entries').insert({ type: 'page', slug: 'e2e-publishing', title: 'E2E Publishing', status: 'publish', fields: {}, content }).select('id').single();
if (error) throw error;
const id = row!.id;
const pub = async () => {
  const r = await fetch(`${origin}/e2e-publishing/`);
  return r.status === 200 ? ((await r.text()).match(/<h2[^>]*>([^<]*)</)?.[1] ?? '') : `HTTP ${r.status}`;
};
const out: Record<string, unknown> = {};
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('dialog', (d) => d.accept());
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const canvas = page.frameLocator('iframe').first();
const editHeading = async (p: Page, text: string) => {
  await canvas.locator('h2').first().click();
  const ed = p.locator('[contenteditable=true]:visible').first();
  await ed.waitFor();
  await ed.fill(text);
  await p.waitForTimeout(1200);
};
const header = () => page.locator('header, [class*="Header"]').first().innerText();
try {
  await page.goto(`${origin}/admin/login/`);
  await page.fill('input[name=email]', process.env.LOCAL_ADMIN_EMAIL!);
  await page.fill('input[name=password]', process.env.LOCAL_ADMIN_PASSWORD!);
  await Promise.all([page.waitForURL(/\/admin\/(?!login)/), page.click('button:has-text("Sign in")')]);
  await page.goto(`${origin}/admin/edit/${id}/`);
  await canvas.locator('h2').first().waitFor();
  out.buttons = [await page.getByRole('button', { name: 'Save draft' }).count(), await page.getByRole('button', { name: 'Publish changes' }).count()];

  // 1. Preview unsaved changes, then save a draft: live page unchanged.
  await editHeading(page, 'Draft heading');
  out.unsavedShown = (await header()).includes('Unsaved changes');
  const [tab] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('button', { name: 'Preview' }).click()]);
  await tab.waitForLoadState();
  out.preview = { heading: await tab.locator('h2').first().innerText(), bar: (await tab.getByText(/Preview of unsaved changes/).count()) === 1, noindex: (await tab.locator('meta[name=robots]').getAttribute('content')) ?? '' };
  await tab.screenshot({ path: 'reference/publishing-e2e-preview.png' });
  await tab.close();
  out.liveDuringPreview = await pub();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByText(/Draft saved \d/).waitFor();
  out.liveAfterDraft = await pub();
  const saved = await page.request.get(`${origin}/admin/preview/${id}/`);
  out.savedDraftPreview = (await saved.text()).includes('Draft heading');
  await page.goto(`${origin}/admin/?type=page&q=E2E%20Publishing`);
  out.listedPending = await page.getByText('Unpublished changes').count();

  // 2. Reopen: the draft loads; publish it.
  await page.goto(`${origin}/admin/edit/${id}/`);
  await canvas.locator('h2', { hasText: 'Draft heading' }).waitFor();
  out.reopenedDraft = (await header()).includes('Unpublished changes');
  await page.getByRole('button', { name: 'Publish changes' }).click();
  await page.getByText(/Published \d/).waitFor();
  out.liveAfterPublish = await pub();

  // 3. Discard: back to the live version.
  await editHeading(page, 'Throwaway heading');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByText(/Draft saved \d/).waitFor();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await canvas.locator('h2', { hasText: 'Draft heading' }).waitFor();
  out.afterDiscard = { editor: await canvas.locator('h2').first().innerText(), live: await pub() };

  // 4. Unpublish, then publish again.
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await page.getByText(/Unpublished \d/).waitFor();
  out.liveAfterUnpublish = await pub();
  out.nowDraft = (await header()).includes('Draft');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByText(/Published \d/).waitFor();
  out.liveAfterRepublish = await pub();
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
} finally {
  await sb.from('entries').delete().eq('id', id);
  await b.close();
}
