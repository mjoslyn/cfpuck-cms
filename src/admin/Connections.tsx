// Settings > Connections: the site's keys for Claude, Stripe, Square and Mailgun (GET and POST
// /api/admin/connections). Paste a key and Connect: the site checks it with the service, sets the
// service up (webhooks, a Square location, Mailgun's domain) and saves it encrypted. Keys are never shown
// again, only their last 4 characters; a key set by the host can't be changed here. Payment and mail
// keys ask for the admin's password, and every change is emailed to the admins. Saves as it goes.
import { useEffect, useState } from 'react';
import type { KeyStatus, Service } from '../lib/site-keys';

interface Info {
  services: Record<Service, { label: string; secret: string[]; plain: string[]; guarded: boolean }>;
  keys: Record<string, KeyStatus>;
}

const input = 'w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent';
const btn = 'rounded border border-admin-ink/15 bg-white px-3 py-1.5 text-xs hover:border-admin-accent hover:text-admin-accent disabled:opacity-40';

/** What each setting is called on the screen, and where to find the main key. */
const NAMES: Record<string, string> = {
  ANTHROPIC_API_KEY: 'API key',
  STRIPE_SECRET_KEY: 'Secret key',
  STRIPE_WEBHOOK_SECRET: 'Webhook signing secret',
  SQUARE_ACCESS_TOKEN: 'Access token',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'Webhook signature key',
  SQUARE_LOCATION_ID: 'Location',
  SQUARE_ENVIRONMENT: 'Environment',
  SQUARE_WEBHOOK_URL: 'Webhook address',
  MAILGUN_API_KEY: 'API key',
  MAILGUN_WEBHOOK_SIGNING_KEY: 'Webhook signing key',
  MAILGUN_DOMAIN: 'Sending domain',
  MAILGUN_REGION: 'Region',
};
const WHERE: Record<Service, string> = {
  anthropic: 'For Write with Claude and Compose. In the Claude Console (console.anthropic.com), API keys: create a key and paste it here.',
  stripe: 'For card payments on forms and tickets. In Stripe, Developers > API keys: the secret key (sk_live_..., or sk_test_... to test). The site sets up its own webhook.',
  square: 'For card payments on forms and tickets. In Square’s Developer Console, your app > Credentials: the production (or sandbox) access token. The site finds your location and sets up its own webhook.',
  mailgun: 'For mailing lists. In Mailgun, API Security: a private API key. The site finds your sending domain and sets up its webhooks.',
};
/** Settings an admin may type in by hand, when the site can't set them up itself. */
const ADVANCED: Partial<Record<Service, string>> = { stripe: 'STRIPE_WEBHOOK_SECRET', mailgun: 'MAILGUN_WEBHOOK_SIGNING_KEY' };

const when = (s?: string) => (s ? new Date(s).toLocaleDateString('en-US', { dateStyle: 'medium' }) : '');

