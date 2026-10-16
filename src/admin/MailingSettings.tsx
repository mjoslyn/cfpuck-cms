// Settings > Mailing Lists (settings.site.mailing; src/lib/mailing/config.ts): Mailing on or off, the sender,
// the postal address every email carries, the consent wording, the lists offered to members, link
// tracking and UTM defaults, and the health thresholds that pause sending. Mailgun's keys are in the
// environment (src/lib/mailing/mailgun.ts); this shows which are missing. Lists, contacts, campaigns and
// digests are on the Mailing Lists screen.
import { useEffect, useState } from 'react';
import { Num, Text, Toggle } from '../puck/fields';
import { CONSENT_TEXT, HEALTH, PREFERENCES_PATH, SUBSCRIBE_PATH, UNSUBSCRIBE_PATH, type MailList, type MailingSettings } from '../lib/mailing/config';

export interface MailgunInfo {
  configured: boolean;
  domain: string;
  region: string;
  testMode: boolean;
  webhooks: boolean;
  missing: string[];
}

export default function MailingSettingsPanel({ value, mailgun, lists, membersOn, onChange }: { value: MailingSettings; mailgun: MailgunInfo; lists: MailList[]; membersOn: boolean; onChange: (v: MailingSettings) => void }) {
  const set = (patch: Partial<MailingSettings>) => onChange({ ...value, ...patch });
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(location.origin), []);
  const memberLists = value.memberLists ?? [];
  return (
    <>
      <p className="mb-3 text-xs text-admin-muted">
        Mailing lists people sign up to (with a confirmation email), campaigns and a weekly digest sent through Mailgun from a marketing subdomain, and each email's deliveries, opens and clicks. Separate from the site's other email (forms, tickets), which goes out over SMTP as before.
      </p>
      <Toggle title="Mailing on" value={value.enabled} onChange={(enabled) => set({ enabled })} />
      {value.enabled && (
        <>
          <p className="mb-3 rounded bg-admin-soft p-2 text-sm">
            Lists, subscribers, segments, campaigns and the weekly digest are on the <a className="underline" href="/admin/mailing-lists/?tab=lists">Mailing Lists</a> screen (in the menu once these settings are saved).
          </p>
          {mailgun.configured ? (
            <p className="mb-3 text-xs text-admin-muted">
              Sending through Mailgun from <strong>{mailgun.domain}</strong> ({mailgun.region.toUpperCase()}){mailgun.testMode ? ', in test mode: Mailgun accepts emails and delivers none' : ''}.
            </p>
          ) : (
            <p className="mb-3 rounded bg-admin-soft p-2 text-xs text-admin-muted">Mailgun isn't set up, so nothing goes out (locally, emails go to the mail catcher). Set {mailgun.missing.filter((k) => k !== 'MAILGUN_WEBHOOK_SIGNING_KEY').join(' and ')} in the site's environment.</p>
          )}
          {mailgun.configured && !mailgun.webhooks && <p className="mb-3 rounded bg-admin-soft p-2 text-xs text-admin-muted">Without MAILGUN_WEBHOOK_SIGNING_KEY, deliveries, opens, bounces and complaints aren't recorded.</p>}
          <p className="-mt-1 mb-3 text-xs text-admin-muted">
            Mailgun webhook address (delivered, opened, failed, complained, unsubscribed): <code>{origin}/api/mailgun/webhook</code>
          </p>

          <span className="mt-4 mb-1 block text-xs font-semibold tracking-wider text-admin-muted uppercase">Sender</span>
          <Text title="From name (empty: the site's name)" value={value.fromName} onChange={(fromName) => set({ fromName: fromName || undefined })} />
          <Text title={`From address, before the @${mailgun.domain || '(MAILGUN_DOMAIN)'}`} value={value.fromLocal} placeholder="news" onChange={(fromLocal) => set({ fromLocal: fromLocal || undefined })} />
          <Text title="Replies go to (optional)" value={value.replyTo} placeholder="info@example.org" onChange={(replyTo) => set({ replyTo: replyTo || undefined })} />
          <label className="mb-3 block text-sm">
            <span className="mb-1.5 block font-medium text-[#3b3b3b]">Postal address (required: every email shows it)</span>
            <textarea className="w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm" rows={2} value={value.address ?? ''} onChange={(e) => set({ address: e.target.value || undefined })} />
          </label>

          <span className="mt-4 mb-1 block text-xs font-semibold tracking-wider text-admin-muted uppercase">Signing up</span>
          <Text title="Consent wording under sign-up forms" value={value.consentText} placeholder={CONSENT_TEXT} onChange={(consentText) => set({ consentText: consentText || undefined })} />
          <p className="mb-3 text-xs text-admin-muted">
            Kept with each sign-up. Sign-ups are confirmed by email before anything is sent. The site's pages: <a className="underline" href={SUBSCRIBE_PATH} target="_blank">{SUBSCRIBE_PATH}</a>, <a className="underline" href={UNSUBSCRIBE_PATH} target="_blank">{UNSUBSCRIBE_PATH}</a> and{' '}
            <a className="underline" href={PREFERENCES_PATH} target="_blank">{PREFERENCES_PATH}</a> (a page with one of these addresses takes its place). The Subscribe block puts a sign-up form anywhere.
          </p>
          {membersOn && (
            <fieldset className="mb-3 border-0 p-0">
              <legend className="mb-1 text-sm font-medium text-[#3b3b3b]">Lists offered to members</legend>
              {lists.length ? (
                lists.map((l) => (
                  <label key={l.id} className="mr-3 inline-flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={memberLists.includes(l.id)} onChange={(e) => set({ memberLists: e.target.checked ? [...memberLists, l.id] : memberLists.filter((x) => x !== l.id) })} />
                    {l.name}
                  </label>
                ))
              ) : (
                <p className="text-xs text-admin-muted">No lists yet: add them on the <a className="underline" href="/admin/mailing-lists/?tab=lists">Mailing Lists screen</a>.</p>
              )}
              <p className="mt-1 text-xs text-admin-muted">Offered (unticked) when someone creates a member account, and on a member's account page, where they choose their lists.</p>
            </fieldset>
          )}

          <span className="mt-4 mb-1 block text-xs font-semibold tracking-wider text-admin-muted uppercase">New campaigns</span>
          <Toggle title="Track links (each link goes through the site, which tells people's clicks from mail scanners')" value={value.trackLinks !== false} onChange={(trackLinks) => set({ trackLinks })} />
          <Toggle title="Add UTM parameters to links to this site" value={value.utm} onChange={(utm) => set({ utm })} />

          <span className="mt-4 mb-1 block text-xs font-semibold tracking-wider text-admin-muted uppercase">Pause sending when</span>
          <Num title={`Spam complaints pass (% of delivered; default ${HEALTH.complaintRate})`} value={value.complaintRate} min={0.01} max={100} onChange={(complaintRate) => set({ complaintRate })} />
          <Num title={`Bounces pass (% of sent; default ${HEALTH.bounceRate})`} value={value.bounceRate} min={0.1} max={100} onChange={(bounceRate) => set({ bounceRate })} />
          <p className="text-xs text-admin-muted">Checked once a campaign has {HEALTH.minDelivered} deliveries. Everything stops, digests included, and the admins are emailed, until an admin resumes sending on the Mailing Lists screen.</p>
        </>
      )}
    </>
  );
}
