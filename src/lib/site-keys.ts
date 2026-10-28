// Keys saved under Settings > Connections (table site_keys; server only): Anthropic, Stripe, Square and
// Mailgun. Each is encrypted (AES-GCM, its name as associated data) with a key made from AUTH_SECRET, so
// a database export or a leaked backup holds nothing usable; the table is in no role's policies, and
// sync, backups and restores leave it alone. Admins set and replace keys but never read them back (the
// screen shows the last 4 characters). A key set in the environment wins (env(), src/lib/env.ts).
// Loaded at most once a minute per server instance (refreshSavedKeys), as the site timezone is.
import type { Db } from './db/query';
import { siteDb } from './db/site';
import { env, hostEnv, useSavedKeys } from './env';

export type Service = 'anthropic' | 'stripe' | 'square' | 'mailgun';

/** Each service's settings: secret ones are shown by their last 4 characters, the others as they are. */
export const SERVICES: Record<Service, { label: string; secret: string[]; plain: string[]; guarded: boolean }> = {
  anthropic: { label: 'Claude (Anthropic)', secret: ['ANTHROPIC_API_KEY'], plain: [], guarded: false },
  stripe: { label: 'Stripe', secret: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'], plain: [], guarded: true },
  square: { label: 'Square', secret: ['SQUARE_ACCESS_TOKEN', 'SQUARE_WEBHOOK_SIGNATURE_KEY'], plain: ['SQUARE_LOCATION_ID', 'SQUARE_ENVIRONMENT', 'SQUARE_WEBHOOK_URL'], guarded: true },
  mailgun: { label: 'Mailgun', secret: ['MAILGUN_API_KEY', 'MAILGUN_WEBHOOK_SIGNING_KEY'], plain: ['MAILGUN_DOMAIN', 'MAILGUN_REGION'], guarded: true },
};

export const namesOf = (s: Service) => [...SERVICES[s].secret, ...SERVICES[s].plain];
const ALL = new Set((Object.keys(SERVICES) as Service[]).flatMap(namesOf));
export const isKeyName = (name: string) => ALL.has(name);

const text = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let cipher: { secret: string; key: Promise<CryptoKey> } | null = null;
/** The encryption key, made from AUTH_SECRET (HKDF); changing AUTH_SECRET makes saved keys unreadable. */
function cipherKey(): Promise<CryptoKey> {
  const secret = hostEnv('AUTH_SECRET');
  if (!secret) throw new Error('AUTH_SECRET is not set, so keys can’t be saved here.');
  if (cipher?.secret !== secret) {
    const key = crypto.subtle
      .importKey('raw', text.encode(secret), 'HKDF', false, ['deriveKey'])
      .then((base) => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: text.encode('site-keys'), info: text.encode('v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    cipher = { secret, key };
  }
  return cipher.key;
}

/** A value as stored: v1.<iv>.<ciphertext>, bound to its name. */
export async function seal(name: string, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(name) }, await cipherKey(), text.encode(value));
  return `v1.${b64(iv)}.${b64(out)}`;
}

/** A stored value, or null when it can't be read (AUTH_SECRET changed, or it was moved to another name). */
export async function unseal(name: string, stored: string): Promise<string | null> {
  const [v, iv, data] = stored.split('.');
  if (v !== 'v1' || !iv || !data) return null;
  try {
    const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: text.encode(name) }, await cipherKey(), unb64(data));
    return new TextDecoder().decode(out);
  } catch {
    return null;
  }
}

let loaded = 0;
let unreadable: string[] = [];
let rows: { name: string; hint: string | null; updated_at: string | null; updated_by: string | null }[] = [];
let pending: Promise<void> | null = null;

async function load(db: Db): Promise<void> {
  const { data, error } = await db.from('site_keys').select('name, value, hint, updated_at, updated_by');
  if (error) return; // A database without the table yet: keys come from the environment only.
  const keys: Record<string, string> = {};
  const bad: string[] = [];
  for (const r of data ?? []) {
    if (!isKeyName(r.name)) continue;
    const v = hostEnv('AUTH_SECRET') ? await unseal(r.name, r.value) : null;
    if (v == null) bad.push(r.name);
    else keys[r.name] = v;
  }
  unreadable = bad;
  rows = (data ?? []).map(({ name, hint, updated_at, updated_by }) => ({ name, hint, updated_at, updated_by }));
  useSavedKeys(keys);
}

