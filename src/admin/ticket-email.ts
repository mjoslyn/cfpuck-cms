// The email builder's kit for ticket emails (src/forms/EmailBuilder.tsx): an Order details block, the
// order's merge tags, and a preview filled in with a sample order, rendered in the browser by the same
// code that sends the emails (src/lib/tickets/email.ts).
import type { EmailKit } from '../forms/EmailBuilder';
import { MERGE_TAGS, ORDER_DETAILS, type EmailKind } from '../lib/tickets/config';
import { SAMPLE_ORDER, sampleEvent, ticketEmail, ticketEmailContext } from '../lib/tickets/email';

/** The plain text made from a design: each Order details block as its merge tags. */
const DETAIL_TAGS: Record<string, [string, string]> = {
  all: ['Order', '{order_summary}'],
  when: ['When', '{date}{time}'],
  venue: ['Where', '{venue}'],
  code: ['Order code', '{code}'],
  tickets: ['Tickets', '{tickets}'],
  total: ['Total', '{total}'],
  answers: ['Answers', '{answers}'],
  contact: ['Buyer', '{name}<br>{email}<br>{phone}<br>{address}'],
};

/** `subject`: read when the preview renders, so it shows the subject as it is then. */
export function ticketEmailKit(kind: EmailKind, subject: () => string, eventTitle?: string): EmailKit {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  // A waitlist email has no order yet.
  const order = kind === 'waitlist' ? { ...SAMPLE_ORDER, code: '', items: [], amount: 0, answers: [] } : SAMPLE_ORDER;
  const event = sampleEvent(eventTitle, origin);
  const links = { order: `${event.link}?order=sample#tickets`, attendees: `${origin}/admin/tickets/` };
  const sample = ticketEmailContext(order, event, links, origin);
  return {
    dataBlock: { label: 'Order details', options: ORDER_DETAILS },
    tags: MERGE_TAGS,
    // Tags show as written; Order details blocks show the sample order.
    canvas: { merge: (text) => text, field: sample.field, origin },
    textField: (id, showLabel) => {
      const [label, tags] = DETAIL_TAGS[id] ?? DETAIL_TAGS.all;
      return `<p>${showLabel ? `${label}: ` : ''}${tags}</p>`;
    },
    preview: {
      pickLabel: 'Filled in with',
      sampleLabel: kind === 'waitlist' ? 'A sample person on the waitlist' : 'A sample order',
      render: async ({ design, text }) => {
        const mail = ticketEmail({ subject: subject(), design, text }, order, event, links, origin);
        return { to: [kind === 'admin' ? "The site's admin address" : order.email], replyTo: kind === 'admin' ? order.email : undefined, ...mail };
      },
    },
  };
}
