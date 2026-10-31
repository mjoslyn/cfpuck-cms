// Site settings island: a side menu of sections in groups (src/lib/admin/settings-sections.ts), each at
// its own address (/admin/settings/<section>/; moving between them stays on the page, so unsaved changes
// carry over). Site: General (name, tagline, front page), Menu, Social (profile links, default share
// image), Search (the types it covers), Types (the templates for each type's pages and listing) and the
// site's own options. Features, marked On or Off: Events (on or off, the default time zone), Tickets
// (payments and ticket emails; while events are on), Members, Mailing Lists. Services: Connections (keys
// for Claude, Stripe, Square and Mailgun, src/admin/Connections.tsx). Admin: Accessibility (checking
// pages before they are published), Appearance (the admin's colors and logo). Upkeep: Redirects (saved
// as they are added, with the Not found log), Sync (with another copy of the site), Backups. One Save
// for all, beside the section's title while there are unsaved changes; leaving with some asks first.
// On phones the menu is a Section dropdown.
import type { PaymentProvider, ProviderStatus } from '../lib/payments';
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { SAVES_AS_IT_GOES, SETTINGS_GROUPS, sectionOf, settingsPath } from '../lib/admin/settings-sections';
import { FieldsForm } from './entry-fields';
import { SITE_EDITOR } from '../lib/site/editor';
import { ARCHIVE_PATHS, CONTENT_TYPES, PAGELESS_TYPES, SEARCHABLE_TYPES, TYPE_BASES, codeFeatured, site as config, taxonomiesOf, taxonomyLabel, typeDef } from '../lib/site';
import { NO_CONTENT_WARNING, chosenTemplate, defaultTaxonomyTemplates, defaultTemplates, templateLabel, type TemplateInfo, type TemplateMap } from '../lib/templates';
import { FieldGroup, MediaPicker, Row, Select, Text, Toggle, inputClass } from './fields';
import { NETWORKS } from '../lib/social/icons';
import Redirects, { type NotFound } from '../admin/Redirects';
import TypesEditor from '../admin/TypesEditor';
import Sync from '../admin/Sync';
import Connections from '../admin/Connections';
import BackupsTab from '../admin/Backups';
import TicketSettingsPanel from '../admin/TicketSettings';
import MemberSettingsPanel from '../admin/MemberSettings';
import MailingSettingsPanel, { type MailgunInfo } from '../admin/MailingSettings';
import { mailingOn, type MailList, type MailingSettings } from '../lib/mailing/config';
import type { MemberSettings } from '../lib/members/config';
import { eventsOn, showsTaxonomy, showsType } from '../lib/events/on';
import type { TicketSettings } from '../lib/tickets/config';
import type { Redirect } from '../lib/redirects';
import { MENU_FIELDS } from '../lib/navigation';
import type { TaxonomyMeta } from '../lib/page-meta';
import { ADMIN_THEME_DEFAULTS, ADMIN_THEME_FIELDS, adminThemeVars, contrast, type AdminTheme } from '../lib/admin-theme';

interface Props {
  /** The section the address names. */
  section: string;
  site: { name?: string; description?: string; front_page_id?: number | null; not_found_page_id?: number | null; timezone?: string; search_types?: string[]; social?: { network: string; url: string }[]; share_image?: number; share_image_url?: string; templates?: TemplateMap; taxonomy_templates?: Record<string, string>; taxonomy_pages_off?: string[]; taxonomy_meta?: Record<string, TaxonomyMeta>; listing_meta?: Record<string, TaxonomyMeta>; listings_off?: string[]; featured_types?: string[]; icons?: Record<string, string>; icon_media_id?: number | null; icon_preview?: string; admin_theme?: AdminTheme; tickets?: TicketSettings; members?: Partial<MemberSettings>; mailing?: MailingSettings; events?: { enabled?: boolean }; a11y?: { block_publish?: boolean } };
  options: Record<string, any>;
  pages: { id: number; title: string }[];
  templates: TemplateInfo[];
  redirects: Redirect[];
  notFound: NotFound[];
  /** Which payment providers have their keys set (for Tickets). */
  ticketProviders: Record<PaymentProvider, ProviderStatus>;
  /** Mailgun's keys (for Mailing) and the mailing lists. */
  mailgun: MailgunInfo;
  mailLists: MailList[];
}

/** The template pickers' value for "Off" (no listing page, no term pages). */
const OFF = '__off__';

/** Every IANA timezone the browser knows. */
const TIMEZONES: string[] = (Intl as any).supportedValuesOf?.('timeZone') ?? [config.timezone];

