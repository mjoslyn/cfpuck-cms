// The compose conversation with Claude. Each turn sends the whole conversation (materials with the
// turn they were added in); Claude either answers in text (a question, a note) or calls build_page
// with the complete revised page plan.
import Anthropic from '@anthropic-ai/sdk';
import { PLAN_SCHEMA, UPDATE_FIELDS_SCHEMA, type PagePlan } from './spec';
import { EDIT_SCHEMA, COMPONENT_GUIDE } from './edit';
import { SEARCH_SCHEMA } from './site';
import { site, typeLabel, ARCHIVE_PATHS, CONTENT_TYPES, LISTABLE_TYPES } from '../site';

/** The listable types, in words ("events, members, posts"). */
const LISTED = LISTABLE_TYPES.map((t) => CONTENT_TYPES.find((c) => c.type === t)?.label.toLowerCase() ?? t).join(', ');
import { describeEntryType } from './entry-fields';

type Block = Anthropic.Messages.ContentBlockParam;

import { claudeClient, env, NO_KEY } from './client';
export { env };
export const COMPOSE_MODEL = env('ANTHROPIC_MODEL') || 'claude-sonnet-5-5';

export interface UserTurn {
  role: 'user';
  text: string;
  /** Registry refs added with this message. */
  added: string[];
  /** A block selected in the editor for a targeted edit (its component data, as JSON). */
  target?: { id: string; label: string; json: string };
  at: string;
}
export interface AssistantTurn {
  role: 'assistant';
  text: string;
  /** build_page: the page plan. */
  plan?: PagePlan;
  /** edit_block: the replacement blocks for the target. */
  edit?: { targetId: string; blocks: unknown[] };
  /** update_fields: the changed fields, as Claude sent them. */
  fields?: Record<string, unknown>;
  tool?: 'build_page' | 'edit_block' | 'update_fields';
  toolId?: string;
  at: string;
}
export type Turn = UserTurn | AssistantTurn;

export interface ConverseRequest {
  turns: Turn[];
  /** Claude input for each user turn's added materials, by turn index. */
  materialBlocks: Map<number, Block[]>;
  entryType: string;
  /** What else is on the page (content not built by this conversation), as an outline. */
  otherContent?: string;
  /** The composed sections as they are now on the page, including the editor's manual edits. */
  currentSections?: string;
  sitePages: { title: string; path: string }[];
  tags: string[];
  /** The entry's own fields as they are now. */
  currentFields?: string;
}

function system(r: ConverseRequest): string {
  return `You build and revise web pages for "${site.name}", the ${site.organization} site. ${site.brief}

${describeEntryType(r.entryType, typeLabel(r.entryType))}

You are in a conversation with a site editor. They give you a brief and materials (documents, images, videos, links), and later ask for changes.
- To create the page or change it broadly, call build_page with the COMPLETE page plan (every section, not just the changed ones).
- When the message comes with a selected block, change just that block: call edit_block with its replacement (same component format as the selected block). Use build_page only if they clearly ask for page-wide changes.
- To feature or link to the site's own content (${LISTED}, pages), call search_site first and use what it returns: real titles, URLs, dates, contact details, images (by their image ids) and entry ids for listings. Never invent entries.
- You may add one or two sentences of text saying what you did. If a request is unclear, ask one short question in text instead of calling a tool.
- Keep what the editor did not ask to change. If the page's current sections (shown with the latest message) differ from your last plan, the editor edited them by hand: keep those edits.

${COMPONENT_GUIDE}

SEO: every build_page includes seo. Write the title and description for people searching: say what the page is about in the words they would search with, and give a reason to visit. No clickbait, no keyword stuffing, no invented facts.

Writing: clear, warm, specific American English. Use only facts from the materials or the conversation: never invent prices, dates, phone numbers, addresses, names, statistics or quotes. Short paragraphs, short concrete headings.

Layout: ${r.entryType === 'page' && !r.otherContent ? 'start with a hero (use the most striking image, if any); then' : 'no hero (the page has its own title and content);'} 3 to 8 sections that suit the material: text, media_text (alternate image sides), cards, gallery, video, quote, stats, faq, cta, and listing (a live list of the site's ${LISTED}) when it helps. Alternate light backgrounds (plain, soft, tint); dark at most once or twice. Use provided images and videos by their ids (image-1, video-1...); never invent ids. Link to provided links or the site's paths below; end with a call to action when there is a natural next step.
${r.otherContent ? `\nThe page also has other content that is not yours to change; your sections go after it:\n${r.otherContent}\n` : ''}
Site pages you may link to:
${r.sitePages.map((p) => `- ${p.title}: ${p.path}`).join('\n')}
Main listings: ${CONTENT_TYPES.filter((t) => ARCHIVE_PATHS[t.type]).map((t) => `${ARCHIVE_PATHS[t.type]} (${t.label.toLowerCase()})`).join(', ')}.
${r.tags.length ? `Existing tags (for listing.tag): ${r.tags.join(', ')}` : ''}`;
}

