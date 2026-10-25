// The Subscribe block's settings: which lists it offers (none ticked: every public list), its heading,
// text, button, consent wording, whether it asks for first and last name, the site's contact fields it
// asks for (Settings > Mailing Lists), and its layout.
import { useEffect, useState } from 'react';
import { Segmented, Select, Text, Toggle, type Attrs } from './fields';
import { browserClient } from '../lib/db/browser';
import { useMailingOn, useSite } from './member-settings';
import { FormStylePanel } from './FormStyle';
import { mailingSettings, type MailList } from '../lib/mailing/config';

export function SubscribePanel({ a, set }: { a: Attrs; set: (patch: Attrs) => void }) {
  const on = useMailingOn();
  const fields = mailingSettings(useSite()).fields ?? [];
  const asked: string[] = Array.isArray(a.fields) ? a.fields : [];
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
      <Toggle title="Ask for first and last name" value={a.showName} onChange={(showName) => set({ showName: showName || undefined })} />
      {fields.length > 0 && (
        <fieldset className="mb-3 border-0 p-0">
          <legend className="mb-1 text-xs font-medium text-admin-muted">Also ask (optional for visitors)</legend>
          {fields.map((f) => (
            <label key={f.key} className="mr-3 inline-flex items-center gap-1 text-sm">
              <input type="checkbox" checked={asked.includes(f.key)} onChange={(e) => set({ fields: e.target.checked ? [...asked, f.key] : asked.filter((k) => k !== f.key).length ? asked.filter((k) => k !== f.key) : undefined })} />
              {f.label}
            </label>
          ))}
        </fieldset>
      )}
      <FormStylePanel a={a} set={set} />
      <Segmented title="Layout" value={a.layout === 'inline' ? 'inline' : 'stacked'} options={[['stacked', 'Stacked'], ['inline', 'In a row']]} onChange={(v) => set({ layout: v === 'inline' ? 'inline' : undefined })} />
      <p className="mb-2 text-xs text-admin-muted">Sign-ups get an email with a link to confirm; nothing is sent until they do. With several lists, visitors tick the ones they want.</p>
    </>
  );
}

// The Newsletter signup block's settings: its list (one of the public lists; none chosen: the first),
// heading and text (empty: none), button, the email field's placeholder, consent wording, tags and alignment.
export function NewsletterPanel({ a, set }: { a: Attrs; set: (patch: Attrs) => void }) {
  const on = useMailingOn();
  const [lists, setLists] = useState<MailList[] | null>(null);
  useEffect(() => {
    browserClient().from('mail_lists').select('*').eq('public', true).order('sort').order('id').then(({ data }) => setLists((data ?? []) as MailList[]));
  }, []);
  return (
    <>
      {on === false && <p className="mb-3 rounded bg-admin-soft p-2 text-xs text-admin-muted">Mailing is off (Settings &gt; Mailing Lists): the block shows nothing.</p>}
      {lists && (lists.length ? <Select title="List" value={String(a.list ?? '')} options={[['', `The first public list (${lists[0].name})`], ...lists.map((l): [string, string] => [String(l.id), l.name])]} onChange={(v) => set({ list: v ? Number(v) : undefined })} /> : <p className="mb-3 text-xs text-admin-muted">No public lists yet: add one on the Mailing Lists screen.</p>)}
      <Text title="Heading" value={a.heading} placeholder="Get our newsletter" onChange={(v) => set({ heading: v })} />
      <Text title="Text" value={a.text} placeholder="News and events, straight to your inbox." onChange={(v) => set({ text: v })} />
      <Text title="Button" value={a.button} placeholder="Sign up" onChange={(v) => set({ button: v || undefined })} />
      <Text title="Inside the email field" value={a.placeholder} placeholder="Your email address" onChange={(v) => set({ placeholder: v || undefined })} />
      <Text title="Consent wording" value={a.consentText} placeholder="From Settings > Mailing Lists" onChange={(v) => set({ consentText: v || undefined })} />
      <Text title="Tag sign-ups with (comma separated)" value={a.tags} placeholder="(none)" onChange={(v) => set({ tags: v || undefined })} />
      <Segmented title="Align" value={a.align === 'left' ? 'left' : 'center'} options={[['center', 'Centred'], ['left', 'Left']]} onChange={(v) => set({ align: v === 'left' ? 'left' : undefined })} />
      <FormStylePanel a={a} set={set} />
      <p className="mb-2 text-xs text-admin-muted">A compact sign-up for a band or the footer. Clear the heading or text to leave it out. Sign-ups get an email with a link to confirm.</p>
    </>
  );
}
