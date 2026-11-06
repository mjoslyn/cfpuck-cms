// Popups and the cookie consent banner (src/lib/popups.ts, src/render/popups.ts): settings kept to known
// values, shown on the pages they are for, the consent banner everywhere with its buttons, snippets kept
// for consent in a <template>, and the Stats cookie told about the banner.
import { describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { CONSENT_STARTER, consentPopup, popupsFor, popupsFrom } from '../src/lib/popups';
import { renderRequest } from '../src/render/page';

describe('popups', () => {
  it('keeps known settings, one consent banner and clean paths', () => {
    const got = popupsFrom([
      { id: 'Sale!', name: 'Sale', enabled: true, part: 'sale-popup', layout: 'nope', trigger: 'delay', delay: 9999, frequency: 'days', days: 0, pages: 'only', paths: ['/shop/*', 'javascript:x', '//evil/', ''] },
      { name: 'Cookies', enabled: true, part: 'cookies', consent: true, policyUrl: 'javascript:alert(1)' },
      { name: 'Second banner', part: 'cookies-2', consent: true },
      { name: 'Bad part', part: '../etc' },
    ])!;
    expect(got).toHaveLength(3);
    expect(got[0]).toMatchObject({ id: 'sale', layout: 'modal', delay: 600, days: 7, paths: ['/shop/*'] });
    expect(got[1]).toMatchObject({ consent: true, layout: 'bar-bottom', acceptLabel: 'Accept', rejectLabel: 'Reject' });
    expect(got[1].policyUrl).toBeUndefined();
    expect(got[2].consent).toBeUndefined();
    expect(popupsFor(got, '/shop/hats/').map((p) => p.id)).toEqual(['sale', 'p2']);
    expect(popupsFor(got, '/about/').map((p) => p.id)).toEqual(['p2']);
    expect(consentPopup(got)?.id).toBe('p2');
  });

  it('renders popups with their part, the consent banner and consent-gated snippets', async () => {
    const db = siteDb();
    const part = (slug: string, text: string) => ({ kind: 'part', slug, title: slug, content: { root: { props: {} }, content: [{ type: 'text', props: { id: `${slug}-t`, attrs: { content: text } } }], zones: {} } });
    await db.from('templates').insert([part('offer-popup', 'Ten percent off this week.'), part('cookie-banner', 'We use cookies.')]);
    await db.from('entries').insert([
      { type: 'page', slug: 'with-offer', title: 'Offer', status: 'publish', content: { content: [], root: { props: {} } } },
      { type: 'page', slug: 'plain-page', title: 'Plain', status: 'publish', content: { content: [], root: { props: {} } } },
    ]);
    const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
    await db.from('settings').upsert({
      key: 'site',
      value: {
        ...((data?.value as object) ?? {}),
        stats: { cookies: true },
        popups: popupsFrom([
          { id: 'offer', name: 'Offer', enabled: true, part: 'offer-popup', layout: 'modal', trigger: 'scroll', scroll: 40, frequency: 'session', pages: 'only', paths: ['/with-offer/'] },
          { id: 'cookies', name: 'Cookie consent', enabled: true, part: 'cookie-banner', consent: true, acceptLabel: 'Allow all', policyUrl: '/privacy/' },
        ]),
        snippets: { head: '<script src="https://analytics.example/a.js"></script>', footer: '<script>window.ok = 1</script>', consent: { head: true } },
      },
    });

    const offer = (await renderRequest(new URL('http://localhost/with-offer/'), db)).html;
    expect(offer).toMatch(/<div class="c-popup is-modal" id="popup-offer" data-popup="[^"]*&quot;scroll&quot;:40[^"]*" role="dialog" aria-label="Offer" aria-modal="true" hidden>/);
    expect(offer).toContain('Ten percent off this week.');
    expect(offer).toContain('id="popup-cookies"');
    expect(offer).toContain('data-consent-choice="all">Allow all</button>');
    // Accept and Reject look alike: neither is played down.
    expect(offer).toContain('<div class="c-button"><button type="button" class="c-button__link" data-consent-choice="necessary">Reject</button>');
    expect(offer).toContain('<a class="c-popup__policy" href="/privacy/">Privacy policy</a>');
    // The banner closes with an ×, which keeps only the cookies the site needs, as Reject does.
    expect(offer).toMatch(/<div class="c-popup is-[^"]* is-consent" id="popup-cookies"[^>]*>(?:<div class="c-popup__backdrop"><\/div>)?<div class="c-popup__box" tabindex="-1"><button type="button" class="c-popup__close" aria-label="Close: only the cookies the site needs" data-consent-choice="necessary">/);
    expect(offer).toContain('<template data-consent-snippet><script src="https://analytics.example/a.js"></script></template>\n</head>');
    expect(offer).toContain('<script>window.ok = 1</script>\n</body>');
    expect(offer).toContain('/assets/js/popups.js');
    expect(offer).toContain('<script src="/assets/js/stats.js" data-cookie="1" data-consent="1" defer>');

    const plain = (await renderRequest(new URL('http://localhost/plain-page/'), db)).html;
    expect(plain).not.toContain('Ten percent off');
    expect(plain).toContain('We use cookies.');
  });

  it('uses the Accept and Reject buttons in the banner content, adding none of its own', async () => {
    const db = siteDb();
    await db.from('templates').insert({ kind: 'part', slug: 'own-buttons-banner', title: 'Banner', content: { root: { props: {} }, content: CONSENT_STARTER, zones: {} } });
    await db.from('entries').insert({ type: 'page', slug: 'banner-page', title: 'Banner page', status: 'publish', content: { content: [], root: { props: {} } } });
    const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
    await db.from('settings').upsert({ key: 'site', value: { ...((data?.value as object) ?? {}), popups: popupsFrom([{ id: 'cookies', name: 'Cookie consent', enabled: true, part: 'own-buttons-banner', consent: true }]) } });
    const html = (await renderRequest(new URL('http://localhost/banner-page/'), db)).html;
    expect(html).toMatch(/<a class="c-button__link" href="#accept-cookies"[^>]*>Accept<\/a>/);
    expect(html).toMatch(/<a class="c-button__link" href="#reject-cookies"[^>]*>Reject<\/a>/);
    expect(html).toContain('href="/privacy/"');
    expect(html).not.toContain('c-popup__actions');
    expect(html).not.toContain('data-consent-choice="all"');
  });
});

