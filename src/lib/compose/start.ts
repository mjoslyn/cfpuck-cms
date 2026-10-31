// What Compose's start pages asked for (the admin's home, src/admin/ComposeHome.tsx, and the standard start
// page, src/admin/ComposeStart.tsx), kept in the browser's sessionStorage for the screen they open, where
// Compose writes it at once. Browser only. `what`: form:<id>, campaign:<id>, a template's <kind>:<slug> (its
// Compose conversation's key), or new:<type> (a new page, post... on Compose for a page).

export interface ComposeStart {
  brief: string;
  /** A form's: what to write, and the confirmation as a message or a page. */
  parts?: string[];
  confirm?: 'message' | 'page';
  /** False: put the brief in the message box without sending it (to add documents, images or links first). */
  send?: boolean;
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
