import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Db } from './db/query';
import { SqlExecutor } from './db/sql';
import type { Ctx } from './db/policies';

// The data is read and written through the query layer (src/lib/db) on a direct database connection,
// and accounts are the site's own (src/lib/auth). Storage (files) stays on Supabase until it moves
// (docs/cloudflare-migration.md): a Db carries it as `storage`, with the service key, for the server's
// own code.

const url = import.meta.env?.PUBLIC_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;

let supabase: SupabaseClient | null = null;
const serviceSupabase = () => (supabase ??= createClient(url, import.meta.env?.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));

let site: Db | null = null;
/**
 * The site's own reads and writes on the server (public pages, feeds, its APIs, media processing,
 * form submissions), as the server: nothing is filtered by role, so code using it shows visitors only
 * what they may see: the Loader's published scope (published entries, members' access) and its own
 * filters elsewhere. Never reaches the browser.
 */
export function siteDb(): Db {
  site ??= new Db(new SqlExecutor({ role: 'service' }), serviceSupabase().storage);
  return site;
}

/** The same as siteDb, for trusted server work (media processing, form submissions). */
export const serviceClient = siteDb;

/** A signed-in person's connection (admin and preview): reads and writes as the policies allow their role. */
export function sessionDb(ctx: Ctx): Db {
  return new Db(new SqlExecutor(ctx), serviceSupabase().storage);
}

export const storagePublicUrl = (path: string) => `${url}/storage/v1/object/public/media/${path}`;
