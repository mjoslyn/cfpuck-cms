// Form payments in the browser: build a form with Product fields and a payment provider in
// /admin/forms/, place it on a temporary page, check the live total and submit it: with the provider's
// keys set the visitor lands on its checkout page, else the form shows why it wasn't sent. Screenshots go
// to reference/. Removes the form, page and submissions after (KEEP=1 leaves them, ids printed).
//   npx tsx --env-file=.env scripts/payments-e2e.ts [stripe|square]
// PW_CHROMIUM=/opt/pw-browsers/chromium uses an installed Chromium in place of Playwright's.
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const origin = process.env.ASTRO_ORIGIN ?? 'http://localhost:4321';
const provider = process.argv[2] ?? 'stripe';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const out: Record<string, unknown> = {};
const errors: string[] = [];
const shot = (name: string) => `reference/payments-${provider}-${name}.png`;
let formId = 0;
let pageId = 0;

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? `E2E ${provider} payment` : undefined));
try {
  await page.goto(`${origin}/admin/login/`);
  await page.fill('input[name=email]', process.env.LOCAL_ADMIN_EMAIL!);
  await page.fill('input[name=password]', process.env.LOCAL_ADMIN_PASSWORD!);
  await Promise.all([page.waitForURL(/\/admin\/(?!login)/), page.click('button:has-text("Sign in")')]);

  await page.goto(`${origin}/admin/forms/`);
  await Promise.all([page.waitForURL(/\/admin\/forms\/\d+\/$/), page.click('#new-form')]);
  formId = Number(page.url().match(/forms\/(\d+)/)![1]);
  out.formId = formId;
  await page.waitForSelector('text=Pricing');
  const settings = page.locator('aside').filter({ has: page.locator('label:has-text("Label")') });
  const preview = page.frameLocator('iframe[title="Form preview"]');

  for (const label of ['Name', 'Email']) await page.click(`aside button:has-text("${label}")`);
  await settings.locator('label:has-text("Required") input').check();

  // A ticket at one price with a quantity.
  await page.click('aside button:has-text("Product")');
  await settings.locator('label:has-text("Label") input').first().fill('Ticket');
  await settings.locator('label:has-text("Price") input').fill('25');
  await settings.locator('label:has-text("The visitor chooses a quantity") input').check();
  await page.screenshot({ path: shot('product-fixed') });

  // A membership level: a choice of prices, as radio buttons.
  await page.click('aside button:has-text("Product")');
  await settings.locator('label:has-text("Label") input').first().fill('Membership');
  await settings.locator('label:has-text("Price") select').selectOption('choice');
  await settings.locator('label:has-text("Show as") select').selectOption('radio');
  await page.screenshot({ path: shot('product-choice') });

  // A donation the visitor enters.
  await page.click('aside button:has-text("Product")');
  await settings.locator('label:has-text("Label") input').first().fill('Donation');
  await settings.locator('label:has-text("Price") select').selectOption('amount');
  await settings.locator('label:has-text("Required") input').uncheck();
  await page.screenshot({ path: shot('product-amount') });
  out.previewProducts = await preview.locator('.c-field.is-product').count();

  // Payment tab.
  await page.click('nav button:has-text("Payment")');
  out.providerOptions = await page.locator('label:has-text("Take payment with") select option').allTextContents();
  await page.locator('label:has-text("Take payment with") select').selectOption(provider);
  await page.fill('label:has-text("Description of the payment") input', 'Example Town: {form_title}');
  await page.screenshot({ path: shot('payment-tab') });
  out.paymentWarning = await page.locator('text=in the site\'s environment').textContent().catch(() => null);
  await page.click('button:has-text("Save")');
  await page.getByText('Saved', { exact: true }).waitFor();

  const { data: saved } = await sb.from('forms').select('definition').eq('id', formId).single();
  out.saved = { payment: saved!.definition.payment, products: saved!.definition.fields.filter((f: any) => f.type === 'product').map((f: any) => ({ label: f.label, priceMode: f.priceMode, price: f.price, quantity: f.quantity, required: f.required, choices: f.choices, choiceDisplay: f.choiceDisplay })) };

  // On a page.
  const slug = `e2e-payments-${provider}`;
  await sb.from('entries').delete().eq('slug', slug);
  const { data: p, error } = await sb
    .from('entries')
    .insert({ type: 'page', slug, title: `E2E payments (${provider})`, status: 'publish', fields: {}, content: { root: { props: {} }, content: [{ type: 'form', props: { id: 'form-1', attrs: { formId, showTitle: true } } }] } })
    .select('id')
    .single();
  if (error) throw error;
  pageId = p!.id;
  out.pageId = pageId;
  await page.goto(`${origin}/${slug}/`);
  const form = page.locator(`#form-${formId}`);
  const total = form.locator('.c-form__total');
  out.totalAtFirst = await total.textContent().catch(() => null);
  await form.locator('.c-subfield.is-first input').fill('Robin');
  await form.locator('.c-subfield.is-last input').fill('Tester');
  await form.locator('input[type=email]').fill('robin@example.org');
  await form.locator('.c-field.is-product').nth(0).locator('input').last().fill('2');
  await form.locator('.c-field.is-product').nth(1).locator('label:has-text("Option two")').click();
  await form.locator('.c-field.is-product').nth(2).locator('input').fill('5.50');
  out.totalAfterAnswers = await total.textContent().catch(() => null);
  await page.screenshot({ path: shot('form'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: shot('form-phone'), fullPage: true });
  await page.setViewportSize({ width: 1600, height: 1000 });

  const nav = page.waitForNavigation({ timeout: 30_000 }).catch(() => null);
  await form.locator('.c-form__submit').click();
  await nav;
  out.afterSubmitUrl = page.url();
  out.atCheckout = !page.url().startsWith(origin);
  out.afterSubmitNotice = await page.locator('.c-form__errors').allTextContents();
  await page.screenshot({ path: shot('after-submit'), fullPage: true });

  // At the provider's checkout: pay (Stripe with its test card 4242 4242 4242 4242, Square through its
  // sandbox testing panel) and come back to the confirmation.
  if (out.atCheckout && provider === 'stripe') {
    // The card option's button sits under a cover that takes the pointer; a dispatched click opens it.
    await page.locator('[data-testid="card-accordion-item-button"]').dispatchEvent('click', undefined, { timeout: 30_000 }).catch(() => {});
    await page.locator('#cardNumber').waitFor({ timeout: 30_000 });
    await page.fill('#cardNumber', '4242 4242 4242 4242');
    await page.fill('#cardExpiry', '12 / 34');
    await page.fill('#cardCvc', '123');
    await page.fill('#billingName', 'Robin Tester');
    if (await page.locator('#billingPostalCode').isVisible().catch(() => false)) await page.fill('#billingPostalCode', '14731');
    if (await page.locator('#enableStripePass').isChecked().catch(() => false)) await page.locator('#enableStripePass').uncheck({ force: true });
    await page.screenshot({ path: shot('checkout'), fullPage: true });
    await Promise.all([page.waitForURL((u) => u.toString().startsWith(origin), { timeout: 90_000 }), page.locator('[data-testid="hosted-payment-submit-button"], .SubmitButton').first().click()]);
  } else if (out.atCheckout && provider === 'square') {
    // A sandbox payment link opens Square's testing panel, not a card form: Next, then Test Payment pays
    // the order, and the last step links to the return address (in a new tab) rather than redirecting.
    await page.locator('button:has-text("Next")').click({ timeout: 30_000 });
    await page.locator('button:has-text("Test Payment")').click({ timeout: 30_000 });
    const back = page.locator(`a[href^="${origin}"]`).first();
    await back.waitFor({ timeout: 60_000 });
    await page.screenshot({ path: shot('checkout'), fullPage: true });
    await page.goto((await back.getAttribute('href'))!); // it opens in a new tab
  }
  if (out.atCheckout) {
    await page.waitForLoadState('load');
    out.returnedTo = page.url();
    out.confirmation = await page.locator('.c-form__confirmation').textContent().catch(() => null);
    out.returnNotice = await page.locator('.c-form__errors').allTextContents();
    await page.screenshot({ path: shot('confirmation'), fullPage: true });
  }
  const { data: subs } = await sb.from('form_submissions').select('id, payment').eq('form_id', formId).order('id');
  out.submissions = subs?.map((s) => ({ id: s.id, ...s.payment, token: undefined }));
} catch (e) {
  errors.push(String(e));
  await page.screenshot({ path: shot('error') }).catch(() => {});
} finally {
  await browser.close();
  if (!process.env.KEEP) {
    if (pageId) await sb.from('entries').delete().eq('id', pageId);
    if (formId) {
      await sb.from('form_submissions').delete().eq('form_id', formId);
      await sb.from('forms').delete().eq('id', formId);
    }
  }
}
console.log(JSON.stringify({ ...out, errors }, null, 2));
