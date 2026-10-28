// What the admin bar's Compose > Form, Campaign, Template, Template part or Pattern asked for (the
// standard start page, src/admin/ComposeStart.tsx), kept in the browser's sessionStorage for the editor it
// opens, where Compose writes it at once. Browser only. `what`: form:<id>, campaign:<id>, or a template's
// <kind>:<slug> (its Compose conversation's key).

export interface ComposeStart {
  brief: string;
  /** A form's: what to write, and the confirmation as a message or a page. */
  parts?: string[];
  confirm?: 'message' | 'page';
}

const key = (what: string) => `compose-start:${what}`;

export function keepStart(what: string, start: ComposeStart): void {
  try {
    sessionStorage.setItem(key(what), JSON.stringify(start));
  } catch {}
}

/** The start kept for `what`, once: it is removed as it is read. */
export function takeStart(what: string): ComposeStart | undefined {
  try {
    const raw = sessionStorage.getItem(key(what));
    sessionStorage.removeItem(key(what));
    return raw ? (JSON.parse(raw) as ComposeStart) : undefined;
  } catch {
    return undefined;
  }
}
