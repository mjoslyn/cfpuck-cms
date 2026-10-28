// Compose in the campaign editor (POST /api/admin/mailing/campaigns/compose): the editor says what the
// email is about, and Claude writes its name, subject and email into the editor for review, saved with
// Save. Started from the admin bar's Compose > Campaign, it opens with that page's brief and writes at once.
import { useEffect, useState } from 'react';
import type { Campaign } from '../lib/mailing/config';
import type { ComposeStart } from '../lib/compose/start';
import type { EmailDoc } from '../lib/forms/email';

export interface ComposedCampaign {
  name: string;
  subject: string;
  design: EmailDoc;
  notes: string[];
}

export default function ComposeCampaign({ campaign, start, onDone, onClose }: { campaign: Campaign; start?: ComposeStart; onDone: (c: ComposedCampaign) => void; onClose: () => void }) {
  const [brief, setBrief] = useState(start?.brief ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const write = async () => {
    setError('');
    setBusy(true);
    const res = await fetch('/api/admin/mailing/campaigns/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief, campaign: { name: campaign.name, subject: campaign.subject, design: campaign.design } }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError((res && (await res.text())) || 'Claude couldn’t be reached. Try again.');
    onDone(await res.json());
  };
  useEffect(() => {
    if (start?.brief.trim()) write();
  }, []);
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-admin-ink/40 p-4" onClick={() => !busy && onClose()}>
      <div className="w-[480px] max-w-full rounded bg-white p-5 text-left text-sm shadow-xl" role="dialog" aria-modal="true" aria-label="Compose" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
        <h2 className="mb-1 text-base font-medium">Compose</h2>
        <p className="mb-3 text-xs text-admin-muted">Claude writes the campaign's name, subject and email from what you say here, keeping the email's look. It can add your latest posts or upcoming events, filled in when it is sent. You can change everything before you save.</p>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-admin-muted">What is the email about?</span>
          <textarea
            className="w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent"
            rows={6}
            autoFocus
            value={brief}
            placeholder="The October newsletter: the fall festival is on the 18th at Riverside Park, we're looking for volunteers (sign up at /volunteer/), and the library's new hours. Then our latest news and upcoming events."
            onChange={(e) => setBrief(e.target.value)}
          />
        </label>
        {(campaign.design?.content ?? []).length > 0 && <p className="mb-3 text-xs text-admin-muted">Replaces the email's blocks. Its plain text, if it has its own, stays as it is.</p>}
        {error && (
          <p className="mb-3 rounded bg-admin-soft px-2 py-1.5 text-xs text-admin-ink" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          {busy && <span className="mr-auto text-xs text-admin-muted">Writing… this takes up to a minute.</span>}
          <button type="button" className="text-xs text-admin-muted underline hover:text-admin-accent" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !brief.trim()} className="rounded bg-admin-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-admin-accent-dark disabled:opacity-50" onClick={write}>
            {busy ? 'Writing…' : 'Write'}
          </button>
        </div>
      </div>
    </div>
  );
}
