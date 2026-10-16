// The email builder's kit for mailing emails (campaigns and digests; src/forms/EmailBuilder.tsx): a
// Subscriber block (the recipient's name or address), the merge tags (with a fallback for an empty
// value: {first_name|there}), the Entries block, and a preview rendered on the server by the code that
// sends them (/api/admin/mailing/preview), filled in for a sample subscriber.
import type { EmailKit } from '../forms/EmailBuilder';
import { MAILING_TAGS } from '../lib/mailing/render';

const STAND_IN: Record<string, string> = { name: '{name}', first_name: '{first_name}', email: '{email}' };

/** `subject` and `since` are read when the preview renders, so it shows them as they are then. */
export function mailingEmailKit(opts: { id?: number; subject: () => string; digest?: boolean; since?: () => string | undefined }): EmailKit {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return {
    dataBlock: { label: 'Subscriber', options: [['name', 'Name'], ['first_name', 'First name'], ['email', 'Email address']] },
    tags: opts.digest ? [...MAILING_TAGS, ['{week_of}', 'Week of (the Monday)']] : MAILING_TAGS,
    // Tags show as written on the canvas.
    canvas: { merge: (text) => text, field: (id) => STAND_IN[id] ?? '{name}', origin },
    entries: true,
    textField: (id) => `<p>${STAND_IN[id] ?? '{name}'}</p>`,
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