/** The API messages for the conversation so far. */
function messages(r: ConverseRequest): Anthropic.Messages.MessageParam[] {
  const out: Anthropic.Messages.MessageParam[] = [];
  let pendingTool: string | undefined;
  r.turns.forEach((t, i) => {
    if (t.role === 'assistant') {
      const content: Block[] = [];
      if (t.text) content.push({ type: 'text', text: t.text });
      const input = t.tool === 'edit_block' ? { blocks: t.edit?.blocks ?? [] } : t.tool === 'update_fields' ? { fields: t.fields ?? {} } : t.plan;
      if (input && t.toolId) content.push({ type: 'tool_use', id: t.toolId, name: t.tool ?? 'build_page', input });
      out.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(no reply)' }] });
      pendingTool = input && t.toolId ? t.toolId : undefined;
      return;
    }
    const content: Block[] = [];
    if (pendingTool) content.push({ type: 'tool_result', tool_use_id: pendingTool, content: 'Applied and shown to the editor.' });
    pendingTool = undefined;
    const last = i === r.turns.length - 1;
    const intro = i === 0 ? `Create a new ${typeLabel(r.entryType).toLowerCase()}.\n\n` : '';
    // Only the latest message carries its selected block: an earlier one was answered with an edit (in
    // the reply that follows it), and re-sending every past block grew each request without end.
    const target = !t.target ? '' : last ? `\n\nSelected block (${t.target.label}), to change with edit_block:\n${t.target.json}` : `\n\n(The block selected then was: ${t.target.label}.)`;
    content.push({ type: 'text', text: `${intro}${t.text || '(no message)'}${target}` });
    const mats = r.materialBlocks.get(i) ?? [];
    if (mats.length) content.push({ type: 'text', text: 'Materials added:' }, ...mats);
    out.push({ role: 'user', content });
  });
  // Cache everything up to the latest message's own content for the next turn. The page's current
  // state follows the breakpoint: it is only sent with the latest message, so keeping it out of the
  // cached prefix lets the next turn read this message back unchanged.
  const lastTurn = out.length - 1;
  const blocks = out[lastTurn].content as Block[];
  (blocks[blocks.length - 1] as any).cache_control = { type: 'ephemeral', ttl: '1h' };
  if (lastTurn > 0) {
    if (r.currentSections) blocks.push({ type: 'text', text: `The page's sections as they are now:\n${r.currentSections}` });
    if (r.currentFields) blocks.push({ type: 'text', text: `Its fields now:\n${r.currentFields}` });
  }
  return out;
}

export interface ConverseResult {
  text: string;
  plan?: PagePlan;
  edit?: { blocks: unknown[] };
  fields?: Record<string, unknown>;
  tool?: 'build_page' | 'edit_block' | 'update_fields';
  toolId?: string;
}

export interface ConverseHooks {
  status: (t: string) => void;
  text: (chunk: string) => void;
  /** Runs search_site; returns the tool result (JSON). */
  search: (input: Record<string, any>) => Promise<{ results: unknown[]; summary: string }>;
}

