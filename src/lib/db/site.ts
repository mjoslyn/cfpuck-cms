// The site's connections (server only): as the server, or as a signed-in person's role. They read and
// write through the query layer (src/lib/db) on a direct database connection and carry the site's files
// (src/lib/storage.ts).
import { Db } from './query';
import { SqlExecutor } from './sql';
import type { Ctx } from './policies';
import { siteStorage } from '../storage';

let site: Db | null = null;
/**
 * The site's own reads and writes on the server (public pages, feeds, its APIs, media processing,
 * form submissions), as the server: nothing is filtered by role, so code using it shows visitors only
 * what they may see: the Loader's published scope (published entries, members' access) and its own
 * filters elsewhere. Never reaches the browser.
 */
export function siteDb(): Db {
  site ??= new Db(new SqlExecutor({ role: 'service' }), siteStorage);
  return site;
}

/** The same as siteDb, for trusted server work (media processing, form submissions). */
export const serviceClient = siteDb;

/** A signed-in person's connection (admin and preview): reads and writes as the policies allow their role. */
export function sessionDb(ctx: Ctx): Db {
  return new Db(new SqlExecutor(ctx), siteStorage);
}
