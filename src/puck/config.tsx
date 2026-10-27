// Puck configuration: one component per block type, rendered through BlockView.
import type { Config, Fields } from '@puckeditor/core';
import { BlockView } from './BlockView';
import { JsonAttrs, Row, Select, Text, Toggle, inputClass, type Attrs } from './fields';
import { EntryField } from './entry-fields';
import { MembersPanel } from './MembersPanel';
import { NewsletterPanel, SubscribePanel } from './SubscribePanel';
import { FormStylePanel } from './FormStyle';
import { EVENT_BLOCKS } from '../lib/events/on';
import { SITE_BLOCKS } from '../lib/site/render';
import { taxonomiesOf } from '../lib/site';
import { SITE_EDITOR } from '../lib/site/editor';
import type { BlockCategory } from '../lib/site/extend';
import { FormPicker } from './FormPicker';
import { CONTENT_PANELS, CONTENT_LABELS, CONTENT_DEFAULTS, CONTENT_CONTAINERS } from './panels';
import { CollectionPanel, TermPicker } from './CollectionPanel';
import { cardTemplate, DEFAULT_CARD } from '../lib/content/card-presets';
import { moveItemsLayout } from '../lib/content/collections';
import type { PuckItem } from '../lib/puck/types';
import { LinkedContentPanel, LinkedPatternPanel, SaveAsPattern } from './LinkedPatterns';

type Panel = (a: Attrs, set: (patch: Attrs) => void) => React.ReactNode;

const PANELS: Record<string, Panel> = {
  'event-date': (a, set) => <Text title="Date format (PHP)" value={a.format} onChange={(v) => set({ format: v || undefined })} placeholder="M j, Y" />,
  'event-calendar': (a, set) => (
    <>
      <Text title="Title" value={a.title} placeholder="(none)" onChange={(v) => set({ title: v || undefined })} />
      <Select title="Shows first" value={a.view === 'list' ? 'list' : 'calendar'} options={[['calendar', 'Calendar'], ['list', 'List']]} onChange={(v) => set({ view: v === 'list' ? 'list' : undefined })} />
      <Text title="Events in the list" value={a.count} placeholder="6" onChange={(v) => set({ count: Number(v) || undefined })} />
      {/* The event type's taxonomies (none: no category picker). */}
      {taxonomiesOf('event').length > 0 && <TermPicker title="Categories (any of)" taxonomies={taxonomiesOf('event')} value={(a.categories ?? []).map(Number)} onChange={(ids) => set({ categories: ids.length ? ids : undefined })} />}
      <TermPicker title="Tagged with (any of)" taxonomies={['tag']} value={(a.tags ?? []).map(Number)} onChange={(ids) => set({ tags: ids.length ? ids : undefined })} />
      <p className="mb-2 text-xs text-admin-muted">Visitors switch between Calendar and List, and page through months, without leaving the page.</p>
    </>
  ),
};

