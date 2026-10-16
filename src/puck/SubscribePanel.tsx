// The Subscribe block's settings: which lists it offers (none ticked: every public list), its heading,
// text, button, consent wording, whether it asks for a name, and its layout.
import { useEffect, useState } from 'react';
import { Segmented, Text, Toggle, type Attrs } from './fields';
import { browserClient } from '../lib/supabase-browser';
import { useMailingOn } from './member-settings';
import type { MailList } from '../lib/mailing/config';

export function SubscribePanel({ a, set }: { a: Attrs; set: (patch: Attrs) => void }) {
  const on = useMailingOn();
  const [lists, setLists] = useState<MailList[] | null>(null);
  useEffect(() => {
    // Public lists only: a sign-up form can't add anyone to the others (src/pages/api/mail/subscribe.ts).
    browserClient().from('mail_lists').select('*').eq('public', true).order('sort').order('id').then(({ data }) => setLists((data ?? []) as MailList[]));
  }, []);
  const chosen: number[] = Array.isArray(a.lists) ? a.lists.map(Number) : [];
  return (
    <>
      {on === false && <p className="mb-3 rounded bg-admin-soft p-2 text-xs text-admin-muted">Mailing is off (Settings &gt; Mailing Lists): the block shows nothing.</p>}
      {lists && (
        <fieldset className="mb-3 border-0 p-0">
          <legend className="mb-1 text-xs font-medium text-admin-muted">Lists offered (none ticked: every public list)</legend>
          {lists.map((l) => (
            <label key={l.id} className="mr-3 inline-flex items-center gap-1 text-sm">
              <input type="checkbox" checked={chosen.includes(l.id)} onChange={(e) => set({ lists: e.target.checked ? [...chosen, l.id] : chosen.filter((x) => x !== l.id).length ? chosen.filter((x) => x !== l.id) : undefined })} />
              {l.name}
            </label>
          ))}
          {!lists.length && <p className="text-xs text-admin-muted">No public lists yet: add them on the Mailing Lists screen.</p>}
        </fieldset>
      )}
      <Text title="Heading" value={a.heading} placeholder="(none)" onChange={(v) => set({ heading: v || undefined })} />
      <Text title="Text" value={a.text} placeholder="(none)" onChange={(v) => set({ text: v || undefined })} />
      <Text title="Button" value={a.button} placeholder="Subscribe" onChange={(v) => set({ button: v || undefined })} />
      <Text title="Consent wording" value={a.consentText} placeholder="From Settings > Mailing Lists" onChange={(v) => set({ consentText: v || undefined })} />
      <Text title="Tag sign-ups with (comma separated)" value={a.tags} placeholder="(none)" onChange={(v) => set({ tags: v || undefined })} />
      <Toggle title="Ask for a name" value={a.showName} onChange={(showName) => set({ showName: showName || undefined })} />
      <Segmented title="Layout" value={a.layout === 'inline' ? 'inline' : 'stacked'} options={[['stacked', 'Stacked'], ['inline', 'In a row']]} onChange={(v) => set({ layout: v === 'inline' ? 'inline' : undefined })} />
      <p className="mb-2 text-xs text-admin-muted">Sign-ups get an email with a link to confirm; nothing is sent until they do. With several lists, visitors tick the ones they want.</p>
    </>
  );
}
