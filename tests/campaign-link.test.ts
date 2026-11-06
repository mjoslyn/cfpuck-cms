import { describe, expect, it } from 'vitest';
import { campaignLink, campaignPart } from '../src/lib/campaign-link';
import { campaignKey } from '../src/lib/stats';

const O = 'https://example.org';

describe('campaignLink', () => {
  it('adds the campaign to a page on the site', () => {
    expect(campaignLink('/events/', O, { campaign: 'Spring Sale', source: 'Newsletter', medium: 'email' })).toEqual({
      url: 'https://example.org/events/?utm_campaign=spring-sale&utm_source=newsletter&utm_medium=email',
    });
  });
  it('uses the home page when no address is given, and leaves out an empty medium', () => {
    expect(campaignLink('', O, { campaign: 'fair', source: 'poster' })).toEqual({ url: 'https://example.org/?utm_campaign=fair&utm_source=poster' });
  });
  it('keeps the address’s other query values and anchor, replacing old campaign values', () => {
    expect(campaignLink('https://example.org/shop/?page=2&utm_source=old#top', O, { campaign: 'x', source: 'y' })).toEqual({
      url: 'https://example.org/shop/?page=2&utm_campaign=x&utm_source=y#top',
    });
  });
  it('refuses another site, and a missing name or source', () => {
    expect(campaignLink('https://other.org/', O, { campaign: 'x', source: 'y' })).toHaveProperty('problem');
    expect(campaignLink('/', O, { campaign: ' ', source: 'y' })).toHaveProperty('problem');
    expect(campaignLink('/', O, { campaign: 'x', source: '' })).toHaveProperty('problem');
  });
  it('makes values Stats counts as written', () => {
    expect(campaignPart('  Big | Day  Out ')).toBe('big-day-out');
    const r = campaignLink('/', O, { campaign: 'Big Day', source: 'FB', medium: 'Social' }) as { url: string };
    const q = new URL(r.url).searchParams;
    expect(campaignKey({ c: q.get('utm_campaign'), s: q.get('utm_source'), m: q.get('utm_medium') })).toBe('big-day|fb|social');
  });
});
