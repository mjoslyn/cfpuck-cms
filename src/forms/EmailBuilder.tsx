// The email builder, full screen over the screen that opens it. Visual: a Puck editor of email blocks
// (src/lib/forms/email.ts renders them, here and when sending, so the canvas is the email). Plain
// text: the text version, with merge tags; made from the design when empty. Preview: the email as it
// would be sent. What fills an email in comes from the caller's kit (EmailKit): a form notification's
// fields and submissions (src/forms/form-email.ts), or a ticket order's details (src/admin/ticket-email.ts).
// Both offer the Payment block (the payment's items, total and details; the canvas shows the kit's sample)
// and, on a site with events, the Events block (upcoming or picked events; the canvas shows the real ones).
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Puck, type Config, type Data } from '@puckeditor/core';
import '@puckeditor/core/no-external.css'; // without its Inter webfont: the admin uses the system font
import { EMAIL_DEFAULTS, renderBlock, renderEmail, textVersion, type EmailContext, type EmailDoc, type EmailItem, type EmailRoot } from '../lib/forms/email';
import { MediaPicker } from '../puck/fields';
import { MergeTags, RichMessage } from './rich-message';
import { EventsQueryField, useEmailEvents } from './email-events';
import { useEventsOn } from '../puck/member-settings';

/** An email as it would be sent, for the Preview tab. */
export interface RenderedEmail {
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
}

