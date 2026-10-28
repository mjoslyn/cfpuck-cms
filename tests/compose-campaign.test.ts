// Compose for a campaign: Claude's answer becomes its name, subject and email, keeping the email's look.
import { describe, expect, it } from 'vitest';
import { applyCampaign, campaignOutline, campaignSchema } from '../src/lib/mailing/compose';

const answer = {
  name: 'October newsletter',
  subject: 'Fall festival on the 18th',
  preheader: 'Volunteers wanted',
  heading: 'Hi {first_name|there}',
  sections: [
    { heading: '', body: 'The festival is at **Riverside Park**.', button_label: 'Volunteer', button_url: '/volunteer/' },
    { heading: 'Library hours', body: 'Open later on Thursdays.', button_label: 'See hours', button_url: 'javascript:alert(1)' },
  ],
  latest: { include: true, heading: 'Latest news', types: ['post', 'nope'], count: 40 },
  events: { include: true, heading: 'Coming up', count: 2 },
};

describe('Compose for a campaign', () => {
  it('builds the email from the answer, keeping the look', () => {
    const out = applyCampaign(answer, { root: { props: { background: '#eee', preheader: 'old' } }, content: [] }, ['post']);
    expect(out.name).toBe('October newsletter');
    expect(out.subject).toBe('Fall festival on the 18th');
    expect(out.design.root.props).toMatchObject({ background: '#eee', preheader: 'Volunteers wanted' });
    expect(out.design.content.map((b) => b.type)).toEqual(['Heading', 'Text', 'Button', 'Heading', 'Text', 'Entries', 'Events']);
    expect(out.design.content[1].props.html).toBe('<p>The festival is at <strong>Riverside Park</strong>.</p>');
    // An address that isn't a web, mail or site link leaves its button out, and says so.
    expect(out.notes[0]).toContain('See hours');
    const entries = out.design.content.find((b) => b.type === 'Entries')!;
    expect(entries.props.query).toEqual({ types: ['post'], count: 6 });
  });

  it('offers events only while they are on, and outlines the campaign without the starter text', () => {
    expect(campaignSchema([{ type: 'post', label: 'Posts' }], false).properties.events).toBeUndefined();
    expect(campaignSchema([{ type: 'post', label: 'Posts' }], true).required).toContain('events');
    const outline = campaignOutline({ name: 'X', subject: '', design: { root: { props: {} }, content: [{ type: 'Text', props: { id: 't', html: '<p>Write your news here.</p>' } }] } });
    expect(outline).not.toContain('Write your news here');
  });
});