function Card({ service, info, onKeys }: { service: Service; info: Info; onKeys: (k: Info['keys']) => void }) {
  const def = info.services[service];
  const main = def.secret[0];
  const status = (n: string) => info.keys[n] ?? { source: null, hint: '' };
  const host = status(main).source === 'host';
  const saved = [...def.secret, ...def.plain].some((n) => ['saved', 'unreadable'].includes(status(n).source ?? ''));
  const connected = ['host', 'saved'].includes(status(main).source ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [password, setPassword] = useState('');
  const [choose, setChoose] = useState<{ name: string; label: string; options: [string, string][] } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    const res = await fetch('/api/admin/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service, password, ...body }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError((res && (await res.text())) || 'The site couldn’t be reached. Try again.');
    const out = await res.json();
    setNotes(out.notes ?? []);
    if (out.choose) return setChoose(out.choose);
    setChoose(null);
    setValues({});
    setPassword('');
    onKeys(out.keys);
  };
  const disconnect = () => window.confirm(`Remove ${def.label}’s saved keys? What uses them stops working until it is connected again.`) && send({ remove: true });
  const ready = !busy && (!def.guarded || password) && (values[main]?.trim() || connected || choose);
  return (
    <section className="mb-5 rounded border border-admin-ink/10 bg-white p-4" aria-labelledby={`conn-${service}`}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 id={`conn-${service}`} className="text-base font-medium">
          {def.label}
        </h2>
        <span className={`rounded px-2 py-0.5 text-xs ${connected ? 'bg-admin-soft text-admin-ink' : 'text-admin-muted'}`}>
          {status(main).source === 'unreadable' ? 'Enter the key again' : host ? 'Set by the host' : connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <p className="mb-3 text-xs text-admin-muted">{WHERE[service]}</p>
      <dl className="mb-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
        {[...def.secret, ...def.plain].map((n) => {
          const s = status(n);
          if (!s.source) return null;
          const shown = def.secret.includes(n) ? `ending ${s.hint}` : s.hint;
          return [
            <dt key={`${n}-t`} className="text-admin-muted">{NAMES[n] ?? n}</dt>,
            <dd key={`${n}-d`}>
              {s.source === 'unreadable' ? 'Saved, but can’t be read (the site’s AUTH_SECRET has changed): enter it again.' : `${shown}${s.source === 'host' ? ' (set by the host)' : s.updatedAt ? `, saved ${when(s.updatedAt)}${s.updatedBy ? ` by ${s.updatedBy}` : ''}` : ''}`}
            </dd>,
          ];
        })}
      </dl>
      {host ? (
        <p className="text-xs text-admin-muted">The host sets this key (an environment variable on the server), so it is changed there, not here.</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) send({ values });
          }}
        >
          <label className="mb-2 block">
            <span className="mb-1 block text-xs font-medium text-admin-muted">{connected ? `${NAMES[main]}: paste a new one to replace it, or leave this empty` : NAMES[main]}</span>
            <input className={input} type="password" autoComplete="off" spellCheck={false} value={values[main] ?? ''} onChange={(e) => setValues({ ...values, [main]: e.target.value })} />
          </label>
          {choose && (
            <label className="mb-2 block">
              <span className="mb-1 block text-xs font-medium text-admin-muted">{choose.label}</span>
              <select className={input} value={values[choose.name] ?? ''} onChange={(e) => setValues({ ...values, [choose.name]: e.target.value })}>
                <option value="">Choose…</option>
                {choose.options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          {ADVANCED[service] && (
            <details className="mb-2 text-xs">
              <summary className="cursor-pointer text-admin-muted">Set up the webhook by hand</summary>
              <label className="mt-2 block">
                <span className="mb-1 block font-medium text-admin-muted">{NAMES[ADVANCED[service]!]}</span>
                <input className={input} type="password" autoComplete="off" spellCheck={false} value={values[ADVANCED[service]!] ?? ''} onChange={(e) => setValues({ ...values, [ADVANCED[service]!]: e.target.value })} />
              </label>
            </details>
          )}
          {def.guarded && (
            <label className="mb-2 block">
              <span className="mb-1 block text-xs font-medium text-admin-muted">Your password (to confirm it’s you)</span>
              <input className={input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
          {error && (
            <p className="mb-2 rounded bg-admin-soft px-2 py-1.5 text-xs text-admin-ink" role="alert">
              {error}
            </p>
          )}
          {notes.length > 0 && (
            <ul className="mb-2 list-disc pl-5 text-xs text-admin-muted" role="status">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3">
            <button type="submit" className="rounded bg-admin-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-admin-accent-dark disabled:opacity-40" disabled={!ready}>
              {busy ? 'Checking…' : choose ? 'Save' : connected && !values[main]?.trim() ? 'Check and set up again' : 'Connect'}
            </button>
            {saved && (
              <button type="button" className={btn} disabled={busy || (def.guarded && !password)} onClick={disconnect}>
                Disconnect
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

export default function Connections() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/admin/connections')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then(setInfo, (e) => setError(`Couldn’t load the connections: ${e.message}`));
  }, []);
  if (error) return <p className="text-sm text-admin-ink">{error}</p>;
  if (!info) return <p className="text-sm text-admin-muted">Loading…</p>;
  return (
    <div>
      <p className="mb-4 text-sm text-admin-muted">
        Keys are checked with each service and kept encrypted. Nobody can read them back here, they never leave this copy of the site (sync and backups leave them out), and every change is emailed to the admins. A change reaches every part of the site within a minute.
      </p>
      {(Object.keys(info.services) as Service[]).map((s) => (
        <Card key={s} service={s} info={info} onKeys={(keys) => setInfo({ ...info, keys })} />
      ))}
    </div>
  );
}