export async function converse(r: ConverseRequest, on: ConverseHooks): Promise<ConverseResult> {
  const client = claudeClient();
  if (!client) throw new Error(NO_KEY);
  const tools: Anthropic.Messages.Tool[] = [
    { name: 'build_page', description: 'Lay out the complete page: title, slug, excerpt and every section from top to bottom.', input_schema: PLAN_SCHEMA as any },
    { name: 'edit_block', description: 'Replace the selected block with new blocks (same component format as the selected block).', input_schema: EDIT_SCHEMA as any },
    { name: 'update_fields', description: "Change the entry's own fields (contact details, dates...) without rebuilding the page. Send only the changed fields.", input_schema: UPDATE_FIELDS_SCHEMA as any },
    { name: 'search_site', description: `Search the site's own content (${LISTED}, pages) to feature or link to it.`, input_schema: SEARCH_SCHEMA as any },
  ];
  const msgs = messages(r);
  let spoken = '';

  // Searches are answered here and the conversation continues until Claude builds, edits or replies.
  for (let round = 0; round < 6; round++) {
    const stream = client.messages.stream({
      model: COMPOSE_MODEL,
      max_tokens: 16000,
      system: [{ type: 'text', text: system(r), cache_control: { type: 'ephemeral', ttl: '1h' } }],
      tools,
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      messages: msgs,
    });
    let sections = 0;
    let announced = false;
    stream.on('text', (chunk) => {
      spoken += chunk;
      on.text(chunk);
    });
    stream.on('inputJson', (_partial, snapshot) => {
      const s = snapshot as Partial<PagePlan> | undefined;
      const count = s?.sections?.length ?? 0;
      if (!announced && count > 0 && s?.title) {
        announced = true;
        on.status(`Laying out "${s.title}"`);
      }
      if (count > sections) {
        sections = count;
        const kind = s!.sections![count - 1]?.kind;
        on.status(`Section ${count}${kind ? `: ${String(kind).replace('_', ' ')}` : ''}`);
      }
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'max_tokens') throw new Error('The reply was too long and got cut off; try a narrower request.');
    const tool = message.content.find((c) => c.type === 'tool_use');
    if (tool && tool.type === 'tool_use' && tool.name === 'search_site') {
      const input = tool.input as Record<string, any>;
      on.status(`Looking up ${Array.isArray(input.types) && input.types.length ? input.types.join(', ') : 'site content'}${input.query ? ` for "${input.query}"` : ''}${input.tag ? ` tagged ${input.tag}` : ''}`);
      const found = await on.search(input);
      on.status(`Found ${found.summary}`);
      msgs.push({ role: 'assistant', content: message.content as any });
      msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(found.results) }] });
      if (spoken && !spoken.endsWith('\n')) {
        spoken += '\n\n';
        on.text('\n\n');
      }
      continue;
    }
    const text = spoken.trim() || message.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
    if (tool && tool.type === 'tool_use' && tool.name === 'build_page') {
      const plan = tool.input as PagePlan;
      if (!Array.isArray(plan.sections) || !plan.sections.length) throw new Error('The page plan had no sections.');
      return { text, plan, tool: 'build_page', toolId: tool.id };
    }
    if (tool && tool.type === 'tool_use' && tool.name === 'edit_block') {
      const blocks = (tool.input as any)?.blocks;
      if (!Array.isArray(blocks)) throw new Error('The edit had no blocks.');
      return { text, edit: { blocks }, tool: 'edit_block', toolId: tool.id };
    }
    if (tool && tool.type === 'tool_use' && tool.name === 'update_fields') {
      const fields = (tool.input as any)?.fields;
      if (!fields || typeof fields !== 'object') throw new Error('The field update was empty.');
      return { text, fields, tool: 'update_fields', toolId: tool.id };
    }
    return { text: text || 'I have nothing to change.' };
  }
  throw new Error('Claude kept searching without finishing; try a more specific request.');
}
