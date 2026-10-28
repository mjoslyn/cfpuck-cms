// The Anthropic client Compose and the quick suggestions (SEO, excerpt) share: the site's key, straight
// to Anthropic's API.
import Anthropic from '@anthropic-ai/sdk';
import { env as readEnv } from '../env';

/** A setting from the environment (../env), trimmed, '' when unset. */
export const env = (k: string) => (readEnv(k) || '').trim();

/** The message when no key is set. */
export const NO_KEY = 'Claude isn’t connected: an admin adds its key under Settings > Connections.';

/** A client with the site's key, or null without one. */
export function claudeClient(): Anthropic | null {
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  // An injected ANTHROPIC_BASE_URL (some hosts' AI gateways set one) would send this key elsewhere and
  // fail, so the address is Anthropic's unless set on purpose.
  return new Anthropic({ apiKey, baseURL: env('ANTHROPIC_API_URL') || 'https://api.anthropic.com' });
}
