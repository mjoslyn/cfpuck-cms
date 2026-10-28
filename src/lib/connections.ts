// Settings > Connections (POST /api/admin/connections): a key is checked with its service before it is
// saved, and the service is set up from it: Stripe's and Square's webhooks are made (and their signing
// secrets kept), Square's location and environment and Mailgun's region and domain are read from the
// account (the admin picks one when there are several), and Mailgun's webhooks and signing key are set.
// Webhooks need the site's public address: a local copy saves the keys and skips them. Server only.
import { hostEnv } from './env';
import type { Service } from './site-keys';

export interface Connected {
  /** What to save (names of SERVICES' settings). */
  values: Record<string, string>;
  /** What was done, or should be done by hand, for the screen. */
  notes: string[];
  /** Several to choose from (a Square location, a Mailgun domain): nothing is saved until one is. */
  choose?: { name: string; label: string; options: [string, string][] };
  /** What to do once the values are saved (deleting the webhooks they replace), so a save that fails
   * leaves the old ones, whose secrets are still the saved ones. Answers notes. */
  after?: () => Promise<string[]>;
}

export class ConnectError extends Error {}

export const STRIPE_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired', 'charge.refunded', 'charge.refund.updated', 'refund.updated', 'refund.failed'];
export const SQUARE_EVENTS = ['payment.created', 'payment.updated', 'refund.created', 'refund.updated'];
export const MAILGUN_EVENTS = ['delivered', 'opened', 'permanent_fail', 'complained', 'unsubscribed'];

/** Whether webhooks can reach this address (not a local copy). */
export function publicOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === 'https:' && !/^(localhost|127\.|0\.0\.0\.0|\[::1\]|.*\.local$|.*\.localhost$)/.test(hostname);
  } catch {
    return false;
  }
}

/** A setting the host sets must match what the key needs, since the host's wins over a saved one (as the
 * code reads it: trimmed, and a region or environment in any case). */
function pin(name: string, detected: string) {
  const host = hostEnv(name)?.trim();
  const fold = (v: string) => (/_(REGION|ENVIRONMENT)$/.test(name) ? v.toLowerCase() : v);
  if (host && fold(host) !== fold(detected)) throw new ConnectError(`The server sets ${name} to ${host}, but this key needs ${detected}. Change or remove it on the server first.`);
}

const LOCAL = 'Webhooks weren’t set up: this copy of the site isn’t at a public address. Connect again on the live site.';

async function json(res: Response) {
  return res.json().catch(() => ({}));
}

/**
 * Check `service`'s keys and set it up. `input`: what the admin entered (a setting left out keeps its
 * current value, `current`); `origin`: the site's address, for webhooks.
 */
