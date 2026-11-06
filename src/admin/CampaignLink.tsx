// Stats > Make a campaign link: a button beside Campaigns opening a dialog that adds a campaign's name,
// source and medium to a page on the site (campaignLink, src/lib/campaign-link.ts), to copy into an
// email, a post or a poster's QR code. Visits by it show under Campaigns. Names already used are offered,
// so a campaign keeps one spelling. What was typed stays while the page is open.
import { useEffect, useRef, useState } from 'react';
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
const plainButton = 'rounded border border-admin-ink/15 bg-white px-3 py-1.5 text-sm hover:border-admin-accent hover:text-admin-accent';

export default function CampaignLink({ origin, used }: Props) {
  const [address, setAddress] = useState('');
  const [campaign, setCampaign] = useState('');
  const [source, setSource] = useState('');
  const [medium, setMedium] = useState('');
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const find = useRef<HTMLButtonElement>(null);
  const started = !!(campaign || source || medium);
  const made = campaignLink(address, origin, { campaign, source, medium });
  const mediums = [...new Set([...CAMPAIGN_MEDIUMS.map(([v]) => v), ...used.mediums])];

  const close = () => {
    setOpen(false);
    setPicking(false);
    opener.current?.focus();
  };
  const closePicker = () => {
    setPicking(false);
    find.current?.focus();
  };

  // Escape closes the dialog wherever focus is (the link picker takes its own Escape first).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

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
    <>
      <button ref={opener} type="button" aria-haspopup="dialog" aria-expanded={open} className="text-xs font-normal text-admin-accent hover:underline" onClick={() => setOpen(true)}>
        Make a campaign link
      </button>
      {open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-admin-ink/40 p-4" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cl-title"
            className="relative max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded bg-white p-5 text-left font-normal shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" aria-label="Close" className="absolute top-3 right-3 rounded px-2 text-lg leading-none text-admin-muted hover:text-admin-accent" onClick={close}>
              ×
            </button>
            <h2 id="cl-title" className="pr-8 text-base font-semibold">
              Make a campaign link
            </h2>
            <p className="mt-0.5 text-xs text-admin-muted">Share this link instead of the page's own address, and visits that come by it are counted under its campaign.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={label} htmlFor="cl-address">
                  Page
                  <span className={hint}>The page the link opens. Empty: the home page.</span>
                </label>
                <div className="mt-1 flex gap-1.5">
                  <input id="cl-address" className={input} value={address} placeholder="/events/" autoFocus onChange={change(setAddress)} />
                  <button ref={find} type="button" className={`shrink-0 ${plainButton}`} onClick={() => setPicking((p) => !p)}>
                    Find
                  </button>
                </div>
                {picking && <LinkPicker initial={address} newTabOption={false} onPick={(p) => (setAddress(p.url), setCopied(false), closePicker())} onClose={closePicker} />}
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
                  <a className={plainButton} href={made.url} target="_blank" rel="noopener">
                    Open
                  </a>
                </div>
              </div>
            ) : (
              started && <p className="mt-3 text-sm text-[#c4592a]">{made.problem}</p>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" className={plainButton} onClick={close}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
