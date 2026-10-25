// The Anthropic client Compose and the quick suggestions (SEO, excerpt) share: the site's key, straight
// to Anthropic's API.
import Anthropic from '@anthropic-ai/sdk';

/** Server env: the Worker's variables and secrets (process.env), else Astro's .env (import.meta.env). */
export const env = (k: string) => (process.env[k] || (import.meta.env?.[k] as string | undefined) || '').trim();

/** The message when no key is set. */
export const NO_KEY = 'ANTHROPIC_API_KEY is not set on the server.';

/** A client with the site's key, or null without one. */
export function claudeClient(): Anthropic | null {
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  // An injected ANTHROPIC_BASE_URL (some hosts' AI gateways set one) would send this key elsewhere and
  // fail, so the address is Anthropic's unless set on purpose.
  return new Anthropic({ apiKey, baseURL: env('ANTHROPIC_API_URL') || 'https://api.anthropic.com' });
}
