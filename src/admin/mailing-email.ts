// The email builder's kit for mailing emails (campaigns and digests; src/forms/EmailBuilder.tsx): a
// Subscriber block (the recipient's name or address), the merge tags (with a fallback for an empty
// value: {first_name|there}), the Entries block, and a preview rendered on the server by the code that
// sends them (/api/admin/mailing/preview), filled in for a sample subscriber.
import type { EmailKit } from '../forms/EmailBuilder';
import { MAILING_TAGS } from '../lib/mailing/render';
import type { ContactField } from '../lib/mailing/config';

/** How a Subscriber block shows on the canvas: its tag. */
const standIn = (id: string) => (id.startsWith('field:') ? `{${id.slice(6)}}` : ['name', 'first_name', 'last_name', 'email'].includes(id) ? `{${id}}` : '{name}');

/** `subject` and `since` are read when the preview renders, so it shows them as they are then. `fields`: the site's contact fields, each a tag. */
export function mailingEmailKit(opts: { id?: number; subject: () => string; digest?: boolean; since?: () => string | undefined; fields?: ContactField[] }): EmailKit {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const fields = opts.fields ?? [];
  const tags: [string, string][] = [...MAILING_TAGS, ...fields.map((f): [string, string] => [`{${f.key}}`, f.label]), ...(opts.digest ? [['{week_of}', 'Week of (the Monday)'] as [string, string]] : [])];
  return {
    dataBlock: { label: 'Subscriber', options: [['name', 'Name'], ['first_name', 'First name'], ['last_name', 'Last name'], ['email', 'Email address'], ...fields.map((f): [string, string] => [`field:${f.key}`, f.label])] },
    tags,
    // Tags show as written on the canvas.
    canvas: { merge: (text) => text, field: standIn, origin },
    entries: true,
    textField: (id) => `<p>${standIn(id)}</p>`,
    preview: {
      pickLabel: 'Shown to',
      sampleLabel: 'A sample subscriber',
      render: async ({ design, text }) => {
        const res = await fetch('/api/admin/mailing/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: opts.id, design, text, subject: opts.subject(), since: opts.since?.() }) });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
    },
  };
}
