// One short Claude call that answers in a fixed shape: the Compose buttons of the SEO section, the
// excerpt, a term or taxonomy, and an image's alt text (in the media library, with the image). ANTHROPIC_SEO_MODEL (default Haiku 4.5, which is quick). The answer comes as
// JSON in the shape's schema (structured outputs, output_config.format), not a forced tool call: newer
// models (Claude Sonnet 5.5, Opus 5.5, Fable 5.1) refuse tool_choice "tool".
import type Anthropic from '@anthropic-ai/sdk';
import { site } from '../site';
import { claudeClient, env, NO_KEY } from './client';

export class QuickError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Keys structured outputs don't take (the descriptions say the limits in words). */
const UNSUPPORTED = new Set(['minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems', 'pattern']);

/** A shape's schema as structured outputs takes it: every object closed, unsupported limits left out. */
export function outputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(outputSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED.has(k)) continue;
    out[k] = k === 'properties' && v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([p, d]) => [p, outputSchema(d)])) : outputSchema(v);
  }
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}

/** The answer to a quick call: its JSON, else a QuickError saying why there is none. */
export function quickAnswer<T>(res: Pick<Anthropic.Message, 'content' | 'stop_reason'>): T {
  if (res.stop_reason === 'refusal') throw new QuickError('Claude declined to write this. Try different notes, or write it yourself.', 502);
  if (res.stop_reason === 'max_tokens') throw new QuickError('The answer was cut off. Try again.', 502);
  const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new QuickError('No suggestion came back.', 502);
  }
}

/**
 * Ask for an answer in `shape`'s schema, given a task (system text after the site's brief) and the page.
 * `opts.model`: another model (a bigger task); `opts.facts`: the closing rule on facts, in place of
 * keeping to the page's.
 */
export async function quickAsk<T>(task: string, shape: { name: string; description: string; input_schema: Record<string, any> }, page: string | Anthropic.ContentBlockParam[], maxTokens = 500, opts: { model?: string; facts?: string } = {}): Promise<T> {
  const client = claudeClient();
  if (!client) throw new QuickError(NO_KEY, 503);
  const res = await client.messages.create({
    model: opts.model || env('ANTHROPIC_SEO_MODEL') || 'claude-haiku-4-5-20251001',
    // Models that think first (on by default on the newest ones) need room for it before the answer.
    max_tokens: Math.max(maxTokens, 8000),
    system: `You write for "${site.name}", the ${site.organization} site. ${site.brief}\n${task} Answer with ${shape.description.charAt(0).toLowerCase()}${shape.description.slice(1).replace(/\.$/, '')}. ${opts.facts ?? 'Use only facts in the page.'} American English.`,
    output_config: { format: { type: 'json_schema', schema: outputSchema(shape.input_schema) as Record<string, unknown> } },
    messages: [{ role: 'user', content: page }],
  });
  return quickAnswer<T>(res);
}
