// The admin's colors and logo (Settings > Admin, settings.site.admin_theme). Each is a role token from
// src/styles/tailwind.css (--color-admin-*); the admin pages write the chosen ones, and the colors made
// from them, after the stylesheet (AdminTheme.astro), and the settings screen sets them on the page as
// they are picked.
import type { Db } from './db/query';

export interface AdminTheme {
  accent?: string;
  ink?: string;
  bar?: string;
  bg?: string;
  /** The menu bar's logo: a media id, and the URL of a size of it (set by the settings API). */
  logo?: number;
  logo_url?: string;
  /** Show the site name beside the logo. */
  logo_name?: boolean;
}

type ColorKey = 'accent' | 'ink' | 'bar' | 'bg';

/** The colors an admin can pick, with the defaults (tailwind.css) and what each is for. */
export const ADMIN_THEME_FIELDS: { key: ColorKey; label: string; default: string; help: string }[] = [
  { key: 'accent', label: 'Accent', default: '#b87333', help: 'Links, selections, focus and the main buttons on hover; white text sits on it.' },
  { key: 'ink', label: 'Text', default: '#1a1a2e', help: 'Text, borders and the dark buttons; white text sits on it.' },
  { key: 'bar', label: 'Menu bar', default: '#1a1a2e', help: 'The bar along the top; its text turns dark on a light color.' },
  { key: 'bg', label: 'Background', default: '#faf8f5', help: 'Behind the admin pages.' },
];

const HEX = /^#[0-9a-f]{6}$/;

/** The known values of a stored or posted theme (colors as #rrggbb); undefined when none are set. */
export function adminThemeFrom(v: unknown): AdminTheme | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: AdminTheme = {};
  for (const f of ADMIN_THEME_FIELDS) {
    const c = String((v as Record<string, unknown>)[f.key] ?? '').toLowerCase();
    if (HEX.test(c) && c !== f.default) out[f.key] = c;
  }
  const logo = Number((v as AdminTheme).logo);
  const url = (v as AdminTheme).logo_url;
  if (Number.isInteger(logo) && logo > 0 && typeof url === 'string' && url.startsWith('/media/')) {
    Object.assign(out, { logo, logo_url: url.slice(0, 2000) }, (v as AdminTheme).logo_name ? { logo_name: true } : {});
  }
  return Object.keys(out).length ? out : undefined;
}

/** WCAG relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colors. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every --color-admin-* a theme sets: the picked colors and those made from them. Empty for the defaults. */
export function adminThemeVars(theme: AdminTheme | undefined): Record<string, string> {
  const t = adminThemeFrom(theme);
  if (!t) return {};
  const pick = (k: ColorKey) => t[k] ?? ADMIN_THEME_FIELDS.find((f) => f.key === k)!.default;
  const vars: Record<string, string> = {};
  if (t.accent) {
    vars['--color-admin-accent'] = t.accent;
    vars['--color-admin-accent-dark'] = `color-mix(in oklab, ${t.accent} 82%, black)`;
  }
  if (t.ink) vars['--color-admin-ink'] = t.ink;
  if (t.bg || t.ink) {
    vars['--color-admin-bg'] = pick('bg');
    vars['--color-admin-soft'] = `color-mix(in oklab, ${pick('bg')} 96%, ${pick('ink')})`;
  }
  if (t.bar || t.ink) {
    const bar = pick('bar');
    vars['--color-admin-bar'] = bar;
    vars['--color-admin-on-bar'] = contrast(bar, '#ffffff') >= contrast(bar, pick('ink')) ? '#fff' : pick('ink');
  }
  return vars;
}

/** The variables at their defaults (tailwind.css), for the settings screen to undo a preview. */
export const ADMIN_THEME_DEFAULTS: Record<string, string> = {
  '--color-admin-accent': '#b87333',
  '--color-admin-accent-dark': '#9a5f2a',
  '--color-admin-ink': '#1a1a2e',
  '--color-admin-bg': '#faf8f5',
  '--color-admin-soft': '#f5f3f0',
  '--color-admin-bar': '#1a1a2e',
  '--color-admin-on-bar': '#fff',
};

/** A theme's variables as a rule that outranks the stylesheet's :root wherever it lands ('' for the defaults). */
export function adminThemeCss(theme: AdminTheme | undefined): string {
  const vars = Object.entries(adminThemeVars(theme));
  return vars.length ? `html:root{${vars.map(([k, v]) => `${k}:${v}`).join(';')}}` : '';
}

let cached: { at: number; theme: AdminTheme | undefined } | null = null;

/** The saved theme, read at most once a minute per server instance (at once after a save: `force`). */
export async function loadAdminTheme(db: Db, force = false): Promise<AdminTheme | undefined> {
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.theme;
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  cached = { at: Date.now(), theme: adminThemeFrom(data?.value?.admin_theme) };
  return cached.theme;
}
