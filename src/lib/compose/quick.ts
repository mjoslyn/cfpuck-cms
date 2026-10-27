// One short Claude call that answers through a tool (a fixed shape): the SEO section's Generate, the
// excerpt's Write with Claude, a term's or taxonomy's Write with Claude, and an image's alt text (Generate in
// the media library, with the image). ANTHROPIC_SEO_MODEL (default Haiku 4.5, which is quick).
import type Anthropic from '@anthropic-ai/sdk';
import { site } from '../site';
import { claudeClient, env, NO_KEY } from './client';

export class QuickError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Ask for `tool`'s input, given a task (system text after the site's brief) and the page. */
export async function quickAsk<T>(task: string, tool: { name: string; description: string; input_schema: Record<string, any> }, page: string | Anthropic.ContentBlockParam[], maxTokens = 500): Promise<T> {
  const client = claudeClient();
  if (!client) throw new QuickError(NO_KEY, 503);
  const res = await client.messages.create({
    model: env('ANTHROPIC_SEO_MODEL') || 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system: `You write for "${site.name}", the ${site.organization} site. ${site.brief}\n${task} Use only facts in the page. American English.`,
    tools: [tool as any],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: page }],
  });
  const out = res.content.find((c) => c.type === 'tool_use')?.input as T | undefined;
  if (!out) throw new QuickError('No suggestion came back.', 502);
  return out;
}
