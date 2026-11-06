// Campaign links (Stats > Make a campaign link, src/admin/CampaignLink.tsx): an address on the site with
// utm_campaign, utm_source and utm_medium, which stats.js reports and Stats counts under Campaigns
// (campaignKey, src/lib/stats.ts). Safe in the browser.

/** Common mediums, offered as suggestions; any other may be typed. */
export const CAMPAIGN_MEDIUMS: [string, string][] = [
  ['email', 'Email'],
  ['social', 'Social media'],
  ['print', 'Print (posters, flyers)'],
  ['qr', 'QR code'],
  ['paid', 'Paid ads'],
  ['referral', 'Another website'],
];

/** One part as it goes into the link: trimmed, lower case, spaces as hyphens, no "|" (Stats' separator). */
export const campaignPart = (s: string): string =>
  s.trim().toLowerCase().replace(/\|/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 100);

export interface CampaignParts {
  campaign: string;
  source: string;
  medium?: string;
}

/**
 * The link: the address (a path, or a full address on this site; empty is the home page) with the
 * campaign's parts in its query, in place of any it had, its other query values and #anchor kept.
 * A problem instead when the address is on another site or a part Stats needs is missing.
 */
export function campaignLink(address: string, origin: string, parts: CampaignParts): { url: string } | { problem: string } {
  const campaign = campaignPart(parts.campaign);
  const source = campaignPart(parts.source);
  const medium = campaignPart(parts.medium ?? '');
  let url: URL;
  try {
    url = new URL(address.trim() || '/', origin);
  } catch {
    return { problem: 'That address isn’t one Stats can use: choose a page on this site.' };
  }
  if (url.origin !== new URL(origin).origin) return { problem: 'Stats counts visits to this site only: choose a page on this site.' };
  if (!campaign) return { problem: 'Give the campaign a name.' };
  if (!source) return { problem: 'Say where the link will be shared (its source).' };
  for (const k of ['utm_campaign', 'utm_source', 'utm_medium']) url.searchParams.delete(k);
  url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_source', source);
  if (medium) url.searchParams.set('utm_medium', medium);
  return { url: url.toString() };
}
