// Popups (Settings > Popups, admins; settings.site.popups): a template part shown over the site's pages
// as a dialog, a bar or a corner box, on load, after a delay, at a depth of scrolling or as the visitor
// goes to leave, as often as set, on all pages or some. One popup can be the cookie consent banner: it
// gets Accept and Reject buttons, shows until the visitor chooses and can be opened again from any
// link to #cookie-settings. The choice (cookie `site_consent`: all or necessary) lets the Stats visitor
// cookie and the code snippets marked for it run. public/assets/js/popups.js shows them; pages stay
// cached for everyone. Safe in the browser.

export const POPUP_LAYOUTS = [
  { value: 'modal', label: 'Dialog in the middle' },
  { value: 'bar-bottom', label: 'Bar along the bottom' },
  { value: 'bar-top', label: 'Bar along the top' },
  { value: 'corner', label: 'Box in the corner' },
] as const;
export const POPUP_TRIGGERS = [
  { value: 'load', label: 'When the page opens' },
  { value: 'delay', label: 'After some seconds' },
  { value: 'scroll', label: 'After scrolling part of the page' },
  { value: 'exit', label: 'When the visitor goes to leave' },
] as const;
export const POPUP_FREQUENCIES = [
  { value: 'always', label: 'On every page' },
  { value: 'session', label: 'Once a visit' },
  { value: 'days', label: 'Once, then again after some days' },
] as const;

export type PopupLayout = (typeof POPUP_LAYOUTS)[number]['value'];
export type PopupTrigger = (typeof POPUP_TRIGGERS)[number]['value'];
export type PopupFrequency = (typeof POPUP_FREQUENCIES)[number]['value'];

export interface Popup {
  /** Stable id (letters, digits, -), kept in visitors' browsers to remember a closed popup. */
  id: string;
  name: string;
  enabled?: boolean;
  /** The template part shown. */
  part: string;
  layout: PopupLayout;
  trigger: PopupTrigger;
  /** Seconds, for `delay`. */
  delay?: number;
  /** Percent of the page, for `scroll`. */
  scroll?: number;
  frequency: PopupFrequency;
  /** Days before it shows again, for `days`. */
  days?: number;
  /** Which pages: all, only those listed, or all but those listed (`paths`: /path/ or /prefix/*). */
  pages: 'all' | 'only' | 'except';
  paths?: string[];
  /** The cookie consent banner: Accept and Reject buttons, shown until the visitor chooses. */
  consent?: boolean;
  acceptLabel?: string;
  rejectLabel?: string;
  /** A link to the site's privacy or cookie policy, shown beside the buttons. */
  policyUrl?: string;
  policyLabel?: string;
}

/** The consent cookie: `all` (accepted) or `necessary` (rejected). Read by the browser. */
export const CONSENT_COOKIE = 'site_consent';
/** The Stats visitor cookie (a random id), set only when Stats' cookie is on and allowed. */
export const VISITOR_COOKIE = 'site_vid';

const pick = <T extends string>(v: unknown, list: readonly { value: T }[], fallback: T): T => (list.some((x) => x.value === v) ? (v as T) : fallback);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback;
};

/** A path a popup is limited to: /path/ or /prefix/* (no queries, fragments or other sites). */
export const cleanPopupPath = (p: unknown) => {
  const s = text(p, 300);
  return /^\/[^\s?#"<>]*$/.test(s) && !s.startsWith('//') ? s : '';
};

/** The popups posted (known values, at most 20; one consent banner, the first marked), or undefined. */
export function popupsFrom(v: unknown): Popup[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Popup[] = [];
  const ids = new Set<string>();
  let consent = false;
  for (const raw of v.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const part = text(r.part, 200);
    if (!/^[a-z0-9][a-z0-9_/-]*$/.test(part)) continue;
    let id = text(r.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, '') || `p${out.length + 1}`;
    while (ids.has(id)) id = `${id}-${out.length + 1}`;
    ids.add(id);
    const isConsent: boolean = r.consent === true && !consent;
    consent ||= isConsent;
    const pages = (['all', 'only', 'except'] as const).find((x) => x === r.pages) ?? 'all';
    const paths = pages === 'all' ? [] : (Array.isArray(r.paths) ? r.paths : []).map(cleanPopupPath).filter(Boolean).slice(0, 50);
    const p: Popup = {
      id,
      name: text(r.name, 120) || 'Popup',
      enabled: r.enabled === true,
      part,
      layout: pick(r.layout, POPUP_LAYOUTS, isConsent ? 'bar-bottom' : 'modal'),
      trigger: pick(r.trigger, POPUP_TRIGGERS, 'load'),
      frequency: pick(r.frequency, POPUP_FREQUENCIES, 'session'),
      pages,
    };
    if (p.trigger === 'delay') p.delay = num(r.delay, 0, 600, 5);
    if (p.trigger === 'scroll') p.scroll = num(r.scroll, 1, 100, 50);
    if (p.frequency === 'days') p.days = num(r.days, 1, 365, 7);
    if (paths.length) p.paths = paths;
    if (isConsent) {
      p.consent = true;
      p.acceptLabel = text(r.acceptLabel, 60) || 'Accept';
      p.rejectLabel = text(r.rejectLabel, 60) || 'Reject';
      const policy = text(r.policyUrl, 500);
      if (/^(\/|https?:\/\/)/.test(policy)) {
        p.policyUrl = policy;
        p.policyLabel = text(r.policyLabel, 60) || 'Privacy policy';
      }
    }
    out.push(p);
  }
  return out.length ? out : undefined;
}

/** Whether a popup limited to `paths` covers `path` (exact, or under a /prefix/*). */
export const pathMatches = (paths: string[] | undefined, path: string) =>
  (paths ?? []).some((p) => (p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : path === p || path === `${p.replace(/\/$/, '')}/`));

/** The popups that are on and shown at `path`. */
export function popupsFor(popups: Popup[] | undefined, path: string): Popup[] {
  return (popups ?? []).filter((p) => p.enabled && (p.pages === 'all' || (p.pages === 'only' ? pathMatches(p.paths, path) : !pathMatches(p.paths, path))));
}

/** The cookie consent banner that is on, if any (it shows on every page, whatever its pages say). */
export const consentPopup = (popups: Popup[] | undefined) => (popups ?? []).find((p) => p.enabled && p.consent);

/** Stats' own settings (settings.site.stats): `cookies` recognises returning visitors with a cookie. */
export interface StatsSettings {
  cookies?: boolean;
}
export const statsSettingsFrom = (v: unknown): StatsSettings | undefined => (v && typeof v === 'object' && (v as StatsSettings).cookies === true ? { cookies: true } : undefined);

/** A new consent banner's content: a heading and a line, for the editor to change. */
export const CONSENT_STARTER = [
  { type: 'heading', props: { id: 'consent-heading', attrs: { level: 2, content: 'Cookies on this site' } } },
  { type: 'text', props: { id: 'consent-text', attrs: { content: 'We use cookies to understand how the site is used. You can accept them or keep to the cookies the site needs to work.' } } },
];
