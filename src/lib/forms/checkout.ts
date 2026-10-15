// Payment for forms. A submission with a total is stored as pending (form_submissions.payment) and the
// visitor goes to the provider's checkout (src/lib/payments/); they come back to the form's page with
// ?form_payment=<submission id>.<token>, and the provider's webhook (/api/payments/<provider>) reports
// the same. Either way the site asks the provider where the checkout stands (nothing in a redirect or a
// webhook is taken as given): once it is paid, the submission is marked paid and its notifications go,
// exactly once (the update that flips it to paid is the one that sends).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FormResult, FormRow, SubmissionPayment, Values } from './types';
import { MAX_CHARGE, currencyOf, totalOf, type LineItem } from './payment';
import { MIN_CHARGE, formatMoney } from '../payments/money';
import { PROVIDERS, type PaymentProvider } from '../payments';
import { env, sameString } from '../payments/common';
import { confirmationResult, mergeTags, notify } from './submit';
import { site } from '../site';
import { serviceClient } from '../supabase';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The query parameter a visitor comes back from checkout with. */
export const RETURN_PARAM = 'form_payment';

const token = () => [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');

interface Stored {
  entry: Values;
  values: Record<string, string>;
  referrer?: string;
  user_agent?: string;
}

/** Store the submission as pending and start a checkout for it; the visitor is sent to `url`. */
export async function startCheckout(db: SupabaseClient, form: FormRow, data: Stored, items: LineItem[], request: Request): Promise<{ url: string } | { error: string }> {
  const settings = form.definition.payment!;
  const provider = PROVIDERS[settings.provider];
  const amount = totalOf(items);
  const currency = currencyOf(form.definition);
  if (!provider?.configured()) {
    console.error(`form ${form.id}: payment by ${settings.provider} is not set up`);
    return { error: 'This form can’t take payments at the moment, so it wasn’t sent. Please try again later or contact us.' };
  }
  if (amount < MIN_CHARGE) return { error: `The total is below the smallest amount we can take (${formatMoney(MIN_CHARGE, currency)}).` };
  if (amount > MAX_CHARGE) return { error: 'The total is more than this form can take in one payment.' };

  const url = new URL(request.url);
  const payment: SubmissionPayment = {
    provider: settings.provider,
    status: 'pending',
    amount,
    currency,
    items: items.map(({ name, unit, quantity }) => ({ name, unit, quantity })),
    token: token(),
    page: url.pathname,
    origin: url.origin,
    ...(provider.sandbox() ? { sandbox: true } : {}),
  };
  const { data: row, error } = await db.from('form_submissions').insert({ form: form.title, form_id: form.id, data, payment }).select('id').single();
  if (error) throw error;
  const id = row.id as number;

  const emailField = form.definition.fields.find((f) => f.id === settings.emailField) ?? form.definition.fields.find((f) => f.type === 'email');
  const email = emailField ? String(data.entry[emailField.id] ?? '') : '';
  const adminEmail = env('FORMS_ADMIN_EMAIL') || site.adminEmail;
  try {
    const checkout = await provider.create({
      reference: String(id),
      idempotencyKey: `form-${id}-${payment.token.slice(0, 16)}`,
      items,
      currency,
      description: settings.description ? mergeTags(settings.description, form, data.entry, { html: false, adminEmail }).trim() : form.title,
      email: EMAIL.test(email) ? email : undefined,
      returnUrl: `${url.origin}${url.pathname}?${RETURN_PARAM}=${id}.${payment.token}`,
    });
    await db.from('form_submissions').update({ payment: { ...payment, ref: checkout.ref, ...(checkout.order ? { order: checkout.order } : {}) } }).eq('id', id).throwOnError();
    return { url: checkout.url };
  } catch (e) {
    console.error(`form ${form.id}: checkout for submission ${id} failed`, e);
    await db.from('form_submissions').update({ payment: { ...payment, status: 'failed' } }).eq('id', id);
    return { error: 'We couldn’t start the payment, so the form wasn’t sent. Please try again in a few minutes.' };
  }
}

interface Submission {
  id: number;
  form_id: number | null;
  data: Stored;
  payment: SubmissionPayment;
}

/**
 * Ask the provider where a submission's checkout stands and record it. Paid: marked paid and notified
 * (only by the call whose update flips it). Returns the submission as it now is.
 */
export async function confirmPayment(db: SupabaseClient, sub: Submission): Promise<Submission> {
  const p = sub.payment;
  if (!p?.ref || p.status === 'paid' || p.status === 'failed') return sub;
  const state = await PROVIDERS[p.provider].check({ ref: p.ref, order: p.order });
  if (state.status === 'pending' || state.status === p.status) return sub;
  if (state.status === 'paid' && state.amount != null && state.amount !== p.amount) {
    // Never expected (the site sets the amount); recorded rather than trusted.
    console.error(`submission ${sub.id}: paid ${state.amount}, expected ${p.amount}`);
  }
  const next: SubmissionPayment = {
    ...p,
    status: state.status,
    ...(state.paymentId ? { payment_id: state.paymentId } : {}),
    ...(state.status === 'paid' ? { paid_at: new Date().toISOString() } : {}),
  };
  // Only from where it stood when read, so two confirmations at once record (and notify) once.
  const { data, error } = await db.from('form_submissions').update({ payment: next }).eq('id', sub.id).eq('payment->>status', p.status).select('id');
  if (error) throw error;
  if (!data?.length) return (await loadSubmission(db, sub.id)) ?? sub;
  const updated = { ...sub, payment: next };
  if (next.status === 'paid' && sub.form_id) {
    const form = await loadForm(db, sub.form_id);
    if (form) await notify(form, sub.data.entry ?? {}, p.origin, next);
  }
  return updated;
}

/** A bank payment that failed after checkout (Stripe's async_payment_failed, from a signed webhook). */
export async function markPaymentFailed(db: SupabaseClient, sub: Submission) {
  if (sub.payment.status !== 'processing' && sub.payment.status !== 'pending') return;
  await db.from('form_submissions').update({ payment: { ...sub.payment, status: 'failed' } }).eq('id', sub.id).eq('payment->>status', sub.payment.status);
}

async function loadSubmission(db: SupabaseClient, id: number): Promise<Submission | null> {
  const { data, error } = await db.from('form_submissions').select('id, form_id, data, payment').eq('id', id).maybeSingle();
  if (error) throw error;
  return data?.payment ? (data as Submission) : null;
}

async function loadForm(db: SupabaseClient, id: number): Promise<FormRow | null> {
  const { data, error } = await db.from('forms').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as FormRow) ?? null;
}

