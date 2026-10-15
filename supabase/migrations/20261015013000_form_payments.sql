-- Payments for forms (src/lib/forms/checkout.ts): a submission's charge and where it stands
-- (SubmissionPayment in src/lib/forms/types.ts: provider, status, amount, items, the provider's
-- checkout id as `ref`, Square's order as `order`...). Null for submissions without one. Webhooks find a
-- submission by `ref` (Stripe) or `order` (Square).
-- Written only with the service key, like the rest of a submission; editors read it with the row.

alter table public.form_submissions add column payment jsonb;

create index form_submissions_payment_ref on public.form_submissions ((payment ->> 'ref')) where payment is not null;
create index form_submissions_payment_order on public.form_submissions ((payment ->> 'order')) where payment ? 'order';