/**
 * Load the saved keys into env() (at most once a minute unless `force`). Requests that arrive while a
 * load is running wait for it, so none runs without the keys; a failure leaves the last ones.
 */
export async function refreshSavedKeys(db: Db = siteDb(), force = false): Promise<void> {
  if (pending) {
    await pending;
    if (!force) return;
  }
  if (!force && Date.now() - loaded < 60_000) return;
  loaded = Date.now();
  pending = load(db).finally(() => {
    pending = null;
  });
  await pending;
}

const hintOf = (name: string, value: string) => (isSecretName(name) ? value.slice(-4) : value);
const isSecretName = (name: string) => (Object.values(SERVICES) as { secret: string[] }[]).some((s) => s.secret.includes(name));

/** Why keys can't be saved here (no AUTH_SECRET, or no table yet), or null when they can. */
export async function cannotSave(db: Db): Promise<string | null> {
  if (!hostEnv('AUTH_SECRET')) return 'AUTH_SECRET is not set on the server, so keys can’t be saved here.';
  const { error } = await db.from('site_keys').select('name').limit(1);
  return error ? 'The database has no table for keys yet: apply the migrations first.' : null;
}

/**
 * Save some of a service's settings (names it doesn't have are refused; '' removes one), all values
 * written in one statement and the removals in another. Answers the names whose value changed.
 */
export async function saveKeys(db: Db, values: Record<string, string>, by: string): Promise<string[]> {
  await refreshSavedKeys(db, true);
  const now = new Date().toISOString();
  const write: Record<string, unknown>[] = [];
  const remove: string[] = [];
  const changed: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (!isKeyName(name)) throw new Error(`Unknown setting ${name}.`);
    if (hostEnv(name)) throw new Error(`${name} is set by the host, so it can’t be changed here.`);
    const v = value.trim();
    const had = rows.some((r) => r.name === name);
    if (v) {
      write.push({ name, value: await seal(name, v), hint: hintOf(name, v), updated_by: by, updated_at: now });
      if (env(name) !== v || unreadable.includes(name)) changed.push(name);
    } else if (had) {
      remove.push(name);
      changed.push(name);
    }
  }
  if (write.length) {
    const { error } = await db.from('site_keys').upsert(write, { onConflict: 'name' });
    if (error) throw new Error(error.message);
  }
  if (remove.length) {
    const { error } = await db.from('site_keys').delete().in('name', remove);
    if (error) throw new Error(error.message);
  }
  await refreshSavedKeys(db, true);
  return changed;
}

export interface KeyStatus {
  /** host: set in the environment (it wins); saved: under Settings > Connections; unreadable: saved,
   * but AUTH_SECRET has changed since. */
  source: 'host' | 'saved' | 'unreadable' | null;
  /** The last 4 characters of a secret, or a plain setting's value. */
  hint: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** Where each of a service's settings comes from, for the screen (never a secret's value). `fresh`
 * false: the keys were just loaded (by saveKeys). */
export async function keyStatus(db: Db, fresh = true): Promise<Record<string, KeyStatus>> {
  if (fresh) await refreshSavedKeys(db, true);
  const byName = new Map(rows.map((r) => [r.name, r]));
  const out: Record<string, KeyStatus> = {};
  for (const name of ALL) {
    const host = hostEnv(name);
    const row = byName.get(name);
    if (host) out[name] = { source: 'host', hint: hintOf(name, host) };
    else if (row) out[name] = { source: unreadable.includes(name) ? 'unreadable' : 'saved', hint: row.hint ?? '', updatedAt: row.updated_at ?? undefined, updatedBy: row.updated_by ?? undefined };
    else out[name] = { source: null, hint: '' };
  }
  return out;
}