/** What fills an email in, from whoever opens the builder. */
export interface EmailKit {
  /** The data block (stored as type FormField): its name ("Form field") and what it can show; `all` is its table. */
  dataBlock: { label: string; options: [string, string][] };
  /** Merge tags offered in Text blocks and the plain text: [tag, label]. */
  tags: [string, string][];
  /** The canvas's stand-ins for what is filled in when sending (with a sample payment for the Payment block). */
  canvas: EmailContext;
  /** The Payment block, offered with this note under its settings; its plain text is {payment_summary}. */
  payment?: { note: string };
  /** A data block in the plain text made from the design (usually its merge tag). */
  textField: (id: string, showLabel: boolean) => string;
  preview: {
    /** What the preview can fill the email in from ("Answers from", "Sample answers"). */
    pickLabel: string;
    sampleLabel: string;
    /** Real ones to pick from (submissions, orders), if any. */
    choices?: () => Promise<{ id: string; label: string }[]>;
    /** The email as sent, for a choice ('' for the sample). */
    render: (email: { design: EmailDoc; text?: string }, pick: string) => Promise<RenderedEmail>;
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Payment blocks as the {payment_summary} tag, wherever they sit (for the plain text). */
const paymentAsTag = (items: EmailItem[] = []): EmailItem[] =>
  items.map((it) => {
    if (it.type === 'Payment') return { type: 'Text', props: { id: it.props.id, html: `${it.props.heading ? `<p>${esc(it.props.heading)}</p>` : ''}<p>{payment_summary}</p>` } };
    const p = { ...it.props };
    for (const slot of ['content', 'left', 'right']) if (Array.isArray(p[slot])) p[slot] = paymentAsTag(p[slot]);
    return { ...it, props: p };
  });

/** What the plain-text version starts from: the design, with tags where data blocks go. */
function textFromDesign(doc: EmailDoc, kit: EmailKit): string {
  const html = renderEmail({ ...doc, content: paymentAsTag(doc.content) }, { merge: (text) => text, field: kit.textField, origin: window.location.origin });
  return textVersion(html.replace(/<div style="display:none[^"]*">[\s\S]*?<\/div>/, ''));
}

// The document's settings, for the blocks rendered inside it.
const RootProps = createContext<EmailRoot>({});
const KitContext = createContext<EmailKit | null>(null);

const placeholder = (text: string) => `<p style="margin:0;color:#94a3b8;font-size:13px">${esc(text)}</p>`;

/** A leaf block: its email HTML, as sent. */
function Leaf({ type, props }: { type: string; props: Record<string, any> }) {
  const root = useContext(RootProps);
  const kit = useContext(KitContext)!;
  const html = renderBlock({ type, props: { id: '', ...props } } as EmailItem, kit.canvas, root);
  return <div dangerouslySetInnerHTML={{ __html: html || placeholder('(empty)') }} />;
}

/** The Events block, with the site's events as they are now. */
function EventsLeaf(props: Record<string, any>) {
  const root = useContext(RootProps);
  const kit = useContext(KitContext)!;
  const { events, error } = useEmailEvents(props.query);
  if (!events) return <div dangerouslySetInnerHTML={{ __html: placeholder('Loading events…') }} />;
  const item = { type: 'Events', props: { ...props, id: 'canvas' } } as EmailItem;
  const html = renderBlock(item, { ...kit.canvas, events: { canvas: events } }, root);
  return <div dangerouslySetInnerHTML={{ __html: html || placeholder(error || 'No events to show now, so the block shows nothing.') }} />;
}

function ColorField({ label, value, onChange, fallback }: { label: string; value?: string; onChange: (v: string | undefined) => void; fallback: string }) {
  return (
    <div>
    <div className="mb-1.5 text-sm font-medium text-[#3b3b3b]">{label}</div>
    <div className="flex items-center gap-2">
      <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-admin-ink/15" />
      <input type="text" aria-label={label} value={value ?? ''} placeholder={fallback} onChange={(e) => onChange(e.target.value || undefined)} className="w-full rounded border border-admin-ink/15 px-2 py-1 text-sm" />
    </div>
    </div>
  );
}
const color = (label: string, fallback: string) => ({ type: 'custom' as const, label, render: ({ value, onChange }: any) => <ColorField label={label} value={value} onChange={onChange} fallback={fallback} /> });
const alignField = { type: 'radio' as const, label: 'Align', options: [{ label: 'Left', value: 'left' }, { label: 'Centre', value: 'center' }, { label: 'Right', value: 'right' }] };

function emailConfig(kit: EmailKit, events: boolean): Config {
  const leaf = (type: string) => (props: any) => <Leaf type={type} props={props} />;
  return {
    categories: {
      content: { title: 'Content', components: ['Heading', 'Text', 'Button', 'Image', 'FormField', ...(kit.payment ? ['Payment'] : []), ...(events ? ['Events'] : [])] },
      layout: { title: 'Layout', components: ['Section', 'Columns', 'Divider', 'Spacer'] },
    },
    root: {
      fields: {
        preheader: { type: 'text', label: 'Preview text (after the subject in the inbox)' },
        background: color('Page background', EMAIL_DEFAULTS.background),
        contentBackground: color('Email background', EMAIL_DEFAULTS.contentBackground),
        textColor: color('Text colour', EMAIL_DEFAULTS.textColor),
        linkColor: color('Link and button colour', EMAIL_DEFAULTS.linkColor),
        fontFamily: {
          type: 'select',
          label: 'Font',
          options: [
            { label: 'Helvetica / Arial', value: 'Helvetica, Arial, sans-serif' },
            { label: 'Georgia (serif)', value: "Georgia, 'Times New Roman', serif" },
            { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
            { label: 'Trebuchet', value: "'Trebuchet MS', Helvetica, sans-serif" },
          ],
        },
        width: { type: 'number', label: 'Width (px)', min: 320, max: 800 },
      },
      render: ({ children, ...p }: any) => {
        const r = { ...EMAIL_DEFAULTS, ...Object.fromEntries(Object.entries(p).filter(([k, v]) => k !== 'puck' && v !== undefined && v !== '')) } as typeof EMAIL_DEFAULTS & EmailRoot;
        return (
          <RootProps.Provider value={p}>
            <div style={{ background: r.background, padding: '24px 12px', minHeight: '100%' }}>
              <div style={{ maxWidth: Number(r.width) || 600, margin: '0 auto', background: r.contentBackground, padding: 32, fontFamily: r.fontFamily, color: r.textColor, fontSize: 16, lineHeight: 1.55 }}>{children}</div>
            </div>
          </RootProps.Provider>
        );
      },
    },
    components: {
      Heading: {
        label: 'Heading',
        fields: { text: { type: 'text', label: 'Text (field tags allowed)' }, level: { type: 'select', label: 'Size', options: [{ label: 'Large', value: 1 }, { label: 'Medium', value: 2 }, { label: 'Small', value: 3 }] }, align: alignField, color: color('Colour', EMAIL_DEFAULTS.textColor) },
        defaultProps: { text: 'Heading', level: 2, align: 'left' },
        render: leaf('Heading'),
      },
      Text: {
        label: 'Text',
        fields: {
          html: { type: 'custom', label: 'Text', render: ({ value, onChange }: any) => <RichMessage label="Text" value={value} tags={kit.tags} onChange={onChange} /> },
          align: alignField,
          color: color('Colour', EMAIL_DEFAULTS.textColor),
        },
        defaultProps: { html: '<p>Write something here.</p>', align: 'left' },
        render: leaf('Text'),
      },
      Button: {
        label: 'Button',
        fields: { label: { type: 'text', label: 'Label' }, url: { type: 'text', label: 'Link (https://, mailto:, a /path, or a field tag)' }, align: alignField, background: color('Button colour', EMAIL_DEFAULTS.linkColor), color: color('Label colour', '#ffffff') },
        defaultProps: { label: 'Open', url: '', align: 'left' },
        render: leaf('Button'),
      },
      Image: {
        label: 'Image',
        fields: {
          src: { type: 'custom', label: 'Image', render: ({ value, onChange }: any) => <MediaPicker title="Image" url={value} onSelect={(m) => onChange(m.url)} /> },
          alt: { type: 'text', label: 'Alt text' },
          width: { type: 'number', label: 'Width (px)', min: 20, max: 800 },
          href: { type: 'text', label: 'Link (optional)' },
          align: alignField,
        },
        defaultProps: { src: '', alt: '', align: 'center' },
        render: leaf('Image'),
      },
      FormField: {
        label: kit.dataBlock.label,
        fields: {
          field: { type: 'select', label: 'Shows', options: kit.dataBlock.options.map(([value, label]) => ({ label, value })) },
          showLabel: { type: 'radio', label: 'Show its label', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
        },
        defaultProps: { field: 'all', showLabel: true },
        render: leaf('FormField'),
      },
      Payment: {
        label: 'Payment',
        fields: {
          heading: { type: 'text', label: 'Heading (optional)' },
          showItems: { type: 'radio', label: 'Show each item', options: [{ label: 'Yes', value: true }, { label: 'No, only the total', value: false }] },
          showDetails: { type: 'radio', label: 'Show status, provider, payment ID and date', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
          note: { type: 'custom', render: () => <p className="text-xs text-admin-muted">{kit.payment?.note}</p> },
        },
        defaultProps: { heading: 'Payment', showItems: true, showDetails: true },
        render: leaf('Payment'),
      },
      Events: {
        label: 'Events',
        fields: {
          heading: { type: 'text', label: 'Heading (optional)' },
          query: { type: 'custom', label: 'Shows', render: ({ value, onChange }: any) => <EventsQueryField value={value} onChange={onChange} /> },
          showImage: { type: 'radio', label: 'Image', options: [{ label: 'Show', value: true }, { label: 'Hide', value: false }] },
          showVenue: { type: 'radio', label: 'Venue', options: [{ label: 'Show', value: true }, { label: 'Hide', value: false }] },
          showExcerpt: { type: 'radio', label: 'Short description', options: [{ label: 'Show', value: true }, { label: 'Hide', value: false }] },
          linkLabel: { type: 'text', label: 'Link text under each (empty: the title is the link)' },
          empty: { type: 'text', label: 'When there are none (empty: the block shows nothing)' },
        },
        defaultProps: { heading: 'Coming up', query: { source: 'upcoming', count: 3 }, showImage: true, showVenue: true, showExcerpt: true, linkLabel: 'Details', empty: '' },
        render: (props: any) => <EventsLeaf {...props} />,
      },
      Divider: { label: 'Divider', fields: { color: color('Colour', '#e5e1dc') }, defaultProps: {}, render: leaf('Divider') },
      Spacer: { label: 'Spacer', fields: { height: { type: 'number', label: 'Height (px)', min: 4, max: 200 } }, defaultProps: { height: 24 }, render: leaf('Spacer') },
      Section: {
        label: 'Section',
        fields: { background: color('Background', '#f5f3f0'), padding: { type: 'number', label: 'Padding (px)', min: 0, max: 80 }, radius: { type: 'number', label: 'Corner radius (px)', min: 0, max: 24 }, content: { type: 'slot', disallow: ['Section'] } },
        defaultProps: { background: '#f5f3f0', padding: 24, radius: 0, content: [] },
        render: ({ background, padding, radius, content: Content }: any) => (
          <div style={{ background, padding: Number(padding) || 0, borderRadius: Number(radius) || 0, marginBottom: 12 }}>
            <Content />
          </div>
        ),
      },
      Columns: {
        label: 'Two columns',
        fields: { gap: { type: 'number', label: 'Gap (px)', min: 0, max: 60 }, left: { type: 'slot', disallow: ['Columns', 'Section'] }, right: { type: 'slot', disallow: ['Columns', 'Section'] } },
        defaultProps: { gap: 24, left: [], right: [] },
        render: ({ gap, left: Left, right: Right }: any) => (
          <div style={{ display: 'flex', gap: Number(gap) || 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Left />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Right />
            </div>
          </div>
        ),
      },
    },
  } as Config;
}

// The canvas at email widths (the 600px email with its margins, and a phone), so it shows at full size.
const EMAIL_VIEWPORTS = [
  { width: 700, height: 'auto' as const, label: 'Email', icon: 'Monitor' as const },
  { width: 390, height: 'auto' as const, label: 'Phone', icon: 'Smartphone' as const },
];

const tabCls = (on: boolean) => `-mb-px border-b-2 px-4 py-2 text-sm font-medium ${on ? 'border-admin-accent text-admin-ink' : 'border-transparent text-admin-muted hover:text-admin-ink'}`;

export default function EmailBuilder({ title, kit, design: start, text, note, onChange, onClose }: { title: string; kit: EmailKit; design: EmailDoc; text?: string; note: string; onChange: (patch: { design?: EmailDoc; text?: string }) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'visual' | 'text' | 'preview'>('visual');
  // The Events block while the site's events are on (Settings > Events).
  const eventsAreOn = useEventsOn();
  const config = useMemo(() => emailConfig(kit, eventsAreOn === true), [kit, eventsAreOn]);
  // Puck keeps its own state; it starts from the design and reports every change.
  const initial = useRef<Data>(start as unknown as Data);
  const [design, setDesign] = useState<EmailDoc>(start);

  return (
    <div className="fixed inset-0 z-[900] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex items-center justify-between gap-4 border-b border-admin-ink/10 px-4">
        <div className="flex items-end gap-1">
          <span className="mr-4 py-2 text-sm font-semibold">{title}</span>
          {(['visual', 'text', 'preview'] as const).map((t) => (
            <button key={t} type="button" className={tabCls(tab === t)} onClick={() => setTab(t)}>
              {t === 'visual' ? 'Visual' : t === 'text' ? 'Plain text' : 'Preview'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 py-2">
          <span className="text-xs text-admin-muted">{note}</span>
          <button type="button" onClick={onClose} className="rounded-sm bg-admin-ink px-4 py-1.5 text-xs font-semibold tracking-wider text-white uppercase hover:bg-admin-accent">
            Done
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <div className={tab === 'visual' ? 'h-full' : 'hidden'}>
          <KitContext.Provider value={kit}>
            {/* Changes go to the caller as they are made, so Puck's own Publish is left out. */}
            <Puck
              config={config}
              data={initial.current}
              onChange={(d: Data) => {
                setDesign(d as unknown as EmailDoc);
                onChange({ design: d as unknown as EmailDoc });
              }}
              headerTitle={'\u200b'}
              overrides={{ headerActions: () => <></> }}
              viewports={EMAIL_VIEWPORTS}
            />
          </KitContext.Provider>
        </div>
        {tab === 'text' && <PlainText kit={kit} design={design} value={text ?? ''} onChange={(t) => onChange({ text: t || undefined })} />}
        {tab === 'preview' && <Preview kit={kit} design={design} text={text} />}
      </div>
    </div>
  );
}

function PlainText({ kit, design, value, onChange }: { kit: EmailKit; design: EmailDoc; value: string; onChange: (v: string) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const insert = (tag: string) => {
    const el = area.current;
    if (!el) return onChange(value + tag);
    const [a, b] = [el.selectionStart, el.selectionEnd];
    onChange(value.slice(0, a) + tag + value.slice(b));
    requestAnimationFrame(() => (el.focus(), el.setSelectionRange(a + tag.length, a + tag.length)));
  };
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col p-6">
      <p className="mb-3 text-sm text-[#475569]">
        The plain-text version, for mail apps that don't show HTML. Left empty, it is made from the visual design when the email is sent.
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <MergeTags tags={kit.tags} onInsert={insert} />
        <button type="button" className="rounded border border-admin-ink/15 bg-white px-2.5 py-1 text-xs hover:border-admin-accent" onClick={() => (!value || confirm('Replace the plain text with one made from the visual design?')) && onChange(textFromDesign(design, kit))}>
          Fill from the visual design
        </button>
        {value && (
          <button type="button" className="text-xs text-[#b3261e]" onClick={() => confirm('Clear the plain text? It will be made from the visual design.') && onChange('')}>
            Clear
          </button>
        )}
      </div>
      <textarea ref={area} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Made from the visual design when empty." className="min-h-0 flex-1 rounded border border-admin-ink/15 p-3 font-mono text-sm outline-none focus:border-admin-accent" />
    </div>
  );
}

function Preview({ kit, design, text }: { kit: EmailKit; design: EmailDoc; text?: string }) {
  const [choices, setChoices] = useState<{ id: string; label: string }[] | null>(null);
  const [pick, setPick] = useState('');
  const [out, setOut] = useState<RenderedEmail | null>(null);
  const [error, setError] = useState('');
  const [width, setWidth] = useState<'desktop' | 'phone'>('desktop');
  useEffect(() => {
    kit.preview.choices?.().then(setChoices, (e) => setError(e.message));
  }, [kit]);
  useEffect(() => {
    setError('');
    kit.preview.render({ design, text }, pick).then(setOut, (e) => setError(e.message));
  }, [pick, kit]);
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col bg-admin-soft">
        <div className="flex flex-wrap items-center gap-3 border-b border-admin-ink/10 bg-white px-4 py-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-xs text-admin-muted">{kit.preview.pickLabel}</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} className="rounded border border-admin-ink/15 px-2 py-1 text-sm">
              <option value="">{kit.preview.sampleLabel}</option>
              {(choices ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto flex gap-1 text-xs">
            {(['desktop', 'phone'] as const).map((w) => (
              <button key={w} type="button" onClick={() => setWidth(w)} className={`rounded px-2 py-1 ${width === w ? 'bg-admin-ink text-white' : 'bg-[#f1f5f9]'}`}>
                {w === 'desktop' ? 'Desktop' : 'Phone'}
              </button>
            ))}
          </span>
        </div>
        {error && <p className="p-4 text-sm text-[#b3261e]">{error}</p>}
        {out && (
          <>
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 border-b border-admin-ink/10 bg-white px-4 py-3 text-sm">
              <dt className="text-admin-muted">To</dt>
              <dd>{out.to.join(', ') || <span className="text-[#b3261e]">No valid address: this email wouldn't be sent.</span>}</dd>
              {out.replyTo && (
                <>
                  <dt className="text-admin-muted">Reply-to</dt>
                  <dd>{out.replyTo}</dd>
                </>
              )}
              <dt className="text-admin-muted">Subject</dt>
              <dd className="font-medium">{out.subject}</dd>
            </dl>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <iframe title="Email preview" srcDoc={out.html} sandbox="" className="mx-auto block h-full min-h-[600px] border-0 bg-white shadow" style={{ width: width === 'desktop' ? '100%' : 390, maxWidth: '100%' }} />
            </div>
          </>
        )}
      </div>
      <aside className="w-96 shrink-0 overflow-y-auto border-l border-admin-ink/10 p-4">
        <h3 className="mb-2 text-xs font-semibold tracking-wider text-admin-muted uppercase">Plain text</h3>
        <pre className="text-xs whitespace-pre-wrap">{out?.text ?? ''}</pre>
      </aside>
    </div>
  );
}