Object.assign(PANELS, {
  tickets: (a: Attrs, set: (p: Attrs) => void) => (
    <>
      <EntryField title="Event" entryType="event" value={a.event} onChange={(id) => set({ event: id || undefined, date: undefined })} />
      {a.event ? (
        <Row title="Date (a recurring event's; empty: its next)">
          <input type="date" className={inputClass} value={a.date ?? ''} onChange={(e) => set({ date: e.target.value || undefined })} />
        </Row>
      ) : (
        <p className="mb-3 text-xs text-admin-muted">With no event chosen, it shows the tickets of the event whose page it is on (in an event template, each event's own).</p>
      )}
      <Text title="Heading" value={a.heading} placeholder="Tickets (or the event's own)" onChange={(v) => set({ heading: v || undefined })} />
      <p className="mb-2 text-xs text-admin-muted">The event's ticket types, prices and questions are in its settings, under Tickets. On an event's page the Event details block shows them on its own, unless a Tickets block for that event is on the page.</p>
    </>
  ),
  members: (a: Attrs, set: (p: Attrs) => void) => <MembersPanel a={a} set={set} />,
  'member-account': () => (
    <p className="mb-2 text-xs text-admin-muted">Signing in, creating an account (when Settings &gt; Members allows it) and resetting a password; signed in, the member's details and Sign out. The site's /account/ page shows it on its own; a page with that address needs this block.</p>
  ),
  'member-link': (a: Attrs, set: (p: Attrs) => void) => (
    <>
      <Text title="Label" value={a.label} placeholder="Sign in" onChange={(v) => set({ label: v || undefined })} />
      <Text title="Label when signed in" value={a.signedInLabel} placeholder="My account" onChange={(v) => set({ signedInLabel: v || undefined })} />
      <p className="mb-2 text-xs text-admin-muted">Links to the account page. Pages with it stay cached; the label changes in the visitor's browser.</p>
    </>
  ),
  subscribe: (a: Attrs, set: (p: Attrs) => void) => <SubscribePanel a={a} set={set} />,
  newsletter: (a: Attrs, set: (p: Attrs) => void) => <NewsletterPanel a={a} set={set} />,
  'mail-preferences': (a: Attrs, set: (p: Attrs) => void) => (
    <>
      <Select title="Shows first" value={a.view === 'unsubscribe' ? 'unsubscribe' : 'preferences'} options={[['preferences', 'Email preferences'], ['unsubscribe', 'Unsubscribe']]} onChange={(v) => set({ view: v === 'unsubscribe' ? 'unsubscribe' : undefined })} />
      <p className="mb-2 text-xs text-admin-muted">For whoever followed a link from one of the site's emails (or the signed-in member): confirming a sign-up, choosing lists, unsubscribing. The site's /email-preferences/ and /unsubscribe/ pages show it on their own; a page with one of those addresses needs this block.</p>
    </>
  ),
  'form': (a: Attrs, set: (p: Attrs) => void) => (
    <>
      <FormPicker value={a.formId} onChange={(formId) => set({ formId })} />
      <Toggle title="Show the form title" value={a.showTitle} onChange={(v) => set({ showTitle: v || undefined })} />
      <Toggle title="Show the form description" value={a.showDescription} onChange={(v) => set({ showDescription: v || undefined })} />
      <FormStylePanel a={a} set={set} />
    </>
  ),
});

Object.assign(PANELS, CONTENT_PANELS, {
  collection: (a: Attrs, set: (p: Attrs) => void) => <CollectionPanel a={a} set={set} />,
  'entry-field': (a: Attrs, set: (p: Attrs) => void) => (
    <>
      <Text title="Field" value={a.field} placeholder="phone, email, website, address..." onChange={(v) => set({ field: v || undefined })} />
      <Select title="Show as" value={a.as} options={[['text', 'Text'], ['link', 'Web link'], ['email', 'Email link'], ['phone', 'Phone link'], ['image', 'Image']]} onChange={(v) => set({ as: v })} />
      <Text title="Label before it" value={a.label} placeholder="(none)" onChange={(v) => set({ label: v || undefined })} />
      {['link', 'email', 'phone'].includes(a.as) && <Text title="Link text" value={a.linkText} placeholder="The value" onChange={(v) => set({ linkText: v || undefined })} />}
      {a.as === 'link' && <Toggle title="Open in a new tab" value={a.newTab} onChange={(v) => set({ newTab: v || undefined })} />}
    </>
  ),
});

// The site's panels (src/site/editor.tsx) come last, so a site can also replace a core block's panel.
Object.assign(PANELS, SITE_EDITOR.panels ?? {});

/** Older lists keep their items as list-item blocks; flat ones become the list's own items when opened. */
function resolveList(props: any) {
  const a = props.attrs ?? {};
  if (Array.isArray(a.items) || !props.children?.length) return { props };
  // Items with lists inside stay as they are: the items setting is one flat list, and moving them there
  // would drop the nested lists on the next save. (They render and edit as child blocks.)
  if ((props.children as PuckItem[]).some((c) => c.type === 'list-item' && c.props.children?.length)) return { props };
  const items = (props.children as PuckItem[]).filter((c) => c.type === 'list-item').map((c) => ({ content: String(c.props.attrs?.content ?? '') }));
  const { ordered, variant, ...rest } = a;
  const marker = ordered ? 'number' : variant === 'plain' ? 'none' : 'bullet';
  return { props: { ...props, attrs: { ...rest, marker, items }, children: undefined } };
}

/**
 * A collection's children follow its settings: the card design replaces the item template (a new
 * collection starts with the first design), and setting pagination or an empty message retires the
 * older child blocks that did those jobs.
 */
function resolveCollection(input: any) {
  // Older collections kept columns and gap on the items block; they belong to the collection.
  const moved = moveItemsLayout({ type: 'collection', props: input } as PuckItem).props as any;
  const props = moved === input ? input : { ...input, ...moved };
  const a = props.attrs ?? {};
  let kids: PuckItem[] = props.children ?? [];
  const items = kids.find((k) => k.type === 'collection-items');
  const card = a.card && a.card !== 'custom' ? a.card : !items ? DEFAULT_CARD : null;
  let attrs = a;
  if (card && (a.appliedCard !== card || !items)) {
    const next = { type: 'collection-items', props: { id: `${props.id}-items-${Date.now().toString(36)}`, attrs: items?.props.attrs ?? {}, children: cardTemplate(card, `${props.id}-${Date.now().toString(36)}`) } } as PuckItem;
    kids = items ? kids.map((k) => (k === items ? next : k)) : [next, ...kids];
    attrs = { ...a, card, appliedCard: card };
  }
  if (a.pagination) kids = kids.filter((k) => k.type !== 'pagination');
  if (a.emptyText) kids = kids.filter((k) => k.type !== 'collection-empty');
  return kids === props.children && attrs === a ? { props } : { props: { ...props, attrs, children: kids } };
}

/** Media picked in a gallery's settings (attrs.add) are appended as its image, video or embed blocks. */
function resolveGallery(props: any) {
  const { add, ...attrs } = props.attrs ?? {};
  if (!Array.isArray(add)) return { props };
  const stamp = Date.now().toString(36);
  const added = add.map((m: { type: string; attrs: Attrs }, i: number) => ({ type: m.type, props: { id: `${props.id}-${stamp}-${i}`, attrs: m.attrs } }));
  return { props: { ...props, attrs, children: [...(props.children ?? []), ...added] } };
}

const SLOT_ALLOW: Record<string, string[]> = {
  collection: ['collection-items', 'collection-empty', 'pagination'],
  gallery: ['image'],
  'video-gallery': ['embed', 'video'],
};

const LABELS: Record<string, string> = {
  ...CONTENT_LABELS,
  ...Object.fromEntries(Object.entries(SITE_BLOCKS).map(([t, d]) => [t, d.label])),
  'event-date': 'Event date',
  'entry-field': 'Field',
  pattern: 'Linked pattern',
  'form': 'Form',
  'event-details': 'Event details',
  tickets: 'Tickets',
  members: 'Members only',
  'member-account': 'Member account',
  'member-link': 'Member sign-in link',
  subscribe: 'Subscribe',
  newsletter: 'Newsletter signup',
  'mail-preferences': 'Email preferences',
  'events-calendar': 'Events page (list, month, day)',
  'event-calendar': 'Events calendar',
};
const label = (type: string) => LABELS[type] ?? type.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Blocks whose children are edited in place (a slot). */
const CONTAINERS = new Set([...CONTENT_CONTAINERS, 'pattern', 'members']);

function AttrsPanel({ type, value, onChange }: { type: string; value: Attrs; onChange: (v: Attrs) => void }) {
  const a = value ?? {};
  const set = (patch: Attrs) => onChange({ ...a, ...patch });
  const panel = PANELS[type];
  // Inside a linked pattern only content changes; the pattern itself has its own panel.
  if (a.__src) return <div className="px-1"><LinkedContentPanel type={type} a={a} set={set} /></div>;
  if (type === 'pattern' && a.linked) return <div className="px-1"><LinkedPatternPanel a={a} /></div>;
  return (
    <div className="px-1">
      {panel ? panel(a, set) : <p className="mb-2 text-xs text-admin-muted">Configure this block in the attributes below.</p>}
      <JsonAttrs value={a} onChange={onChange} />
      <SaveAsPattern />
    </div>
  );
}

/** A category's core blocks followed by the site's blocks in it. */
const withSite = (category: BlockCategory, core: string[]) => [...core, ...Object.entries(SITE_BLOCKS).filter(([, d]) => d.category === category).map(([t]) => t)];

/** Blocks that only work on some entry types (they read that type's own fields). */
const APPLIES_TO: Record<string, string[]> = {
  'event-details': ['event'],
  'event-schedule': ['event'],
  ...Object.fromEntries(Object.entries(SITE_BLOCKS).flatMap(([t, d]) => (d.types ? [[t, d.types]] : []))),
};

/**
 * The editor's blocks. With `entryType` (editing an entry), the block list leaves out blocks that don't
 * apply to that type; they stay defined, so any already on the page still show and can be edited.
 */
export function buildConfig(types: string[], entryType?: string, opts: { members?: boolean; events?: boolean; mailing?: boolean } = {}): Config {
  // Event and ticket blocks are offered while events are on (Settings > Events).
  const applies = (t: string) => (!entryType || !APPLIES_TO[t] || APPLIES_TO[t].includes(entryType)) && (opts.events !== false || !EVENT_BLOCKS.includes(t));
  const offered = (cats: Record<string, { title?: string; components?: string[]; visible?: boolean }>) =>
    Object.fromEntries(Object.entries(cats).map(([k, c]) => [k, c.components ? { ...c, components: c.components.filter(applies) } : c]));
  const components: Config['components'] = {};
  for (const type of types) {
    const fields: Fields = {
      attrs: {
        type: 'custom',
        label: label(type),
        render: ({ value, onChange }) => <AttrsPanel type={type} value={value} onChange={onChange} />,
      },
    } as Fields;
    if (CONTAINERS.has(type)) (fields as any).children = SLOT_ALLOW[type] ? { type: 'slot', allow: SLOT_ALLOW[type] } : { type: 'slot' };
    components[type] = {
      label: label(type),
      inline: true,
      fields,
      defaultProps: { attrs: CONTENT_DEFAULTS[type] ?? {} },
      ...(type === 'collection' ? { resolveData: ({ props }: any) => resolveCollection(props) } : {}),
      ...(type === 'list' ? { resolveData: ({ props }: any) => resolveList(props) } : {}),
      ...(type === 'gallery' || type === 'video-gallery' ? { resolveData: ({ props }: any) => resolveGallery(props) } : {}),
      render: (props: any) => <BlockView type={type} {...props} />,
      // A linked pattern's blocks stay where the pattern puts them: no moving, removing, copying or adding.
      resolvePermissions: (data: any, { permissions }: any) =>
        data.props?.attrs?.__src ? { ...permissions, drag: false, duplicate: false, delete: false, insert: false } : type === 'pattern' && data.props?.attrs?.linked ? { ...permissions, duplicate: false, insert: false } : permissions,
    };
  }
  return {
    categories: offered({
      text: { title: 'Text', components: withSite('text', ['text', 'heading', 'list', 'quote', 'button', 'buttons']) },
      media: { title: 'Media', components: withSite('media', ['image', 'cover', 'gallery', 'video-gallery', 'media-text', 'embed', 'video', 'file']) },
      layout: { title: 'Layout', components: withSite('layout', ['section', 'columns', 'column', 'spacer', 'separator', 'global', 'site-title', 'navigation', 'social-links']) },
      dynamic: { title: 'Lists and listings', components: withSite('dynamic', ['collection', 'collection-filters', 'map', 'search-form', 'event-calendar', 'events-calendar', 'archive-title']) },
      card: { title: 'Card fields', components: withSite('card', ['entry-title', 'entry-image', 'entry-excerpt', 'entry-date', 'event-date', 'entry-terms', 'entry-field']) },
      sections: { title: 'Sections', components: withSite('sections', ['hero', 'form']) },
      site: { title: 'Site', components: withSite('site', ['event-details', 'event-schedule', 'tickets']) },
      // Offered while Members is on (Settings > Members); blocks already placed stay editable.
      ...(opts.members ? { members: { title: 'Members', components: ['members', 'member-account', 'member-link'] } } : {}),
      // Offered while Mailing is on (Settings > Mailing Lists).
      ...(opts.mailing ? { mailing: { title: 'Mailing Lists', components: ['newsletter', 'subscribe', 'mail-preferences'] } } : {}),
      advanced: { title: 'Advanced', components: withSite('advanced', ['html', 'part', 'entry-content']) },
      // Collection internals (items, empty state, pagination) are managed from the collection's settings.
      other: { visible: false },
    }),
    components,
  } as Config;
}

export const EDITABLE_TYPES = [
  ...Object.keys(CONTENT_PANELS),
  'collection',
  'event-date', 'event-details', 'event-schedule', 'tickets', 'events-calendar', 'event-calendar',
  'members', 'member-account', 'member-link',
  'subscribe', 'newsletter', 'mail-preferences',
  'entry-field', 'form', 'pattern',
  ...Object.keys(SITE_BLOCKS),
];
