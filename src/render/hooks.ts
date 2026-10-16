// Work the page renderer can only do on the server (it uses node modules the editor's browser bundle
// can't carry: the render code runs in the editor too). Server code registers it here when it loads (the
// middleware imports it), and prepare() calls it when a page needs it; in the editor nothing is
// registered and the blocks show their editor stand-ins.
import type { RenderCtx } from './env';

export const renderHooks: {
  /** The mailing preferences page's data: whose subscription the page's signed link (or the visitor's sign-in) is for. */
  mailPreferences?: (ctx: RenderCtx) => Promise<void>;
} = {};