export async function connect(service: Service, input: Record<string, string>, current: (name: string) => string | undefined, origin: string): Promise<Connected> {
  const val = (name: string) => (input[name] ?? '').trim() || current(name) || '';
  const site = origin.replace(/\/$/, '');
  const hooks = publicOrigin(site);
  switch (service) {
    case 'anthropic': {
      const key = val('ANTHROPIC_API_KEY');
      if (!key) throw new ConnectError('Enter the API key.');
      const base = (hostEnv('ANTHROPIC_API_URL') || 'https://api.anthropic.com').replace(/\/$/, '');
      const res = await fetch(`${base}/v1/models?limit=1`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
      if (res.status === 401 || res.status === 403) throw new ConnectError('Anthropic didn’t accept that key.');
      if (!res.ok) throw new ConnectError(`Anthropic answered ${res.status}. Try again.`);
      return { values: { ANTHROPIC_API_KEY: key }, notes: ['Claude is connected.'] };
    }

    case 'stripe': {
      const key = val('STRIPE_SECRET_KEY');
      if (!/^(sk|rk)_(test|live)_/.test(key)) throw new ConnectError('Enter the secret key: it starts sk_live_ (or sk_test_ to test).');
      const stripe = (method: string, path: string, body?: URLSearchParams) => fetch(`https://api.stripe.com/v1${path}`, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body });
      const mode = /_test_/.test(key) ? 'test mode' : 'live mode';
      const values: Record<string, string> = { STRIPE_SECRET_KEY: key };
      const typed = (input.STRIPE_WEBHOOK_SECRET ?? '').trim();
      if (typed) {
        if (!typed.startsWith('whsec_')) throw new ConnectError('The webhook signing secret starts whsec_.');
        values.STRIPE_WEBHOOK_SECRET = typed;
      }
      // The key the site has now: its webhook can stay as it is when the key hasn't changed.
      const sameKey = key === (current('STRIPE_SECRET_KEY') ?? '') && !!current('STRIPE_WEBHOOK_SECRET');
      const list = await stripe('GET', '/webhook_endpoints?limit=100');
      if (list.status === 401) throw new ConnectError('Stripe didn’t accept that key.');
      // A 403 is a restricted key that can't manage webhooks (it is a key Stripe knows); anything else
      // leaves the key unchecked, so nothing is saved.
      if (!list.ok && list.status !== 403) throw new ConnectError(`Stripe answered ${list.status}, so the key couldn’t be checked. Try again.`);
      const notes = [`Stripe is connected, in ${mode}.`];
      if (typed || hostEnv('STRIPE_WEBHOOK_SECRET')) return { values, notes };
      if (!hooks) return { values, notes: [...notes, LOCAL] };
      if (!list.ok) return { values, notes: [...notes, `This key can’t set up webhooks. In Stripe, add an endpoint at ${site}/api/payments/stripe and paste its signing secret here.`] };
      const url = `${site}/api/payments/stripe`;
      const events = new URLSearchParams();
      STRIPE_EVENTS.forEach((ev, i) => events.set(`enabled_events[${i}]`, ev));
      const old: { id: string }[] = ((await json(list)).data ?? []).filter((e: { url: string }) => e.url === url);
      // Unchanged key and secret: the endpoint stays (its events brought up to date), so its secret does too.
      if (sameKey && old.length === 1) {
        await stripe('POST', `/webhook_endpoints/${old[0].id}`, events);
        return { values: { ...values, STRIPE_WEBHOOK_SECRET: current('STRIPE_WEBHOOK_SECRET')! }, notes: [...notes, `Stripe sends payment updates to ${url}.`] };
      }
      // A new endpoint (a secret can only be read when one is made), then the old ones go: if making it
      // fails, the endpoint that works stays.
      const body = new URLSearchParams({ url, description: 'Payments for this site (set up by Settings > Connections)' });
      for (const [k, v] of events) body.set(k, v);
      const made = await stripe('POST', '/webhook_endpoints', body);
      const ep = await json(made);
      if (!made.ok || !ep.secret) throw new ConnectError(`Stripe refused the webhook: ${ep?.error?.message ?? made.status}.`);
      values.STRIPE_WEBHOOK_SECRET = ep.secret;
      const after = async () => {
        for (const e of old) if (e.id !== ep.id && !(await stripe('DELETE', `/webhook_endpoints/${e.id}`)).ok) return [`Stripe’s old endpoint ${e.id} couldn’t be deleted: delete it in Stripe.`];
        return [];
      };
      return { values, notes: [...notes, `Stripe sends payment updates to ${url}.`], after };
    }

    case 'square': {
      const token = val('SQUARE_ACCESS_TOKEN');
      if (!token) throw new ConnectError('Enter the access token.');
      const hosts = { production: 'https://connect.squareup.com/v2', sandbox: 'https://connect.squareupsandbox.com/v2' };
      const square = (environment: keyof typeof hosts, method: string, path: string, body?: unknown) =>
        fetch(`${hosts[environment]}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Square-Version': '2025-09-24', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      // The token says which environment it is for: production's is tried first.
      let environment: keyof typeof hosts | null = null;
      let locations: { id: string; name: string; status: string }[] = [];
      for (const e of ['production', 'sandbox'] as const) {
        const res = await square(e, 'GET', '/locations');
        if (res.ok) {
          environment = e;
          locations = ((await json(res)).locations ?? []).filter((l: { status: string }) => l.status === 'ACTIVE');
          break;
        }
      }
      if (!environment) throw new ConnectError('Square didn’t accept that token.');
      if (!locations.length) throw new ConnectError('The Square account has no active location.');
      const wanted = val('SQUARE_LOCATION_ID');
      const location = locations.find((l) => l.id === wanted) ?? (locations.length === 1 ? locations[0] : undefined);
      if (!location) return { values: {}, notes: [], choose: { name: 'SQUARE_LOCATION_ID', label: 'Location payments go to', options: locations.map((l) => [l.id, l.name]) } };
      pin('SQUARE_ENVIRONMENT', environment);
      pin('SQUARE_LOCATION_ID', location.id);
      const values: Record<string, string> = { SQUARE_ACCESS_TOKEN: token, SQUARE_LOCATION_ID: location.id, SQUARE_ENVIRONMENT: environment };
      const notes = [`Square is connected${environment === 'sandbox' ? ', in its sandbox' : ''}, taking payments at ${location.name}.`];
      if (hostEnv('SQUARE_WEBHOOK_SIGNATURE_KEY')) return { values, notes };
      if (!hooks) return { values, notes: [...notes, LOCAL] };
      const url = `${site}/api/payments/square`;
      pin('SQUARE_WEBHOOK_URL', url);
      const subs = await square(environment, 'GET', '/webhooks/subscriptions');
      // Without the list, the old subscriptions can't be found to replace, and a new one would add to them.
      if (!subs.ok) throw new ConnectError(`Square answered ${subs.status} for its webhooks. Try again.`);
      const old: { id: string }[] = ((await json(subs)).subscriptions ?? []).filter((x: { notification_url: string }) => x.notification_url === url);
      const sameToken = token === (current('SQUARE_ACCESS_TOKEN') ?? '') && environment === current('SQUARE_ENVIRONMENT') && !!current('SQUARE_WEBHOOK_SIGNATURE_KEY');
      const done = (key: string) => ({ values: { ...values, SQUARE_WEBHOOK_SIGNATURE_KEY: key, SQUARE_WEBHOOK_URL: url }, notes: [...notes, `Square sends payment updates to ${url}.`] });
      // Unchanged token and key: the subscription stays, so its signature key does too.
      if (sameToken && old.length === 1) return done(current('SQUARE_WEBHOOK_SIGNATURE_KEY')!);
      // A new subscription, then the old ones go: if making it fails, the one that works stays.
      const made = await square(environment, 'POST', '/webhooks/subscriptions', {
        idempotency_key: crypto.randomUUID(),
        subscription: { name: 'This site’s payments', enabled: true, event_types: SQUARE_EVENTS, notification_url: url },
      });
      const sub = (await json(made)).subscription;
      if (!made.ok || !sub?.signature_key) {
        if (old.length) throw new ConnectError(`Square refused the webhook (${made.status}); the one it has stays. Try again.`);
        return { values, notes: [...notes, `Square refused the webhook. In Square, subscribe ${url} to ${SQUARE_EVENTS.join(', ')}.`] };
      }
      const after = async () => {
        for (const x of old) if (x.id !== sub.id && !(await square(environment, 'DELETE', `/webhooks/subscriptions/${x.id}`)).ok) return [`Square’s old webhook ${x.id} couldn’t be deleted: delete it in Square.`];
        return [];
      };
      return { ...done(sub.signature_key), after };
    }

    case 'mailgun': {
      const key = val('MAILGUN_API_KEY');
      if (!key) throw new ConnectError('Enter the API key.');
      const auth = `Basic ${btoa(`api:${key}`)}`;
      const stand = hostEnv('MAILGUN_API_BASE')?.replace(/\/$/, '');
      const bases = stand ? { us: stand, eu: stand } : { us: 'https://api.mailgun.net', eu: 'https://api.eu.mailgun.net' };
      const mailgun = (region: 'us' | 'eu', method: string, path: string, body?: URLSearchParams) => fetch(`${bases[region]}${path}`, { method, headers: { Authorization: auth }, body });
      // The account's region is where the key works.
      let region: 'us' | 'eu' | null = null;
      let domains: string[] = [];
      for (const r of ['us', 'eu'] as const) {
        const res = await mailgun(r, 'GET', '/v3/domains?limit=100');
        if (res.ok) {
          region = r;
          domains = ((await json(res)).items ?? []).filter((d: { state?: string }) => d.state !== 'disabled').map((d: { name: string }) => d.name);
          break;
        }
      }
      if (!region) throw new ConnectError('Mailgun didn’t accept that key.');
      if (!domains.length) throw new ConnectError('The Mailgun account has no sending domain. Add one in Mailgun first.');
      const wanted = val('MAILGUN_DOMAIN');
      const domain = domains.includes(wanted) ? wanted : domains.length === 1 ? domains[0] : undefined;
      if (!domain) return { values: {}, notes: [], choose: { name: 'MAILGUN_DOMAIN', label: 'Sending domain', options: domains.map((d) => [d, d]) } };
      pin('MAILGUN_REGION', region);
      pin('MAILGUN_DOMAIN', domain);
      const values: Record<string, string> = { MAILGUN_API_KEY: key, MAILGUN_DOMAIN: domain, MAILGUN_REGION: region };
      const notes = [`Mailgun is connected, sending from ${domain}.`];
      const typed = (input.MAILGUN_WEBHOOK_SIGNING_KEY ?? '').trim();
      if (typed) values.MAILGUN_WEBHOOK_SIGNING_KEY = typed;
      else if (!hostEnv('MAILGUN_WEBHOOK_SIGNING_KEY')) {
        const signing = await mailgun(region, 'GET', '/v5/accounts/http_signing_key');
        const k = signing.ok ? (await json(signing)).http_signing_key : '';
        if (k) values.MAILGUN_WEBHOOK_SIGNING_KEY = k;
        else notes.push('Mailgun’s webhook signing key couldn’t be read: paste it here (Mailgun > Webhooks).');
      }
      if (!hooks) return { values, notes: [...notes, LOCAL] };
      const url = `${site}/api/mailgun/webhook`;
      const path = `/v3/domains/${encodeURIComponent(domain)}/webhooks`;
      // A webhook goes to up to 3 addresses: this site's is added beside any there (another copy of the
      // site, an old domain), never in place of them.
      const listed = await mailgun(region, 'GET', path);
      if (!listed.ok) throw new ConnectError(`Mailgun answered ${listed.status} for its webhooks. Try again.`);
      const have: Record<string, { urls?: string[]; url?: string }> = (await json(listed)).webhooks ?? {};
      const failed: string[] = [];
      for (const id of MAILGUN_EVENTS) {
        const urls = have[id]?.urls ?? (have[id]?.url ? [have[id].url!] : []);
        if (urls.includes(url)) continue;
        const body = new URLSearchParams();
        for (const u of [...urls, url]) body.append('url', u);
        const ok = urls.length >= 3 ? false : urls.length ? (await mailgun(region, 'PUT', `${path}/${id}`, body)).ok : (await mailgun(region, 'POST', path, new URLSearchParams({ id, url }))).ok;
        if (!ok) failed.push(id);
      }
      notes.push(failed.length ? `Mailgun refused the webhooks for ${failed.join(', ')}: add them in Mailgun at ${url}.` : `Mailgun sends deliveries, opens, bounces, complaints and unsubscribes to ${url}.`);
      return { values, notes };
    }
  }
}
