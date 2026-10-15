import type { EmailDoc } from './email';
// Form definitions (forms.definition) and submissions. Field ids are short strings ("f1"); a field
// posts under its id ("f1"), with parts for names ("f1[first]") and lists for checkboxes ("f1[]").

export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'url'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'name'
  | 'date'
  | 'consent'
  | 'product'
  | 'section'
  | 'html'
  | 'hidden';

export interface Choice {
  label: string;
  value: string;
  selected?: boolean;
  /** product: the choice's price, in the form's currency (25 or 12.5). */
  price?: number;
}

export type NamePart = 'prefix' | 'first' | 'middle' | 'last' | 'suffix';

export type Operator = 'is' | 'isnot' | 'contains' | 'starts_with' | 'ends_with' | '>' | '<';

export interface Rule {
  field: string;
  op: Operator;
  value: string;
}

export interface Logic {
  action: 'show' | 'hide';
  match: 'all' | 'any';
  rules: Rule[];
}

/** Column span on the form's 12-column grid. */
export type Width = 'full' | 'three-quarters' | 'two-thirds' | 'half' | 'third' | 'quarter';

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  description?: string;
  descriptionAbove?: boolean;
  placeholder?: string;
  default?: string;
  width?: Width;
  className?: string;
  /** Message shown when the field is missing or invalid (overrides the default). */
  errorMessage?: string;
  choices?: Choice[];
  /** Different stored values from labels (choices). */
  choiceValues?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  /** phone: "us" formats as (###) ###-#### and requires 10 digits. */
  phoneFormat?: 'us' | 'any';
  /** consent: the checkbox's text. */
  consentText?: string;
  /** html: markup shown as-is. */
  html?: string;
  /** name: which parts show, and their labels. First and last always show. */
  nameParts?: Partial<Record<NamePart, { show?: boolean; label?: string }>>;
  /** product: one price, a choice of priced options, or an amount the visitor enters (min, max). */
  priceMode?: PriceMode;
  /** product (fixed): the price, in the form's currency. */
  price?: number;
  /** product (choice): shown as a dropdown or as radio buttons. */
  choiceDisplay?: 'select' | 'radio';
  /** product (fixed, choice): the visitor picks how many, up to `maxQuantity` (default 100). */
  quantity?: boolean;
  maxQuantity?: number;
  logic?: Logic | null;
}

export type PriceMode = 'fixed' | 'choice' | 'amount';

export type PaymentProvider = 'stripe' | 'square';

/** Taking payment for a form: its Product fields add up to the total charged at checkout. */
export interface PaymentSettings {
  provider: PaymentProvider;
  /** ISO 4217 code (CURRENCIES in ./payment.ts); USD by default. */
  currency?: string;
  /** Shown with the charge on the checkout page and the receipt; merge tags allowed. */
  description?: string;
  /** The email field whose address fills in checkout and gets the provider's receipt; else the first one. */
  emailField?: string;
}

export interface Confirmation {
  type: 'message' | 'page' | 'redirect';
  message?: string;
  /** Entry id of the page to go to. */
  pageId?: number;
  url?: string;
}

export interface Notification {
  id: string;
  name: string;
  active?: boolean;
  /** Comma-separated addresses; merge tags allowed ({admin_email}, {Email:f3}). */
  to: string;
  subject: string;
  /** The message from before the email builder (rich text with merge tags); used when there is no design. */
  message: string;
  /** The email as built in the email builder (src/lib/forms/email.ts). */
  design?: EmailDoc;
  /** The plain-text version, with merge tags; made from the design when empty. */
  text?: string;
  replyTo?: string;
  fromName?: string;
}

export interface FormDef {
  id: number;
  title: string;
  description?: string;
  fields: Field[];
  submitLabel?: string;
  labelPlacement?: 'top' | 'left';
  /** Hidden field that bots fill in and people don't. */
  honeypot?: boolean;
  className?: string;
  confirmation?: Confirmation;
  /** Payment at checkout (src/lib/forms/checkout.ts); none when unset. */
  payment?: PaymentSettings | null;
  /** Next number for new field ids. */
  nextId?: number;
}

/** A row of the `forms` table. */
export interface FormRow {
  id: number;
  title: string;
  definition: FormDef;
  notifications?: Notification[];
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

/** A product's answer: the choice or amount (`value`) and the quantity (`qty`). */
export interface ProductValue {
  value?: string;
  qty?: string;
}

/** Submitted values by field id: text, a list (checkboxes) or parts (names, products). */
export type Value = string | string[] | Partial<Record<NamePart, string>> | ProductValue;
export type Values = Record<string, Value>;

/** A form's state when re-shown after a failed submission. */
export interface FormState {
  values: Values;
  errors: Record<string, string>;
  /** A message above the form that isn't about one field (a payment that wasn't completed). */
  notice?: string;
}

/** Outcome of a submission, handed to the page render. */
export interface FormResult {
  formId: number;
  ok: boolean;
  message: string;
  errors: Record<string, string>;
  values: Values;
  redirect?: string;
  /** Refused: the form took too many submissions in the last minute. */
  busy?: true;
  /** Shown above a form that is shown again (FormState.notice). */
  notice?: string;
}

/** form_submissions.payment: a submission's charge and where it stands. */
export interface SubmissionPayment {
  provider: PaymentProvider;
  /** pending: sent to checkout; processing: paid by a method that takes days (bank debits); paid;
   * failed: such a payment didn't go through; cancelled: the checkout expired unpaid. */
  status: 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled';
  /** In minor units (cents). */
  amount: number;
  currency: string;
  items: { name: string; unit: number; quantity: number }[];
  /** The provider's checkout: a Stripe Checkout Session id, or a Square order id. */
  ref?: string;
  /** The provider's payment id, once paid. */
  payment_id?: string;
  /** Secret part of the return address, so only the visitor's browser can come back to this submission. */
  token: string;
  /** The page the form was on, and the site's address (for notifications sent from a webhook). */
  page: string;
  origin: string;
  paid_at?: string;
  sandbox?: boolean;
}
