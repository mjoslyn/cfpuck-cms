// Notification messages as rich text: an older plain-text message still emails with its line breaks;
// a message written in the form builder (bold, a list, a field tag inserted mid-sentence) emails as HTML
// with the visitor's value escaped. Uses the local mail catcher (SMTP_URL, inbox at LOCAL_MAIL_URL) and a
// temporary form and page.
//   npx tsx --env-file=.env scripts/notification-e2e.ts
import { chromium } from 'playwright';
import { siteDb } from '../src/lib/supabase';

const MAIL = process.env.LOCAL_MAIL_URL ?? 'http://127.0.0.1:56524';
const origin = 'http://localhost:4321';
const sb = siteDb();
const out: any = {};
const def = (id: number) => ({ id, title: 'E2E Mail', fields: [{ id: 'f1', type: 'text', label: 'Name', required: true }, { id: 'f2', type: 'email', label: 'Email' }], submitLabel: 'Send', honeypot: true, nextId: 3, confirmation: { type: 'message', message: 'Thanks' } });
const { data: form } = await sb.from('forms').insert({ title: 'E2E Mail', definition: {}, notifications: [{ id: 'n1', name: 'Test', to: 'e2e-notify@example.com', subject: 'E2E rich message', message: 'Plain line one\nline two\n\n{all_fields}' }], is_active: true }).select('id').single();
await sb.from('forms').update({ definition: def(form!.id) }).eq('id', form!.id);
const { data: pg } = await sb.from('entries').insert({ type: 'page', slug: 'e2e-mail', title: 'E2E Mail', status: 'publish', fields: {}, content: { root: { props: {} }, zones: {}, content: [{ type: 'form', props: { id: 'fm', attrs: { formId: form!.id } } }] } }).select('id').single();
const latest = async () => {
  const list = await (await fetch(`${MAIL}/api/v1/search?query=` + encodeURIComponent('subject:"E2E rich message"'))).json();
  const id = list.messages?.[0]?.ID;
  if (!id) return null;
  const m = await (await fetch(`${MAIL}/api/v1/message/${id}`)).json();
  out.lastText = m.Text?.replace(/\s+/g, ' ').slice(0, 160);
  return m.HTML;
};
const submit = async () => {
  const body = new URLSearchParams({ _form: String(form!.id), f1: 'Robin <Tester>', f2: 'robin@example.com' });
  await fetch(`${origin}/e2e-mail/`, { method: 'POST', body, headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' } });
  await new Promise((r) => setTimeout(r, 1500));
};
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
page.on('dialog', (d) => d.accept('https://example.com/'));
try {
  // 1. An old plain-text message still sends with its line breaks.
  await submit();
  out.legacyHtml = (await latest())?.replace(/\s+/g, ' ').slice(0, 160);

  // 2. Write a rich message in the builder.
  await page.goto(`${origin}/admin/login/`);
  await page.fill('input[name=email]', process.env.LOCAL_ADMIN_EMAIL!);
  await page.fill('input[name=password]', process.env.LOCAL_ADMIN_PASSWORD!);
  await Promise.all([page.waitForURL(/\/admin\/(?!login)/), page.click('button:has-text("Sign in")')]);
  await page.goto(`${origin}/admin/forms/${form!.id}/`);
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const box = page.getByRole('textbox', { name: 'Message' });
  out.shownAsParagraphs = await box.innerHTML();
  await box.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Hello from ');
  await page.getByRole('group', { name: 'Message' }).locator('select').selectOption({ label: 'Name' });
  await page.keyboard.type(', thanks!');
  await page.keyboard.press('Meta+a');
  await page.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Bulleted list' }).click();
  await page.keyboard.type('First point');
  await page.waitForTimeout(500);
  out.editorHtml = await box.innerHTML();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Saved').first().waitFor();
  out.saved = (await sb.from('forms').select('notifications').eq('id', form!.id).single()).data!.notifications[0].message;

  // 3. The email carries the rich message with the value filled in (escaped).
  await submit();
  out.richHtml = (await latest())?.replace(/\s+/g, ' ').slice(0, 300);
  console.log(JSON.stringify(out, null, 1));
} finally {
  await sb.from('entries').delete().eq('id', pg!.id);
  await sb.from('form_submissions').delete().eq('form_id', form!.id);
  await sb.from('forms').delete().eq('id', form!.id);
  await b.close();
}
