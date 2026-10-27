// Keeping pages out of AI answer engines: what "Hide from search engines and AI answer engines" (an
// entry's or term's SEO noindex) does beyond the robots meta tag. The crawlers that feed AI answers
// follow robots.txt rather than tags in the page, so /robots.txt (src/pages/robots.txt.ts) disallows
// those pages for each of them; the tag also says `noai, noimageai` for the tools that read it. Search
// engines' own crawlers (Googlebot, Bingbot) aren't disallowed: they must fetch the page to see noindex.

/** User agents of the crawlers that gather pages for AI models and answer engines. */
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'meta-externalagent',
  'Amazonbot',
  'Bytespider',
  'CCBot',
  'cohere-ai',
];

/** robots.txt: the admin kept out for everyone, and the given paths for the AI crawlers. */
export function robotsTxt(noAiPaths: string[]): string {
  const lines = ['User-agent: *', 'Disallow: /admin/', 'Disallow: /api/'];
  const paths = [...new Set(noAiPaths)].sort();
  if (paths.length) {
    lines.push('', ...AI_CRAWLERS.map((a) => `User-agent: ${a}`), ...paths.map((p) => `Disallow: ${p}`));
  }
  return `${lines.join('\n')}\n`;
}
