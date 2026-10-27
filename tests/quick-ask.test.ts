// Quick calls (SEO, excerpt, term texts, alt text) answer through structured outputs: newer models
// (Claude Sonnet 5.5, Opus 5.5, Fable 5.1) refuse a forced tool call, so the shape goes in
// output_config.format, closed and without the limits structured outputs doesn't take.
import { describe, expect, it } from 'vitest';
import { outputSchema, quickAnswer, QuickError } from '../src/lib/compose/quick';

describe('outputSchema', () => {
  it('closes every object and leaves out unsupported limits', () => {
    const s = outputSchema({
      type: 'object',
      required: ['title', 'tags'],
      properties: {
        title: { type: 'string', maxLength: 60, description: 'Up to 60 characters.' },
        tags: { type: 'array', maxItems: 3, items: { type: 'object', properties: { name: { type: 'string', minLength: 1 } } } },
      },
    });
    expect(s).toEqual({
      type: 'object',
      required: ['title', 'tags'],
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Up to 60 characters.' },
        tags: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } } } },
      },
    });
  });

  it('keeps a property named like a limit', () => {
    expect(outputSchema({ type: 'object', properties: { pattern: { type: 'string' } } })).toEqual({ type: 'object', additionalProperties: false, properties: { pattern: { type: 'string' } } });
  });
});

describe('quickAnswer', () => {
  const text = (t: string) => ({ type: 'text', text: t, citations: null }) as any;
  it('reads the JSON answer after any thinking', () => {
    expect(quickAnswer({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'x' } as any, text('{"alt":"A red barn"}')] })).toEqual({ alt: 'A red barn' });
  });
  it('says why there is no answer', () => {
    expect(() => quickAnswer({ stop_reason: 'refusal', content: [] })).toThrow(/declined/);
    expect(() => quickAnswer({ stop_reason: 'max_tokens', content: [text('{"alt":"A re')] })).toThrow(/cut off/);
    expect(() => quickAnswer({ stop_reason: 'end_turn', content: [text('not json')] })).toThrow(QuickError);
  });
});
