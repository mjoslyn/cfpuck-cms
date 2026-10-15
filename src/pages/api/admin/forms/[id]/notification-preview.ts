// A notification's preview, from the email builder (src/forms/EmailBuilder.tsx).
// GET: the form's recent submissions, to pick one. POST { notification, definition?, submissionId? }:
// the email as it would be sent for that submission, or for sample answers without one (recipients,
// reply-to, subject, HTML, text); `definition` lets unsaved form changes show. Nothing is sent.
import type { APIRoute } from 'astro';
import { renderNotification } from '../../../../../lib/forms/submit';
import { INPUT_TYPES } from '../../../../../lib/forms/logic';
import type { FormDef, FormRow, Notification, SubmissionPayment, Values } from '../../../../../lib/forms/types';
import { currencyOf, defaultProductValue, lineItems, totalOf } from '../../../../../lib/forms/payment';

/** Sample answers: something plausible for each field, so every part of the email shows. */
function sampleValues(def: FormDef): Values {
  const values: Values = {};
  for (const f of def.fields) {
    if (!INPUT_TYPES.includes(f.type) || f.type === 'hidden') continue;
    const first = f.choices?.[0];
    switch (f.type) {
      case 'email': values[f.id] = 'alex@example.com'; break;
      case 'phone': values[f.id] = '(716) 555-0100'; break;
      case 'number': values[f.id] = '42'; break;
      case 'url': values[f.id] = 'https://example.com'; break;
      case 'date': values[f.id] = new Date().toISOString().slice(0, 10); break;
      case 'textarea': values[f.id] = `A longer answer for ${f.label}.\nOn a second line.`; break;
      case 'name': values[f.id] = { first: 'Alex', last: 'Sample' }; break;
      case 'checkbox': values[f.id] = (f.choices ?? []).slice(0, 2).map((c) => c.value || c.label); break;
      case 'select':
      case 'radio': if (first) values[f.id] = first.value || first.label; break;
      case 'product': values[f.id] = { ...defaultProductValue(f), ...(f.priceMode === 'choice' && first ? { value: first.value } : {}), ...(f.priceMode === 'amount' ? { value: '25' } : {}), ...(f.quantity ? { qty: '2' } : {}) }; break;
      default: values[f.id] = `Sample ${f.label}`.trim();
    }
  }
  return values;
}

export const GET: APIRoute = async ({ params, locals }) => {
  const { data, error } = await locals.db.from('form_submissions').select('id, created_at, data').eq('form_id', Number(params.id)).order('created_at', { ascending: false }).limit(50);
  if (error) return new Response(error.message, { status: 400 });
  return Response.json(
    (data ?? []).map((s: any) => {
      const labelled = (s.data?.values ?? {}) as Record<string, unknown>;
      const first = Object.values(labelled).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
      return { id: s.id, created_at: s.created_at, summary: first ? first.slice(0, 60) : '' };
    }),
  );
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const id = Number(params.id);
  const { data: form, error } = await locals.db.from('forms').select('id, title, definition, notifications, is_active').eq('id', id).maybeSingle();
  if (error) return new Response(error.message, { status: 400 });
  if (!form) return new Response('That form no longer exists.', { status: 404 });
  const row: FormRow = { ...(form as FormRow), definition: body.definition?.fields ? body.definition : form.definition };
  const n = body.notification as Notification | undefined;
  if (!n || typeof n !== 'object') return new Response('No notification.', { status: 400 });
  let values: Values = sampleValues(row.definition);
  let payment: SubmissionPayment | null = null;
  if (body.submissionId) {
    const { data: sub } = await locals.db.from('form_submissions').select('data, payment').eq('id', Number(body.submissionId)).eq('form_id', id).maybeSingle();
    if (!sub) return new Response('That submission no longer exists.', { status: 404 });
    values = ((sub as any).data?.entry ?? {}) as Values;
    payment = (sub as any).payment ?? null;
  } else if (row.definition.payment) {
    // A sample payment, so {payment_total} and {payment_id} show.
    const items = lineItems(row.definition, values);
    payment = { provider: row.definition.payment.provider, status: 'paid', amount: totalOf(items), currency: currencyOf(row.definition), items, payment_id: 'sample-payment-id', token: '', page: '', origin: '' };
  }
  return Response.json(renderNotification(row, n, values, new URL(request.url).origin, payment));
};
