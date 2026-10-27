// Addresses typed into the link picker (src/puck/LinkPicker.tsx): safe in the browser.

/**
 * What was typed, as an address, or null when it reads as a search: a web address (a bare domain gets
 * https://), an email address (mailto:), a phone number (tel:), a path or anchor on the site, or a
 * merge tag ({unsubscribe_url}) in an email.
 */
export function typedAddress(q: string): string | null {
  const s = q.trim();
  if (!s || /\s/.test(s.replace(/^tel:\s*/i, ''))) return null;
  if (/^(https?:\/\/|mailto:|tel:|\/|#|\{[\w|]+\})/i.test(s)) return s;
  if (/^[^@\s/]+@[^@\s/]+\.[a-z]{2,}$/i.test(s)) return `mailto:${s}`;
  if (/^\+?[\d().-]{7,}$/.test(s) && (s.match(/\d/g)?.length ?? 0) >= 7) return `tel:${s.replace(/[^\d+]/g, '')}`;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(s)) return `https://${s}`;
  return null;
}

/** An address that leaves the site (opened in a new tab by default). */
export const isExternal = (url: string) => /^https?:\/\//i.test(url) && !(typeof location !== 'undefined' && url.startsWith(location.origin));
