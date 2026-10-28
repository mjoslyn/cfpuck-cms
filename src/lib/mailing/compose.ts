// Compose for a campaign (the campaign editor; POST /api/admin/mailing/campaigns/compose): from what the
// editor says it is about and the campaign as it is, Claude writes its name, subject, preview line and
// email: a heading, sections of text each with an optional button, and optionally the site's latest
// entries and upcoming events (the email builder's Entries and Events blocks, filled when it is sent).
// The design keeps its look (colors, width); the editor reviews it in the builder and saves.
import type { EmailDoc, EmailItem, EmailRoot } from '../forms/email';
import { markdownHtml, safeUrl } from '../forms/compose';

const str = (description: string) => ({ type: 'string', description });

export interface ComposedCampaign {
  name: string;
  subject: string;
  preheader: string;
  heading: string;
  sections: { heading: string; body: string; button_label: string; button_url: string }[];
  latest: { include: boolean; heading: string; types: string[]; count: number };
  events?: { include: boolean; heading: string; count: number };
}

/** The answer's schema: `types`, the site's types with lists; events only while they are on. */
export function campaignSchema(types: { type: string; label: string }[], events: boolean): Record<string, any> {
  const properties: Record<string, any> = {
    name: str('A short name for the campaign, for the people who run the site (Spring newsletter).'),
    subject: str('The subject line: specific and short, no clickbait; tags allowed.'),
    preheader: str('A line shown after the subject in inbox lists, or "".'),
    heading: str('The heading at the top of the email; tags allowed.'),
    sections: {
      type: 'array',
      description: 'The email\'s text, in order: one to five short sections.',
      items: {
        type: 'object',
        required: ['heading', 'body', 'button_label', 'button_url'],
        properties: {
          heading: str('A heading for the section, or "" (the first usually has none).'),
          body: str('The text, as simple Markdown (paragraphs, **bold**, [links](url), "- " lists); tags allowed.'),
          button_label: str('A button after the text, or "".'),
          button_url: str('Where the button goes: a full web address, a site path like /events/, or mailto:. "" for none.'),
        },
      },
    },
    latest: {
      type: 'object',
      description: 'A list of the site\'s latest entries, filled in when the email is sent. Include it only when the brief asks for news or recent posts.',
      required: ['include', 'heading', 'types', 'count'],
      properties: {
        include: { type: 'boolean' },
        heading: str('Its heading (Latest news), or "".'),
        types: { type: 'array', items: { type: 'string', enum: types.map((t) => t.type) }, description: `Which kinds: ${types.map((t) => `${t.type} (${t.label})`).join(', ')}.` },
        count: { type: 'integer', description: 'How many, 1 to 6.' },
      },
    },
  };
  if (events)
    properties.events = {
      type: 'object',
      description: 'A list of the site\'s upcoming events, filled in when the email is sent. Include it only when the brief asks for events.',
      required: ['include', 'heading', 'count'],
      properties: { include: { type: 'boolean' }, heading: str('Its heading (Coming up), or "".'), count: { type: 'integer', description: 'How many, 1 to 6.' } },
    };
  return { type: 'object', required: Object.keys(properties), properties };
}

/** The system task. */
export function campaignTask(): string {
  return (
    'You write an email campaign the site sends to the people on its mailing lists. ' +
    'Tags put in each person\'s details when it is sent: {first_name}, {last_name}, {name}, {email}, {site_name}; a fallback after a bar, as in {first_name|there}. ' +
    'Don\'t write an unsubscribe line or the postal address: the site adds a footer with them. ' +
    'Write plainly and warmly, short paragraphs, no exclamation marks in headings, one clear thing to do.'
  );
}

/** The campaign as it is, for Claude: its name, subject and the email's text. */
export function campaignOutline(c: { name?: string; subject?: string; design?: EmailDoc | null }): string {
  const text = (items: EmailItem[] = []): string[] =>
    items.flatMap((it) => {
      const p = it.props ?? {};
      const own = it.type === 'Heading' ? [`Heading: ${p.text}`] : it.type === 'Text' ? [String(p.html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()] : it.type === 'Button' ? [`Button: ${p.label} -> ${p.url}`] : ['Entries', 'Events'].includes(it.type) ? [`(${it.type} block: ${p.heading ?? ''})`] : [];
      return [...own.filter(Boolean), ...['content', 'left', 'right'].flatMap((s) => (Array.isArray(p[s]) ? text(p[s]) : []))];
    });
  const lines = [`Campaign: ${c.name || '(unnamed)'}`, `Subject: ${c.subject || '(none yet)'}`];
  const body = text(c.design?.content);
  // The starter design's placeholder text isn't worth keeping.
  if (body.length && !body.some((l) => l.includes('Write your news here'))) lines.push('The email now:', ...body);
  return lines.join('\n');
}

const clean = (s: unknown, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const newId = (type: string) => `${type}-${Math.random().toString(36).slice(2, 10)}`;
const count = (n: unknown) => Math.min(6, Math.max(1, Math.round(Number(n) || 3)));

/** The answer as the campaign's name, subject and design, keeping the design's look (else `look`). */
export function applyCampaign(answer: ComposedCampaign, current: EmailDoc | null | undefined, types: string[], look: EmailRoot = {}): { name: string; subject: string; design: EmailDoc; notes: string[] } {
  const notes: string[] = [];
  const content: EmailItem[] = [];
  const heading = clean(answer.heading, 200);
  if (heading) content.push({ type: 'Heading', props: { id: newId('Heading'), text: heading, level: 1, align: 'left' } });
  for (const s of (answer.sections ?? []).slice(0, 6)) {
    if (clean(s.heading)) content.push({ type: 'Heading', props: { id: newId('Heading'), text: clean(s.heading, 200), level: 2, align: 'left' } });
    const html = markdownHtml(String(s.body ?? '').slice(0, 6000));
    if (html) content.push({ type: 'Text', props: { id: newId('Text'), html, align: 'left' } });
    const url = safeUrl(s.button_url);
    if (clean(s.button_label) && url) content.push({ type: 'Button', props: { id: newId('Button'), label: clean(s.button_label, 60), url, align: 'left' } });
    else if (clean(s.button_label)) notes.push(`The button “${clean(s.button_label, 60)}” was left out: it had no address to go to.`);
  }
  if (answer.latest?.include) {
    const kinds = (answer.latest.types ?? []).filter((t) => types.includes(t));
    content.push({ type: 'Entries', props: { id: newId('Entries'), heading: clean(answer.latest.heading, 120), query: { ...(kinds.length ? { types: kinds } : {}), count: count(answer.latest.count) }, showImage: true, showExcerpt: true, linkLabel: 'Read more', empty: '' } });
  }
  if (answer.events?.include) content.push({ type: 'Events', props: { id: newId('Events'), heading: clean(answer.events.heading, 120), query: { source: 'upcoming', count: count(answer.events.count) }, showImage: true, showVenue: true, showExcerpt: true, linkLabel: 'Details', empty: '' } });
  const preheader = clean(answer.preheader, 150);
  const root = { ...(current?.root?.props ?? look), preheader: preheader || undefined };
  return { name: clean(answer.name, 120), subject: clean(answer.subject, 200), design: { root: { props: root }, content }, notes };
}
