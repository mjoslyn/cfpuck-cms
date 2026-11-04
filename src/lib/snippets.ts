// Code snippets (Settings > Code snippets, admins; settings.site.snippets): markup put on every page of
// the site as written, at the end of <head>, at the start of <body> and before </body>, for an
// analytics or chat service, a verification tag or a font. Not on previews. Safe in the browser.

export interface CodeSnippets {
  head?: string;
  bodyStart?: string;
  footer?: string;
  /** Places whose snippet waits for the visitor to accept cookies (the consent banner, src/lib/popups.ts). */
  consent?: { head?: boolean; bodyStart?: boolean; footer?: boolean };
}

type Place = 'head' | 'bodyStart' | 'footer';

export const SNIPPET_PLACES: { key: Place; label: string; help: string }[] = [
  { key: 'head', label: 'Header', help: 'At the end of <head>: meta tags, verification tags, stylesheets, analytics loaders.' },
  { key: 'bodyStart', label: 'Body start', help: 'Right after <body> opens: a tag manager’s <noscript> part.' },
  { key: 'footer', label: 'Footer', help: 'Before </body>: chat widgets and scripts that can wait for the page.' },
];

/** The most each snippet keeps, in characters. */
export const SNIPPET_MAX = 20_000;

/** The snippets posted (known places, text only, trimmed), or undefined for none. */
export function snippetsFrom(v: unknown): CodeSnippets | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: CodeSnippets = {};
  const consent: NonNullable<CodeSnippets['consent']> = {};
  const asked = (v as Record<string, any>).consent ?? {};
  for (const { key } of SNIPPET_PLACES) {
    const s = (v as Record<string, unknown>)[key];
    if (typeof s === 'string' && s.trim()) {
      out[key] = s.trim().slice(0, SNIPPET_MAX);
      if (asked[key] === true) consent[key] = true;
    }
  }
  if (Object.keys(consent).length) out.consent = consent;
  return Object.keys(out).length ? out : undefined;
}

/** A place's snippet as the page carries it: as written, or kept in a <template> until consent. */
export function snippetAt(s: CodeSnippets, place: Place): string {
  const code = s[place];
  if (!code) return '';
  return s.consent?.[place] ? `<template data-consent-snippet>${code}</template>\n` : `${code}\n`;
}
