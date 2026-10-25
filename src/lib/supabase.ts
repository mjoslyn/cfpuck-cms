import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import { Db } from './db/query';
import { SqlExecutor } from './db/sql';
import type { Ctx } from './db/policies';

// The data is read and written through the query layer (src/lib/db) on a direct database connection.
// Supabase Auth (sign-in, invitations, password links) and Storage (files) stay on Supabase until they
// move (docs/cloudflare-migration.md): a Db carries them as `auth` and `storage`.

const url = import.meta.env?.PUBLIC_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env?.PUBLIC_SUPABASE_ANON_KEY ?? process.env.PUBLIC_SUPABASE_ANON_KEY;

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
  site ??= new Db(new SqlExecutor({ role: 'service' }), serviceSupabase().auth, serviceSupabase().storage);
  return site;
}

/** The same as siteDb, for trusted server work (media processing, form submissions, auth admin). */
export const serviceClient = siteDb;

/** A signed-in person's connection (admin and preview): reads and writes as the policies allow their role. */
export function sessionDb(ctx: Ctx, auth?: SupabaseClient): Db {
  return new Db(new SqlExecutor(ctx), auth?.auth, auth?.storage);
}

/** Supabase Auth for a request: the session in its cookies (sign-in, sign-out, who is signed in). */
export function authClient(request: Request, cookies: AstroCookies): SupabaseClient {
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => parseCookieHeader(request.headers.get('Cookie') ?? '').map((c) => ({ name: c.name, value: c.value ?? '' })),
      setAll: (list) => list.forEach(({ name, value, options }) => cookies.set(name, value, options)),
    },
  });
}

export const storagePublicUrl = (path: string) => `${url}/storage/v1/object/public/media/${path}`;
