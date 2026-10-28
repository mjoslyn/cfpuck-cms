import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS, sectionOf, settingsPath } from '../src/lib/admin/settings-sections';

describe('settings sections', () => {
  it('reads the section from its address', () => {
    expect(sectionOf('/admin/settings/')).toBe('');
    expect(sectionOf('/admin/settings/tickets/')).toBe('tickets');
    expect(sectionOf('/admin/settings/tickets')).toBe('tickets');
    expect(sectionOf('/admin/settings/nothing/')).toBeNull();
  });

  it('forwards links from before sections had addresses', () => {
    expect(sectionOf('/admin/settings/', '#connections')).toBe('connections');
    expect(sectionOf('/admin/settings/', '#admin')).toBe('appearance');
    expect(sectionOf('/admin/settings/admin/')).toBe('appearance');
    expect(sectionOf('/admin/settings/', '#nothing')).toBe('');
  });

  it('gives General the Settings address and every other section its own', () => {
    expect(settingsPath('general')).toBe('/admin/settings/');
    for (const s of SETTINGS_SECTIONS) expect(sectionOf(settingsPath(s.id)) || 'general').toBe(s.id);
  });
});
