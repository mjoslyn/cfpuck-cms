import { describe, expect, it } from 'vitest';
import { sendAction } from '../src/lib/mailing/config';

describe('sendAction (the campaign screen confirmed Send)', () => {
  it('resumes a paused or failed campaign, so its failed batches are sent again', () => {
    expect(sendAction('failed', 'send')).toBe('resume');
    expect(sendAction('paused', 'send')).toBe('resume');
  });
  it('sends a draft, and leaves schedule and approve as they are', () => {
    expect(sendAction('draft', 'send')).toBe('send');
    expect(sendAction('failed', 'schedule')).toBe('schedule');
    expect(sendAction('review', 'approve')).toBe('approve');
  });
});
