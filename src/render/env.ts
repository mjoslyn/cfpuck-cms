import type { Loader, QueryResult } from '../lib/data';
import type { Entry, Term } from '../lib/types';
import type { PuckItem } from '../lib/puck/types';
import type { Viewer } from '../lib/members/config';

/** What this request asks for: an entry, a listing (archive or term), search results or nothing (404). */
export interface Queried {
  kind: 'singular' | 'archive' | 'taxonomy' | 'search' | '404';
  /** The search terms (/search/?q=). */
  search?: string;
  entry?: Entry;
  postType?: string;
  term?: Term;
  page: number;
  url: URL;
  isFront?: boolean;
  /** The site's Not found page (Settings), shown at an address with nothing there: answered with 404. */
  notFound?: boolean;
  /** Canonical location to redirect to (recurring event series -> next occurrence). */
  redirect?: string;
}

export interface RenderCtx {
  loader: Loader;
  queried: Queried;
  settings: Record<string, any>;
  /** Query loop results keyed by the query block's id (inherit queries use the main query). */
  queries: Map<string, QueryResult>;
  /** Resolved documents: "part:header", "pattern:<slug>", "block:<entry id>", "content:<entry id>". */
  docs: Map<string, PuckItem[]>;
  /** Per-instance CSS (core-block-supports equivalent), in document order. */
  css: string[];
  /** Asset groups the page needs: forms, leaflet, swiper, ... */
  assets: Set<string>;
  /** Per-block prepared data keyed by "<kind>:<block id>". */
  data: Map<string, any>;
  /** Block types rendered on the page, in render order. */
  rendered: string[];
  /** Page-specific footer scripts, in order. */
  scripts: string[];
  /** Page-specific <head> scripts (deferred block scripts). */
  headScripts?: string[];
  /** Rendering inside the visual editor (show placeholders for unconfigured blocks). */
  editor?: boolean;
  /** Who is viewing (src/lib/members/viewer.ts): set only when the page is rendered again for a signed-in visitor. */
  viewer?: Viewer | null;
  /** The page depends on who views it (members-only content, member prices, the account page): it is
   *  never cached, and is rendered again for a signed-in visitor. Set by prepare. */
  personal?: boolean;
}

export interface QueryEnv {
  blockId: string;
  attrs: Record<string, any>;
  result: QueryResult;
  page: number;
}

/** Context passed down while rendering (the current entry, query, layout...). */
export interface Env {
  ctx: RenderCtx;
  post: Entry | null;
  query: QueryEnv | null;
  parentLayout: Record<string, any> | null;
  /** collection-items renders Swiper slides (slider display). */
  slider?: boolean;
  /** Inside a collection's card (collection-items), where a featured image gets the card height. */
  inCard?: boolean;
  /** Section blocks: the block's attrs stand in for the page's fields. */
  sectionFields?: Record<string, any>;
  /** Where images in static markup come from (template | content | part-<area>), for loading attributes. */
  imgCtx?: string;
  /** Aspect ratio a gallery sets for its images ("3/2"). */
  imageRatio?: string;
  /** Editor only: HTML placed where the queried entry's content renders (the Puck content slot). */
  contentSlot?: string;
  /** Context of the enclosing loop block (query, queryId, displayLayout, cardStyle). */
  loop?: { blockId: string; query: Record<string, any>; queryId: number; displayLayout: Record<string, any>; cardStyle: Record<string, any> };
}

export interface Block {
  type: string;
  id: string;
  attrs: Record<string, any>;
  html?: string[] | null;
  saved?: (string | null)[] | null;
  children?: PuckItem[];
}

/** Renders the block's inner blocks, optionally overriding context (e.g. per loop item). */
export type Inner = ((env?: Partial<Env>) => string) & {
  /** One string per inner block, for interleaving with saved HTML chunks. */
  each: (env?: Partial<Env>) => string[];
};

export type Renderer = (b: Block, env: Env, inner: Inner) => string;
