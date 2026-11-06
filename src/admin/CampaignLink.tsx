// Stats > Make a campaign link: a page on the site with a campaign's name, source and medium added
// (campaignLink, src/lib/campaign-link.ts), to copy into an email, a post or a poster's QR code. Visits
// by it show under Campaigns. Names already used are offered, so a campaign keeps one spelling.
import { useState } from 'react';
import { LinkPicker } from '../puck/LinkPicker';
import { CAMPAIGN_MEDIUMS, campaignLink } from '../lib/campaign-link';

interface Props {
  /** The site's address, which links are made on. */
  origin: string;
  /** Campaigns, sources and mediums already counted, as suggestions. */
  used: { campaigns: string[]; sources: string[]; mediums: string[] };
}

const input = 'w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent';
const label = 'block text-xs font-semibold text-admin-ink';
const hint = 'mt-0.5 block text-xs font-normal text-admin-muted';

export default function CampaignLink({ origin, used }: Props) {
  const [address, setAddress] = useState('');
  const [campaign, setCampaign] = useState('');
  const [source, setSource] = useState('');
  const [medium, setMedium] = useState('');
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const started = !!(campaign || source || medium);
  const made = campaignLink(address, origin, { campaign, source, medium });
  const mediums = [...new Set([...CAMPAIGN_MEDIUMS.map(([v]) => v), ...used.mediums])];

  const copy = async () => {
    if (!('url' in made)) return;
    try {
      await navigator.clipboard.writeText(made.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy the link:', made.url);
    }
  };
  const change = (set: (v: string) => void) => (e: { target: { value: string } }) => (set(e.target.value), setCopied(false));

  return (
    <div className="rounded bg-white p-4 shadow-[0_0_0_1px_rgba(26,26,46,0.08)]">
      <h3 className="text-sm font-semibold">Make a campaign link</h3>
      <p className="mt-0.5 text-xs text-admin-muted">
        Share this link instead of the page's own address, and visits that come by it are counted below under its campaign.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="cl-address">
            Page
            <span className={hint}>The page the link opens. Empty: the home page.</span>
          </label>
          <div className="mt-1 flex gap-1.5">
            <input id="cl-address" className={input} value={address} placeholder="/events/" onChange={change(setAddress)} />
            <button type="button" className="shrink-0 rounded border border-admin-ink/15 bg-white px-3 text-sm hover:border-admin-accent hover:text-admin-accent" onClick={() => setPicking((p) => !p)}>
              Find
            </button>
          </div>
          {picking && <LinkPicker initial={address} newTabOption={false} onPick={(p) => (setAddress(p.url), setPicking(false), setCopied(false))} onClose={() => setPicking(false)} />}
        </div>
        <label className={label}>
          Campaign name
          <span className={hint}>What you're promoting, such as "spring-fair".</span>
          <input className={`${input} mt-1`} value={campaign} list="cl-campaigns" onChange={change(setCampaign)} />
        </label>
        <label className={label}>
          Source
          <span className={hint}>Where you'll share it, such as "newsletter" or "facebook".</span>
          <input className={`${input} mt-1`} value={source} list="cl-sources" onChange={change(setSource)} />
        </label>
        <label className={label}>
          Medium (optional)
          <span className={hint}>The kind of link: email, social, print, qr...</span>
          <input className={`${input} mt-1`} value={medium} list="cl-mediums" onChange={change(setMedium)} />
        </label>
      </div>
      <datalist id="cl-campaigns">{used.campaigns.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="cl-sources">{used.sources.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="cl-mediums">
        {mediums.map((v) => (
          <option key={v} value={v}>
            {CAMPAIGN_MEDIUMS.find(([m]) => m === v)?.[1]}
          </option>
        ))}
      </datalist>
      <p className="mt-2 text-xs text-admin-muted">Names are made lower case, with hyphens for spaces, so "Spring Fair" and "spring fair" count as one.</p>
      {'url' in made ? (
        <div className="mt-3">
          <label className={label} htmlFor="cl-url">
            Your link
          </label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <input id="cl-url" readOnly className={`${input} min-w-0 flex-1 font-mono text-xs`} value={made.url} onFocus={(e) => e.target.select()} />
            <button type="button" className="rounded bg-admin-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-admin-accent" onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a className="rounded border border-admin-ink/15 px-3 py-1.5 text-sm hover:border-admin-accent hover:text-admin-accent" href={made.url} target="_blank" rel="noopener">
              Open
            </a>
          </div>
        </div>
      ) : (
        started && <p className="mt-3 text-sm text-[#c4592a]">{made.problem}</p>
      )}
    </div>
  );
}
