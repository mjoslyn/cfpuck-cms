// Settings > Accessibility (`settings.site.a11y`): with `block_publish` on, an entry of any type with a
// page is published only once the editor's accessibility check, run just before, has nothing left open
// (src/puck/A11yPanel.tsx, `openIssues`). The check runs on the page in the editor, so bulk Publish
// can't run it and leaves those entries for the editor.
import { PAGELESS_TYPES } from './site';

export interface A11ySettings {
  block_publish?: boolean;
}

/** Whether publishing waits for the accessibility check. */
export const a11yGate = (site: { a11y?: A11ySettings } | null | undefined) => site?.a11y?.block_publish === true;

/** Whether an entry of this type has to be published from the editor (bulk Publish skips it). */
export const publishNeedsCheck = (site: { a11y?: A11ySettings } | null | undefined, type: string) => a11yGate(site) && !PAGELESS_TYPES.has(type);

/** The setting as saved: only a known shape. */
export const a11ySettingsFrom = (v: unknown): A11ySettings | undefined => ((v as A11ySettings | null)?.block_publish === true ? { block_publish: true } : undefined);
