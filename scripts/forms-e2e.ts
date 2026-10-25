// End-to-end form builder check: create a form in /admin/forms/, add fields and conditional logic in the
// builder, save, place it on a temporary page with the Form block, submit it (hidden-by-logic fields are
// skipped by validation), then delete the page, form and submissions.
//   npx tsx --env-file=.env scripts/forms-e2e.ts
import { chromium } from 'playwright';
import { siteDb } from '../src/lib/db/site';

const origin = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const sb = siteDb();
const out: Record<string, unknown> = {};
const errors: string[] = [];
let formId = 0;
let pageId = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'E2E Volunteer Signup' : undefined));
try {
  await page.goto(`${origin}/admin/login/`);
  await page.fill('input[name=email]', process.env.LOCAL_ADMIN_EMAIL!);
  await page.fill('input[name=password]', process.env.LOCAL_ADMIN_PASSWORD!);
  await Promise.all([page.waitForURL(/\/admin\/(?!login)/), page.click('button:has-text("Sign in")')]);

  // New form from the list page.
  await page.goto(`${origin}/admin/forms/`);
  await Promise.all([page.waitForURL(/\/admin\/forms\/\d+\/$/), page.click('#new-form')]);
  formId = Number(page.url().match(/forms\/(\d+)/)![1]);
  await page.waitForSelector('text=Standard');

  // Add fields by clicking the palette; each lands below the selected one.
  for (const label of ['Name', 'Email', 'Multiple choice', 'Paragraph text']) await page.click(`aside button:has-text("${label}")`);
  const preview = page.frameLocator('iframe[title="Form preview"]');
  out.fieldsInPreview = await preview.locator('[data-field]').count();

  // Paragraph (selected last): relabel and make it depend on the multiple choice answer.
  await page.fill('aside label:has-text("Label") input', 'Tell us more');
  await page.click('button:has-text("Show or hide based on answers")');
  const ruleSelects = page.locator('aside .rounded.border select');
  await ruleSelects.nth(0).selectOption({ label: 'Multiple choice' });
  await ruleSelects.nth(2).selectOption({ label: 'Second choice' });
  out.conditionalBadge = await preview.locator('[data-field][data-logic]').count();

  // Select the email field in the preview and make it required.
  await preview.locator('.c-field.is-email').click();
  await page.check('aside label:has-text("Required") input');
  out.requiredMarkInPreview = await preview.locator('.c-field.is-email .c-field__req').count();

  // Drag the paragraph above the name field.
  await preview.locator('.c-field.is-textarea').dragTo(preview.locator('.c-field.is-name'), { targetPosition: { x: 20, y: 5 } });
  out.firstFieldAfterDrag = await preview.locator('[data-field]').first().getAttribute('class').then((c) => c?.match(/\bis-(\w+)/)?.[1]);

  await page.screenshot({ path: 'reference/forms-e2e-builder.png' });
  await page.keyboard.press('Meta+s');
  await page.getByText('Saved', { exact: true }).waitFor();

  const { data: saved } = await sb.from('forms').select('title, definition').eq('id', formId).single();
  const fields = saved!.definition.fields as any[];
  out.saved = { title: saved!.title, types: fields.map((f) => f.type), logic: fields.find((f) => f.type === 'textarea')?.logic };

  // Place it on a temporary page.
  const { data: p } = await sb
    .from('entries')
    .insert({ type: 'page', slug: 'e2e-form-test', title: 'E2E form test', status: 'publish', fields: {}, content: { root: { props: {} }, content: [{ type: 'form', props: { id: 'form-1', attrs: { formId, showTitle: true } } }] } })
    .select('id')
    .single();
  pageId = p!.id;
  await page.goto(`${origin}/e2e-form-test/`);
  out.renderedOnPage = await page.locator(`#form-${formId} [data-field]`).count();
  out.textareaHiddenByLogic = await page.locator('.c-field.is-textarea').isHidden();
  await page.click('.c-field.is-radio label:has-text("Second choice")');
  out.textareaShownByLogic = await page.locator('.c-field.is-textarea').isVisible();
  await page.click('.c-field.is-radio label:has-text("First choice")');

  // Submit with the email missing, then fixed.
  await page.fill('.c-subfield.is-first input', 'Robin');
  await page.fill('.c-subfield.is-last input', 'Tester');
  await page.click(`#form-${formId} .c-form__submit`);
  await page.waitForLoadState('load');
  out.errorsShown = await page.locator('.c-field__error').allInnerTexts();
  out.valueKept = await page.inputValue('.c-subfield.is-first input');
  await page.fill('.c-field.is-email input', 'robin@example.com');
  await page.click(`#form-${formId} .c-form__submit`);
  await page.waitForLoadState('load');
  out.confirmation = (await page.locator('.c-form__confirmation').innerText()).trim();
  const { data: subs } = await sb.from('form_submissions').select('data').eq('form_id', formId);
  out.stored = subs?.map((s) => s.data.values);
  await page.screenshot({ path: 'reference/forms-e2e-page.png', fullPage: true });
  console.log(JSON.stringify({ ...out, errors }, null, 1));
} catch (e) {
  console.log(JSON.stringify({ ...out, errors, failed: String(e).split('\n')[0] }, null, 1));
  if (pageId) await page.screenshot({ path: 'reference/forms-e2e-failure.png', fullPage: true });
  process.exitCode = 1;
} finally {
  if (pageId) await sb.from('entries').delete().eq('id', pageId);
  if (formId) {
    await sb.from('form_submissions').delete().eq('form_id', formId);
    await sb.from('forms').delete().eq('id', formId);
  }
  await browser.close();
}
