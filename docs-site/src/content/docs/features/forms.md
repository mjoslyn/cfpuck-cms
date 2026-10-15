---
title: Forms
description: The form builder, submissions and notification mail.
sidebar:
  order: 4
---

## Building forms

The form builder is at `/admin/forms/` (`src/forms/FormBuilder.tsx`). Forms live in the `forms` table
(`src/lib/forms/types.ts`):

- fields with ids like `f1`, and widths on a 12-column grid
- conditional logic
- a confirmation message
- notification settings, in a column anon can't read

Place a form on a page with the `form` block.

## Rendering

The markup comes from `src/render/forms/form.ts`, styled by `src/styles/forms.css`.
`public/assets/js/forms.js` runs conditional logic, US phone formatting and character counters in
the browser. Everything is validated again on the server.

## Submissions

Submissions POST back to the page (`src/lib/forms/submit.ts`):

1. Validation, skipping fields hidden by conditional logic
2. A honeypot against spam
3. Limits: an answer is cut at 10,000 characters (or the field's own maximum), and a form takes at
   most 20 submissions a minute (more get a "try again in a minute" answer, status 429)
4. Storage
5. Notifications to the form's addresses, else `FORMS_ADMIN_EMAIL`, else the config's `adminEmail`

## Notification emails

Each notification's email is built in the **email builder** (Notifications, **Edit email**), a visual
editor like the page editor with blocks made for email:

| Block | Shows |
| --- | --- |
| Heading, Text | Text, with field values (Insert field value, or tags like `{Email:f3}`) |
| Button | A link styled as a button (a field tag works as the link, such as `mailto:{Email:f3}`) |
| Image | An image from the media library, optionally linked |
| Form field | One answer, with or without its label, or every answer as a table |
| Payment | The submission's payment: each item and its amount, the total, then its status, provider, payment ID and date (either part can be left out). Nothing on a submission without a payment |
| Section | A box with a background and padding, holding other blocks |
| Two columns | Blocks side by side, stacked on phones |
| Divider, Spacer | A line, or space |

The email's settings (the page) set its background, text and link colours, font, width and the
preview text inbox lists show after the subject.

What the builder shows is what is sent: email-safe HTML laid out with tables and inline styles, 600px
wide, with text kept to what mail apps show the same.

- **Plain text**: the text version, for mail apps that don't show HTML, with field values. Left empty,
  it is made from the visual design. **Fill from the visual design** starts from it.
- **Preview**: the email as it would be sent (recipients, reply-to, subject, the HTML at desktop and
  phone widths, and the text) for any stored submission, or for sample answers.

Notifications from before the builder keep sending their message as it was until they are opened in
the builder, which turns it into blocks.

## Payments

A form can take payment with **Stripe** or **Square**. Visitors pay on the provider's own checkout
page, so no card details reach the site.

1. Add **Product** fields (the Pricing group in the builder). A product has one price, a choice of
   priced options (a dropdown or multiple choice), or an amount the visitor enters (a donation, with
   an optional smallest and largest amount). One price or a choice can also take a quantity.
2. In the **Payment** tab, choose the provider, the currency, a description for the checkout page and
   receipt (merge tags allowed) and the email field the receipt goes to.

The form shows its total above the submit button and updates it as the visitor answers. Products that
conditional logic hides aren't charged, so a fee can depend on an answer.

When someone submits a form with something to pay:

1. The submission is stored as **Unpaid** and the visitor goes to checkout.
2. After paying they come back to the form's page and see its confirmation. If they come back without
   paying, the form shows again with their answers and a note that it wasn't sent.
3. The site asks the provider whether the checkout was paid (it never takes the visitor's return, or
   a webhook, as proof). Once paid, the submission is marked **Paid** and its notifications are sent,
   once. Webhooks catch visitors who pay and close the tab.

A submission with nothing to pay is sent at once, without checkout. Notifications can use
`{payment_total}`, `{payment_id}` and `{payment_summary}` (the items, total and details as text or a
table), the email builder's **Payment** block shows the same as a receipt, and `{all_fields}` ends with
the total. Submissions show each
payment's status, items and payment id, and the CSV export has payment columns.

### Setting up the providers

Keys are environment variables, never settings, so a local copy can't charge with production's keys.

| Variable | |
| --- | --- |
| `STRIPE_SECRET_KEY` | A secret key; `sk_test_...` for test mode |
| `STRIPE_WEBHOOK_SECRET` | The signing secret of a webhook endpoint at `<site>/api/payments/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired` |
| `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID` | The account's access token and the location payments go to |
| `SQUARE_ENVIRONMENT` | `sandbox` to test; production otherwise |
| `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_URL` | A webhook subscription to `payment.created` and `payment.updated` at `<site>/api/payments/square`: its signature key, and that exact address |

The Payment tab shows which providers are set up, and marks test and sandbox keys.

## Mail

Mail goes out over SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, or one
`SMTP_URL`. The sender is `MAIL_FROM`, defaulting to `mailFrom` in the site config. Without SMTP,
submissions are stored and no mail is sent.