export default function SiteSettings({ section, site: initialSite, options: initialOptions, pages, templates, redirects, notFound, ticketProviders, mailgun, mailLists }: Props) {
  const [site, setSite] = useState(initialSite);
  const [options, setOptions] = useState(initialOptions);
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState(section);
  const [saved, setSaved] = useState(() => JSON.stringify({ site: initialSite, options: initialOptions }));
  const dirty = JSON.stringify({ site, options }) !== saved;
  // A link from before sections had addresses (/admin/settings/#tickets) goes to the section's; Back
  // and Forward move between sections.
  useEffect(() => {
    const id = sectionOf(location.pathname, location.hash);
    if (location.hash && id) {
      setTab(id);
      history.replaceState(null, '', settingsPath(id));
    }
    const onPop = () => setTab(sectionOf(location.pathname, location.hash) || 'general');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (dirty && status.startsWith('Saved')) setStatus('');
  }, [dirty]);
  // The admin colors as they are picked, on this page (the saved ones load with every admin page).
  useEffect(() => {
    const vars = { ...ADMIN_THEME_DEFAULTS, ...adminThemeVars(site.admin_theme) };
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  }, [site.admin_theme]);
  // The logo as it is picked, in the menu bar (as Admin.astro renders it).
  useEffect(() => {
    const brand = document.getElementById('admin-brand');
    if (!brand) return;
    const t = site.admin_theme;
    const parts: HTMLElement[] = [];
    if (t?.logo_url) {
      const img = document.createElement('img');
      Object.assign(img, { src: t.logo_url, alt: t.logo_name ? '' : config.name, className: 'block h-8 w-auto max-w-[120px] object-contain sm:max-w-[180px]' });
      parts.push(img);
    }
    if (!t?.logo_url || t.logo_name) {
      const name = document.createElement('span');
      name.textContent = config.name;
      if (t?.logo_url) name.className = 'max-sm:hidden';
      parts.push(name);
    }
    brand.replaceChildren(...parts);
  }, [site.admin_theme?.logo_url, site.admin_theme?.logo_name]);
  const save = async () => {
    // Types whose pages would lose their own content with the template chosen for them.
    const lacking = Object.entries(site.templates ?? {})
      .filter(([, m]) => m.single && templates.some((t) => t.slug === m.single && !t.content))
      .map(([type]) => typeDef(type)?.label ?? type);
    if (lacking.length && !window.confirm(`${lacking.join(', ')}: the template chosen has no Page content block, so their own content won't show on the site. Save anyway?`)) return;
    setStatus('Saving…');
    const res = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site, options }) });
    if (!res.ok) return setStatus(`Save failed: ${await res.text()}`);
    const { moved } = await res.json();
    setSaved(JSON.stringify({ site, options }));
    setStatus(`Saved ${new Date().toLocaleTimeString()}${moved ? `; ${moved} event${moved === 1 ? '' : 's'} moved to the new timezone` : ''}`);
  };
  const tabs: { id: string; label: string; panel: ReactNode; on?: boolean }[] = [
    {
      id: 'general',
      label: 'General',
      panel: (
        <>
        <Text title="Site name" value={site.name} onChange={(v) => setSite({ ...site, name: v })} />
        <Text title="Tagline" value={site.description} onChange={(v) => setSite({ ...site, description: v })} />
        <Select title="Front page" value={site.front_page_id ? String(site.front_page_id) : ''} options={pages.map((p) => [String(p.id), p.title])} onChange={(v) => setSite({ ...site, front_page_id: v ? Number(v) : null })} />
        <Select title="Not found page" value={site.not_found_page_id ? String(site.not_found_page_id) : ''} options={pages.map((p) => [String(p.id), p.title])} onChange={(v) => setSite({ ...site, not_found_page_id: v ? Number(v) : null })} />
        <p className="-mt-2 mb-4 text-xs text-admin-muted">Shown when an address has nothing there (with no redirect for it). Without one, the 404 template is shown.</p>
        </>
      ),
    },
    {
      id: 'types',
      label: 'Types',
      panel: (
        <>
          <TypesEditor events={eventsOn(site)} />
          <TypeTemplates events={eventsOn(site)} value={site.templates ?? {}} off={site.listings_off ?? []} templates={templates} meta={site.listing_meta ?? {}} onChange={(m) => setSite((s) => ({ ...s, templates: m }))} onListings={(off) => setSite((s) => ({ ...s, listings_off: off }))} onMeta={(m) => setSite((s) => ({ ...s, listing_meta: Object.keys(m).length ? m : undefined }))} />
          <FeaturedTypes events={eventsOn(site)} value={site.featured_types ?? []} onChange={(v) => setSite((s) => ({ ...s, featured_types: v.length ? v : undefined }))} />
          <TaxonomyTemplatesPanel events={eventsOn(site)} value={site.taxonomy_templates ?? {}} off={site.taxonomy_pages_off ?? []} templates={templates} meta={site.taxonomy_meta ?? {}} onChange={(m) => setSite((s) => ({ ...s, taxonomy_templates: Object.keys(m).length ? m : undefined }))} onPages={(off) => setSite((s) => ({ ...s, taxonomy_pages_off: off.length ? off : undefined }))} onMeta={(m) => setSite((s) => ({ ...s, taxonomy_meta: Object.keys(m).length ? m : undefined }))} />
        </>
      ),
    },
    {
      id: 'search',
      label: 'Search',
      panel: (
        <>
        <p className="mb-3 text-xs text-admin-muted">What site search and its live results cover.</p>
        {SEARCHABLE_TYPES.filter((type) => showsType(type, eventsOn(site))).map((type) => {
          const chosen = site.search_types ?? SEARCHABLE_TYPES;
          const on = chosen.includes(type);
          return (
            <Toggle
              key={type}
              title={typeDef(type)?.label ?? type}
              value={on}
              onChange={(v) => {
                const next = v ? SEARCHABLE_TYPES.filter((t) => t === type || chosen.includes(t)) : chosen.filter((t) => t !== type);
                if (!next.length) return setStatus('Search needs at least one type.');
                setSite({ ...site, search_types: next });
              }}
            />
          );
        })}
        </>
      ),
    },
    {
      id: 'social',
      label: 'Social',
      panel: (
        <>
        <p className="mb-3 text-xs text-admin-muted">Profiles shown by the Social links block and listed for search engines.</p>
        {(site.social ?? []).map((l, i, all) => {
          const update = (patch: Partial<{ network: string; url: string }>) => setSite({ ...site, social: all.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
          const move = (d: number) => {
            const next = [...all];
            [next[i], next[i + d]] = [next[i + d], next[i]];
            setSite({ ...site, social: next });
          };
          return (
            <div key={i} className="mb-3 rounded border border-admin-ink/10 bg-white p-2">
              <div className="mb-1 flex gap-2">
                <select aria-label="Network" className={inputClass} value={l.network} onChange={(e) => update({ network: e.target.value })}>
                  {Object.entries(NETWORKS).map(([k, n]) => (
                    <option key={k} value={k}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </div>
              <input aria-label={`${NETWORKS[l.network]?.label ?? 'Link'} address`} className={inputClass} value={l.url} placeholder={l.network === 'email' ? 'mailto:info@example.org' : 'https://'} onChange={(e) => update({ url: e.target.value })} />
              {l.url && !/^(https?:\/\/|mailto:)/i.test(l.url.trim()) && <p className="mt-1 text-xs text-[#b3261e]">Start with https:// (or mailto: for email).</p>}
              <div className="mt-1 flex gap-3 text-xs">
                <button type="button" disabled={i === 0} className="disabled:opacity-30" onClick={() => move(-1)}>Up</button>
                <button type="button" disabled={i === all.length - 1} className="disabled:opacity-30" onClick={() => move(1)}>Down</button>
                <button type="button" className="text-[#b3261e]" onClick={() => setSite({ ...site, social: all.filter((_, k) => k !== i) })}>Remove</button>
              </div>
            </div>
          );
        })}
        <button type="button" className="mb-4 rounded-sm border border-dashed border-admin-ink/25 px-3 py-1.5 text-xs text-admin-muted hover:border-admin-ink/50" onClick={() => setSite({ ...site, social: [...(site.social ?? []), { network: 'facebook', url: '' }] })}>
          Add link
        </button>
        <MediaPicker title="Site icon (favicon)" url={site.icon_preview ?? site.icons?.['192']} onSelect={(m) => setSite({ ...site, icon_media_id: m.id ?? m.mediaId ?? null, icon_preview: m.url })} />
        <p className="-mt-2 mb-3 text-xs text-admin-muted">A square image at least 512px wide works best (it's cropped square around its focal point). Shown in browser tabs, on phone home screens and in the site header; made into the icon files when you save.</p>
        {(site.icon_media_id || site.icons?.['192']) && (
          <button type="button" className="mb-4 block text-xs text-[#b3261e]" onClick={() => setSite({ ...site, icon_media_id: null, icon_preview: undefined, icons: undefined })}>
            Remove site icon
          </button>
        )}
        <MediaPicker title="Default share image" url={site.share_image_url} onSelect={(m) => setSite({ ...site, share_image: m.id ?? m.mediaId ?? undefined, share_image_url: m.url })} />
        <p className="-mt-2 mb-3 text-xs text-admin-muted">Shown when a page without its own image is shared.</p>
        {!!site.share_image && (
          <button type="button" className="mb-3 block text-xs text-[#b3261e]" onClick={() => setSite({ ...site, share_image: undefined, share_image_url: undefined })}>
            Remove default share image
          </button>
        )}
        </>
      ),
    },
    {
      id: 'menu',
      label: 'Menu',
      panel: (
        <>
          <p className="mb-3 text-xs text-admin-muted">The Navigation block's items. An item with links, an intro or cards opens a panel; cards are the entries you pick, or the latest of a type (upcoming, for events).</p>
          <FieldsForm defs={MENU_FIELDS} value={options} onChange={setOptions} />
        </>
      ),
    },
    // Events, an optional feature (src/lib/events/on.ts); its tickets while on.
    {
      id: 'events',
      label: 'Events',
      on: eventsOn(site),
      panel: (
        <>
          <Toggle title="Events on" value={eventsOn(site)} onChange={(on) => setSite((s) => ({ ...s, events: { enabled: on } }))} />
          <p className="text-xs text-admin-muted">
            {eventsOn(site)
              ? 'Events and venues under Content, event pages, the calendar (/events/), event categories, calendar feeds, ticket sales and the event and ticket blocks.'
              : 'Turn on to add events and venues under Content, event pages, a calendar (/events/), event categories, calendar feeds, tickets and the event and ticket blocks. Turning it off later deletes nothing: events are hidden until it is on again.'}
          </p>
          <Select
            title="Default time zone"
            value={site.timezone ?? ''}
            options={TIMEZONES.map((t) => [t, t.replace(/_/g, ' ')] as [string, string])}
            onChange={(v) => setSite({ ...site, timezone: v || undefined })}
          />
          <p className="-mt-2 mb-3 text-xs text-admin-muted">
            Empty: {config.timezone.replace(/_/g, ' ')}. New events use it, and the calendar, feeds and the site's dates show times in it; an event can have its own. Events on the old time zone keep their local times when it changes.
          </p>
        </>
      ),
    },
    ...(eventsOn(site)
      ? [{ id: 'tickets', label: 'Tickets', panel: <TicketSettingsPanel value={site.tickets ?? {}} providers={ticketProviders} onChange={(tickets) => setSite((s) => ({ ...s, tickets }))} /> }]
      : []),
    {
      id: 'members',
      label: 'Members',
      on: !!site.members?.enabled,
      panel: <MemberSettingsPanel value={site.members ?? {}} onChange={(members) => setSite((s) => ({ ...s, members }))} />,
    },
    {
      id: 'mailing-lists',
      label: 'Mailing Lists',
      on: mailingOn(site),
      panel: <MailingSettingsPanel value={site.mailing ?? {}} mailgun={mailgun} lists={mailLists} membersOn={!!site.members?.enabled} onChange={(mailing) => setSite((s) => ({ ...s, mailing }))} />,
    },
    {
      id: 'accessibility',
      label: 'Accessibility',
      panel: (
        <>
          <Toggle title="Check accessibility before publishing" value={site.a11y?.block_publish} onChange={(on) => setSite((s) => ({ ...s, a11y: { block_publish: on } }))} />
          <p className="text-xs text-admin-muted">
            Publish and Publish changes first run the editor's accessibility check on the page, for every type with a page, and publish only when nothing is left open: each problem fixed, or marked as checked by someone who looked. Otherwise the editor offers to show the problems, or to publish anyway with a reason, which Revisions keeps with that version. Bulk Publish in the content list then skips those entries, since the check runs in the editor. Templates and their Save &amp; apply aren't held.
          </p>
        </>
      ),
    },
    {
      id: 'appearance',
      label: 'Appearance',
      panel: <AdminThemePanel value={site.admin_theme ?? {}} onChange={(t) => setSite((s) => ({ ...s, admin_theme: Object.keys(t).length ? t : undefined }))} />,
    },
    // Mounted only while shown: it reads (and decrypts) the saved keys as it opens.
    { id: 'connections', label: 'Connections', panel: tab === 'connections' ? <Connections /> : null },
    { id: 'redirects', label: 'Redirects', panel: <Redirects initial={redirects} notFound={notFound} /> },
    { id: 'sync', label: 'Sync', panel: <Sync /> },
    { id: 'backups', label: 'Backups', panel: <BackupsTab /> },
    ...(SITE_EDITOR.settingsFields?.length
      ? [{ id: 'site', label: SITE_EDITOR.settingsTitle ?? 'Site options', panel: <FieldsForm defs={SITE_EDITOR.settingsFields} value={options} onChange={setOptions} /> }]
      : []),
  ];
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const groups = SETTINGS_GROUPS.map((g) => ({ label: g.label, sections: g.sections.flatMap((x) => tabs.filter((t) => t.id === x.id)) })).filter((g) => g.sections.length);
  const heading = useRef<HTMLHeadingElement>(null);
  const choose = (id: string) => {
    if (id === current.id) return;
    setTab(id);
    history.pushState(null, '', settingsPath(id));
    heading.current?.focus();
  };
  // Links work as links (a new tab, a copied address); a plain click moves in place.
  const follow = (e: MouseEvent, id: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    choose(id);
  };
  const mark = (on?: boolean) => (on === undefined ? null : <span className={`ml-auto rounded px-1.5 text-[10px] font-semibold uppercase tracking-wider ${on ? 'bg-admin-accent/15 text-admin-accent' : 'text-admin-muted'}`}>{on ? 'On' : 'Off'}</span>);

  return (
    <div className="md:flex md:items-start md:gap-8">
      <label className="mb-6 block md:hidden">
        <span className="mb-1 block text-xs font-medium text-admin-muted">Section</span>
        <select className={inputClass} value={current.id} onChange={(e) => choose(e.target.value)}>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.sections.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {t.on === undefined ? '' : t.on ? ' (on)' : ' (off)'}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <nav aria-label="Settings" className="sticky top-4 hidden w-48 shrink-0 md:block">
        {groups.map((g) => (
          <div key={g.label} className="mb-5">
            <h2 className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-admin-muted uppercase">{g.label}</h2>
            <ul className="m-0 list-none p-0">
              {g.sections.map((t) => {
                const selected = t.id === current.id;
                return (
                  <li key={t.id}>
                    <a
                      href={settingsPath(t.id)}
                      aria-current={selected ? 'page' : undefined}
                      onClick={(e) => follow(e, t.id)}
                      className={`flex items-center gap-2 rounded-sm border-l-2 px-3 py-1.5 text-sm ${selected ? 'border-admin-accent bg-white font-medium text-admin-ink' : 'border-transparent text-admin-muted hover:text-admin-ink'}`}
                    >
                      {t.label}
                      {mark(t.on)}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <div className="mb-6 flex min-h-10 flex-wrap items-center justify-between gap-3 border-b border-admin-ink/10 pb-3">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-normal outline-none">
            {current.label}
          </h2>
          <div className="flex items-center gap-3">
            <p className="text-xs text-admin-muted" role="status">
              {status || (dirty ? (SAVES_AS_IT_GOES.has(current.id) ? 'Unsaved changes in other sections' : 'Unsaved changes') : '')}
            </p>
            {/* One Save for every section's form, shown while there is something to save. */}
            {dirty && (
              <button type="button" onClick={save} className="rounded-sm bg-admin-ink px-4 py-2 text-xs font-semibold tracking-wider text-white uppercase hover:bg-admin-accent">
                Save settings
              </button>
            )}
          </div>
        </div>
        {tabs.map((t) => (
          <section key={t.id} aria-label={t.label} hidden={t.id !== current.id} className={['redirects', 'sync', 'backups'].includes(t.id) ? 'max-w-5xl' : t.id === 'site' || t.id === 'types' || t.id === 'tickets' || t.id === 'connections' ? 'max-w-3xl' : 'max-w-md'}>
            {t.panel}
          </section>
        ))}
      </div>
    </div>
  );
}

/** Types with pages of their own, and the template for their entries and their listing page. */
function TypeTemplates({ events, value, off, templates, meta, onChange, onListings, onMeta }: { events: boolean; value: TemplateMap; off: string[]; templates: TemplateInfo[]; meta: Record<string, TaxonomyMeta>; onChange: (m: TemplateMap) => void; onListings: (off: string[]) => void; onMeta: (m: Record<string, TaxonomyMeta>) => void }) {
  const have = new Set(templates.map((t) => t.slug));
  const types = CONTENT_TYPES.filter((t) => !PAGELESS_TYPES.has(t.type) && showsType(t.type, events));
  const setMeta = (type: string, m: TaxonomyMeta) => {
    const next = { ...meta };
    if (m.image || (m.seo && Object.keys(m.seo).length)) next[type] = m;
    else delete next[type];
    onMeta(next);
  };
  const set = (type: string, kind: 'single' | 'archive', slug: string) => {
    const next: TemplateMap = { ...value, [type]: { ...value[type], [kind]: slug || undefined } };
    if (!next[type].single && !next[type].archive) delete next[type];
    onChange(next);
  };
  /** A template picker; for a listing (`listing` set), its last option turns the listing off. */
  const pick = (type: string, kind: 'single' | 'archive', listing?: { off: boolean; setOff: (off: boolean) => void; note: ReactNode; extra?: ReactNode }) => {
    const chosen = chosenTemplate(value, type, kind);
    const fallback = defaultTemplates(type, kind).find((s) => have.has(s));
    const shown = chosen && have.has(chosen) ? chosen : fallback;
    const lacking = kind === 'single' && chosen && templates.some((t) => t.slug === chosen && !t.content);
    return (
      <>
      <div className="flex items-center gap-2">
        <select
          aria-label={`${typeDef(type)?.label ?? type}: ${kind === 'single' ? 'page' : 'listing'} template`}
          className={inputClass}
          value={listing?.off ? OFF : (chosen ?? '')}
          onChange={(e) => {
            if (listing && e.target.value === OFF) return listing.setOff(true);
            if (listing?.off) listing.setOff(false);
            set(type, kind, e.target.value);
          }}
        >
          <option value="">Default{fallback ? ` (${fallback})` : ''}</option>
          {templates.map((t) => (
            <option key={t.slug} value={t.slug}>
              {templateLabel(t)}
            </option>
          ))}
          {listing && <option value={OFF}>Off: no listing page</option>}
        </select>
        {shown && !listing?.off && (
          <a className="shrink-0 text-xs text-admin-accent hover:underline" href={`/admin/templates/template/${shown}/`}>
            Edit
          </a>
        )}
        {!listing?.off && listing?.extra}
      </div>
      {lacking && <p className="mt-1 text-xs text-[#b3261e]">{NO_CONTENT_WARNING}</p>}
      {listing && <p className="mt-1 text-xs text-admin-muted">{listing.note}</p>}
      </>
    );
  };
  return (
    <>
      <p className="mb-4 text-xs text-admin-muted">The template for each type's pages and for its listing page; choose Off to turn a listing page off. A template chosen on an entry itself (in its settings) comes first. Under each type, its taxonomies (each gets a picker in an entry's settings; add more under Content &gt; Taxonomies).</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-admin-muted">
            <th className="pb-2 font-medium">Type</th>
            <th className="pb-2 font-medium">Pages</th>
            <th className="pb-2 font-medium">Listing page</th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <Fragment key={t.type}>
            <tr className="border-t border-admin-ink/10 align-top">
              <th scope="row" className="py-3 pr-4 text-left font-medium">
                {t.label}
                <span className="block text-xs font-normal text-admin-muted">{TYPE_BASES[t.type] ? `/${TYPE_BASES[t.type]}/<slug>/` : '/<slug>/'}</span>
                <span className="block text-xs font-normal text-admin-muted">{[...taxonomiesOf(t.type).map(taxonomyLabel), ...(t.type !== 'global' ? ['Tags'] : [])].join(', ') || 'No taxonomies'}</span>
              </th>
              <td className="py-3 pr-4">{pick(t.type, 'single')}</td>
              <td className="py-3">
                {ARCHIVE_PATHS[t.type] ? (
                  pick(t.type, 'archive', {
                    off: off.includes(t.type),
                    setOff: (on) => onListings(on ? [...off, t.type] : off.filter((x) => x !== t.type)),
                    note: off.includes(t.type)
                      ? `Off: ${ARCHIVE_PATHS[t.type]} shows a page with that address, if there is one, or Not found.${t.type === 'event' ? ' The calendar views (month, day, past) are off too.' : ''}`
                      : `At ${ARCHIVE_PATHS[t.type]}`,
                    extra: <PageDefaults kind="listing" name={t.type} label={t.label} path={ARCHIVE_PATHS[t.type]} value={meta[t.type] ?? {}} onChange={(m) => setMeta(t.type, m)} />,
                  })
                ) : (
                  <span className="text-xs text-admin-muted">No listing page</span>
                )}
              </td>
            </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * Featured image and SEO for pages that aren't entries: a taxonomy's defaults for its term pages ({term}:
 * the term's name), or a type's listing page. A "SEO" button beside the template's Edit opens it in a
 * dialog; its changes are part of the form, saved with Save settings.
 */
function PageDefaults({ kind, name, label, path, value, onChange }: { kind: 'taxonomy' | 'listing'; name: string; label: string; path?: string; value: TaxonomyMeta; onChange: (m: TaxonomyMeta) => void }) {
  const [writing, setWriting] = useState('');
  // Fill the title and description patterns from Claude, for review before Save settings.
  const write = async () => {
    setWriting('Writing…');
    const res = await fetch('/api/admin/meta-compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'taxonomy' ? { taxonomy: name } : { type: name }) });
    if (!res.ok) return setWriting(`Not written: ${await res.text()}`);
    const out = await res.json();
    setSeo({ ...(out.title ? { title: out.title } : {}), ...(out.description ? { description: out.description } : {}) });
    setWriting('Filled in by Claude: check it, then Done and Save settings.');
  };
  const seo = value.seo ?? {};
  const dialog = useRef<HTMLDialogElement>(null);
  const set = !!(value.image || value.seo);
  const what = kind === 'taxonomy' ? `${label} term pages` : `${label} listing page`;
  const setSeo = (patch: Record<string, unknown>) => {
    const next: Record<string, any> = { ...seo, ...patch };
    for (const k of Object.keys(next)) if (next[k] === '' || next[k] === false || next[k] === undefined) delete next[k];
    onChange({ ...value, seo: Object.keys(next).length ? next : undefined });
  };
  return (
    <>
    <button type="button" className="shrink-0 text-xs text-admin-accent hover:underline" aria-label={`${what}: featured image and SEO`} onClick={() => dialog.current?.showModal()}>
      SEO{set && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-admin-accent align-middle" aria-label="(set)" />}
    </button>
    <dialog ref={dialog} aria-labelledby={`meta-${kind}-${name}`} className="m-auto max-h-[90vh] w-[min(36rem,95vw)] rounded-sm p-0 shadow-xl backdrop:bg-black/40">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-admin-ink/10 bg-white px-5 py-3">
        <h2 id={`meta-${kind}-${name}`} className="text-base font-semibold">
          {what}: featured image and SEO
        </h2>
        <button type="button" onClick={() => dialog.current?.close()} className="shrink-0 rounded-sm bg-admin-ink px-3 py-1 text-xs font-semibold tracking-wider text-white uppercase hover:bg-admin-accent">
          Done
        </button>
      </div>
      <div className="p-5">
      {kind === 'taxonomy' ? (
        <p className="mb-3 text-xs text-admin-muted">Defaults for {label.toLowerCase()} term pages; a term's own (Content &gt; Taxonomies, Details) come first, and for the meta description, so does the term's description. In the title and description, {'{term}'} is replaced by the term's name.</p>
      ) : (
        <p className="mb-3 text-xs text-admin-muted">For the {label.toLowerCase()} listing at {path}. The image is its share image and shows in a Featured image block on it (outside a collection).{name === 'event' ? ' The calendar views (month, day, past) keep their own titles and get the image and noindex.' : ''}</p>
      )}
      <MediaPicker title="Featured image" url={value.image_url} onSelect={(m) => onChange({ ...value, image: m.id ?? m.mediaId ?? undefined, image_url: m.url })} />
      {!!value.image && (
        <button type="button" className="-mt-2 mb-2 text-xs text-[#b3261e]" onClick={() => onChange({ ...value, image: undefined, image_url: undefined })}>
          Remove featured image
        </button>
      )}
      <Text title="Search title" value={seo.title ?? ''} placeholder={kind === 'taxonomy' ? "{term} – the term's name when empty" : label} onChange={(v) => setSeo({ title: v })} />
      <Row title="Meta description">
        <textarea className={inputClass} rows={3} value={seo.description ?? ''} placeholder={kind === 'taxonomy' ? 'For terms without a description' : "The site's tagline when empty"} onChange={(e) => setSeo({ description: e.target.value })} />
      </Row>
      <div className="mb-3 flex items-center gap-3">
        <button type="button" onClick={write} className="rounded-sm border border-admin-ink/20 bg-white px-3 py-1.5 text-xs font-semibold hover:border-admin-ink/50">
          Compose
        </button>
        {writing && (
          <span className="text-xs text-admin-muted" role="status">
            {writing}
          </span>
        )}
      </div>
      <Toggle title={kind === 'taxonomy' ? 'Hide its term pages from search engines (noindex)' : 'Hide from search engines (noindex)'} value={!!seo.noindex} onChange={(v) => setSeo({ noindex: v })} />
      <p className="mt-3 text-xs text-admin-muted">Changes are saved with Save settings.</p>
      </div>
    </dialog>
    </>
  );
}

/** Settings > Types: the template for each taxonomy's term pages (a term can choose its own), and their default image and SEO. */
/** The types whose entries can be marked Featured (settings.site.featured_types): a Featured switch in their
 *  settings, which the Collection and Map blocks can list alone. Types whose code has one keep theirs. */
function FeaturedTypes({ events, value, onChange }: { events: boolean; value: string[]; onChange: (v: string[]) => void }) {
  const types = CONTENT_TYPES.filter((t) => t.type !== 'global' && showsType(t.type, events));
  return (
    <section className="mt-8 border-t border-admin-ink/10 pt-6">
      <h3 className="text-sm font-semibold">Featured</h3>
      <p className="mt-1 mb-3 text-xs text-admin-muted">Tick a type to give its entries a Featured switch in their settings. A Collection block can then show featured entries only, and the content list can show and mark them.</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {types.map((t) =>
          codeFeatured(t.type) ? (
            <label key={t.type} className="flex items-center gap-1.5 text-admin-muted" title="Set by the site's code">
              <input type="checkbox" checked disabled /> {t.label}
            </label>
          ) : (
            <label key={t.type} className="flex items-center gap-1.5">
              <input type="checkbox" checked={value.includes(t.type)} onChange={(e) => onChange(e.target.checked ? [...value, t.type] : value.filter((x) => x !== t.type))} /> {t.label}
            </label>
          ),
        )}
      </div>
    </section>
  );
}

function TaxonomyTemplatesPanel({ events, value, off, templates, meta, onChange, onPages, onMeta }: { events: boolean; value: Record<string, string>; off: string[]; templates: TemplateInfo[]; meta: Record<string, TaxonomyMeta>; onChange: (m: Record<string, string>) => void; onPages: (off: string[]) => void; onMeta: (m: Record<string, TaxonomyMeta>) => void }) {
  const have = new Set(templates.map((t) => t.slug));
  const taxonomies = config.taxonomies.filter((t) => t.base && showsTaxonomy(t.name, events));
  return (
    <>
      <h3 className="mt-8 mb-1 text-sm font-semibold">Taxonomy pages</h3>
      <p className="mb-3 text-xs text-admin-muted">The template for each taxonomy's term pages; choose Off to turn them off. A term can choose its own template under Content &gt; Taxonomies, and the terms under it share it. With the pages off, terms still group and filter entries, shown without links.</p>
      <table className="w-full text-sm">
        <tbody>
          {taxonomies.map((t) => {
            const fallback = defaultTaxonomyTemplates(t.name).find((s) => have.has(s));
            const chosen = value[t.name];
            const shown = chosen && have.has(chosen) ? chosen : fallback;
            return (
              <Fragment key={t.name}>
              <tr className="border-t border-admin-ink/10 align-top">
                <th scope="row" className="py-3 pr-4 text-left font-medium">
                  {t.label}
                  <span className="block text-xs font-normal text-admin-muted">/{t.base}/&lt;slug&gt;/</span>
                </th>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <select aria-label={`${t.label}: term page template`} className={inputClass} value={off.includes(t.name) ? OFF : (chosen ?? '')} onChange={(e) => {
                      if (e.target.value === OFF) return onPages([...off, t.name]);
                      if (off.includes(t.name)) onPages(off.filter((x) => x !== t.name));
                      const next = { ...value };
                      if (e.target.value) next[t.name] = e.target.value;
                      else delete next[t.name];
                      onChange(next);
                    }}>
                      <option value="">Default{fallback ? ` (${fallback})` : ''}</option>
                      {templates.map((tp) => (
                        <option key={tp.slug} value={tp.slug}>
                          {templateLabel(tp)}
                        </option>
                      ))}
                      <option value={OFF}>Off: no term pages</option>
                    </select>
                    {shown && !off.includes(t.name) && (
                      <a className="shrink-0 text-xs text-admin-accent hover:underline" href={`/admin/templates/template/${shown}/`}>
                        Edit
                      </a>
                    )}
                    {!off.includes(t.name) && (
                      <PageDefaults kind="taxonomy" name={t.name} label={t.label} value={meta[t.name] ?? {}} onChange={(m) => {
                        const next = { ...meta };
                        if (m.image || (m.seo && Object.keys(m.seo).length)) next[t.name] = m;
                        else delete next[t.name];
                        onMeta(next);
                      }} />
                    )}
                  </div>
                  <p className="mt-1 text-xs text-admin-muted">{off.includes(t.name) ? 'Off: those addresses show a page with that address, if there is one, or Not found; terms still group and filter entries, shown without links.' : `At /${t.base}/<slug>/`}</p>
                </td>
              </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/** The admin's logo, and its colors: one picker each, with a warning when text on it would be hard to read. */
function AdminThemePanel({ value, onChange }: { value: AdminTheme; onChange: (t: AdminTheme) => void }) {
  const { logo: _logo, logo_url: _url, logo_name: _name, ...colors } = value;
  return (
    <>
      <p className="mb-3 text-xs text-admin-muted">The logo and colors of these admin screens and the page editor, for everyone who signs in. They change here as you pick them; Save keeps them.</p>
      <MediaPicker title="Logo" fit="contain" url={value.logo_url} onSelect={(m) => onChange({ ...value, logo: m.id ?? m.mediaId ?? undefined, logo_url: m.url })} />
      <p className="-mt-2 mb-3 text-xs text-admin-muted">In the menu bar, in place of the site name, up to 32px tall. Choose one that reads on the menu bar's color.</p>
      {!!value.logo && (
        <>
          <Toggle title="Show the site name beside it" value={!!value.logo_name} onChange={(v) => onChange({ ...value, logo_name: v || undefined })} />
          <button type="button" className="mb-4 block text-xs text-[#b3261e]" onClick={() => onChange(colors)}>
            Remove logo
          </button>
        </>
      )}
      {ADMIN_THEME_FIELDS.map((f) => {
        const color = value[f.key] ?? f.default;
        const set = (c: string | undefined) => {
          const next = { ...value };
          if (c && c !== f.default) next[f.key] = c;
          else delete next[f.key];
          onChange(next);
        };
        return (
          <FieldGroup key={f.key} title={f.label}>
            <div className="flex items-center gap-2">
              <input type="color" aria-label={f.label} value={color} onChange={(e) => set(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-admin-ink/15" />
              <input aria-label={`${f.label} (hex)`} className="w-28 rounded border border-admin-ink/15 bg-white px-2 py-1.5 font-mono text-sm outline-none focus:border-admin-accent" defaultValue={color} key={color} onBlur={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value.trim()) && set(e.target.value.trim().toLowerCase())} />
              {value[f.key] && (
                <button type="button" className="text-xs text-admin-muted hover:text-admin-accent" onClick={() => set(undefined)}>
                  Default
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-admin-muted">{f.help}</p>
            {(f.key === 'accent' || f.key === 'ink') && contrast(color, '#ffffff') < 4.5 && <p className="mt-1 text-xs text-[#b3261e]">White text on this color is hard to read; choose a darker one.</p>}
            {f.key === 'bg' && contrast(color, value.ink ?? '#1a1a2e') < 7 && <p className="mt-1 text-xs text-[#b3261e]">Text on this background is hard to read; choose a lighter one or a darker text color.</p>}
          </FieldGroup>
        );
      })}
    </>
  );
}
