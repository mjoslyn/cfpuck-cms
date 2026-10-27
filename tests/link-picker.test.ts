// The link picker (src/puck/LinkPicker.tsx, src/lib/link-address.ts) reads what was typed as an address or as a search for the
// site's pages.
import { describe, expect, it } from 'vitest';
import { isExternal, typedAddress } from '../src/lib/link-address';

describe('typedAddress', () => {
  it('reads addresses', () => {
    expect(typedAddress('https://example.org/a?b=1')).toBe('https://example.org/a?b=1');
    expect(typedAddress('example.org')).toBe('https://example.org');
    expect(typedAddress('www.example.org/events/')).toBe('https://www.example.org/events/');
    expect(typedAddress('hello@example.org')).toBe('mailto:hello@example.org');
    expect(typedAddress('mailto:hello@example.org')).toBe('mailto:hello@example.org');
    expect(typedAddress('(716) 555-0100')).toBeNull(); // spaces: a search
    expect(typedAddress('716-555-0100')).toBe('tel:7165550100');
    expect(typedAddress('+1.716.555.0100')).toBe('tel:+17165550100');
    expect(typedAddress('/about/')).toBe('/about/');
    expect(typedAddress('#tickets')).toBe('#tickets');
    expect(typedAddress('{unsubscribe_url}')).toBe('{unsubscribe_url}');
  });
  it('leaves searches as searches', () => {
    expect(typedAddress('')).toBeNull();
    expect(typedAddress('about')).toBeNull();
    expect(typedAddress('summer festival')).toBeNull();
    expect(typedAddress('2026')).toBeNull();
  });
  it('tells other sites from this one', () => {
    expect(isExternal('https://example.org/')).toBe(true);
    expect(isExternal('/about/')).toBe(false);
    expect(isExternal('mailto:a@b.org')).toBe(false);
  });
});
