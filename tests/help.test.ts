import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_GUIDE, EDITOR_GUIDE, helpUrl } from '../src/lib/help';

describe('helpUrl', () => {
  afterEach(() => {
    delete process.env.HELP_URL;
    delete process.env.ADMIN_HELP_URL;
  });

  it('sends editors to the Editor guide and admins to the Admin guide', () => {
    expect(helpUrl()).toBe(EDITOR_GUIDE);
    expect(helpUrl(false)).toBe(EDITOR_GUIDE);
    expect(helpUrl(true)).toBe(ADMIN_GUIDE);
  });

  it('sends everyone to HELP_URL when it is set', () => {
    process.env.HELP_URL = 'https://example.org/help/';
    expect(helpUrl(false)).toBe('https://example.org/help/');
    expect(helpUrl(true)).toBe('https://example.org/help/');
  });

  it('sends admins to ADMIN_HELP_URL over HELP_URL', () => {
    process.env.HELP_URL = 'https://example.org/help/';
    process.env.ADMIN_HELP_URL = 'https://example.org/admin-help/';
    expect(helpUrl(false)).toBe('https://example.org/help/');
    expect(helpUrl(true)).toBe('https://example.org/admin-help/');
  });
});