/** The submission a provider's checkout (`ref`) or Square order (`order`) belongs to. */
async function submissionBy(db: SupabaseClient, key: 'ref' | 'order', value: unknown): Promise<Submission | null> {
  if (!value) return null;
  const { data, error } = await db.from('form_submissions').select('id, form_id, data, payment').eq(`payment->>${key}`, String(value)).limit(1).maybeSingle();
  if (error) throw error;
  return data?.payment ? (data as Submission) : null;
}

/**
 * A provider's webhook (/api/payments/<provider>, signature checked there): it only says which checkout
 * to look at, whose state is then asked of the provider. Checkouts that aren't a form's are ignored.
 */
export async function formsWebhook(provider: PaymentProvider, event: any) {
  const type = String(event?.type ?? '');
  const obj = event?.data?.object ?? {};
  const db = serviceClient();
  if (provider === 'stripe' && type.startsWith('checkout.session.') && obj.object === 'checkout.session') {
    const sub = await submissionBy(db, 'ref', obj.id);
    if (!sub) return;
    if (type === 'checkout.session.async_payment_failed') await markPaymentFailed(db, sub);
    else await confirmPayment(db, sub);
  } else if (provider === 'square' && type.startsWith('payment.')) {
    const sub = await submissionBy(db, 'order', obj.payment?.order_id);
    if (sub) await confirmPayment(db, sub);
  }
}

/**
 * A visitor back from checkout (?form_payment=<id>.<token>): the confirmation once paid (or a bank
 * payment is on its way), else the form again with their answers and a note that it wasn't sent.
 */
export async function paymentReturn(db: SupabaseClient, param: string): Promise<FormResult | null> {
  const m = param.match(/^(\d+)\.([0-9a-f]{36})$/);
  if (!m) return null;
  let sub = await loadSubmission(db, Number(m[1]));
  if (!sub || !sub.form_id || !sameString(sub.payment.token, m[2])) return null;
  try {
    sub = await confirmPayment(db, sub);
    // Square sends the visitor back once paid; its order can take a moment to show the payment.
    if (sub.payment.status === 'pending' && sub.payment.provider === 'square') {
      await new Promise((r) => setTimeout(r, 1500));
      sub = await confirmPayment(db, sub);
    }
  } catch (e) {
    console.error(`submission ${sub.id}: payment check failed`, e);
  }
  const form = await loadForm(db, sub.form_id!);
  if (!form) return null;
  const entry = sub.data.entry ?? {};
  if (sub.payment.status === 'paid' || sub.payment.status === 'processing') return confirmationResult(db, form, entry, sub.payment);
  return {
    formId: form.id,
    ok: false,
    message: '',
    errors: {},
    values: entry,
    notice: 'Your payment wasn’t completed, so the form wasn’t sent. Check your answers and submit it again to pay.',
  };
}
