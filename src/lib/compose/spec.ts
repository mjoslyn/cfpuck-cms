// The page plan Claude returns (tool input): a title and a list of sections of known kinds. The builder
// (build.ts) turns it into the site's components, so the page follows the site's design.
import { LISTABLE_TYPES, typeDef } from '../site';
import { CARD_IDS } from '../content/card-presets';

/** The types a listing can show, as Claude is told (read at the time of use: admins add types). */
const listed = () => LISTABLE_TYPES.map((t) => typeDef(t)?.label.toLowerCase() ?? t).join(', ');

export type SectionKind = 'hero' | 'text' | 'media_text' | 'cards' | 'gallery' | 'video' | 'quote' | 'cta' | 'faq' | 'stats' | 'listing';
export type Background = 'plain' | 'tint' | 'soft' | 'dark';

export interface PlanButton {
  label: string;
  url: string;
  style?: 'primary' | 'outline';
}

export interface PlanSection {
  kind: SectionKind;
  background?: Background;
  eyebrow?: string;
  heading?: string;
  /** Simple Markdown: paragraphs, **bold**, *italic*, [links](url), "- " or "1. " lists, "### " subheadings. */
  body?: string;
  /** Material ids ("image-1"). */
  image?: string;
  image_side?: 'left' | 'right';
  images?: string[];
  gallery_display?: 'grid' | 'masonry' | 'slider';
  /** Material id of an uploaded video or a video link ("video-1"). */
  video?: string;
  /** Several videos: shown as a video gallery (gallery_display applies). */
  videos?: string[];
  caption?: string;
  cards?: { title: string; body?: string; image?: string; link_url?: string; link_label?: string }[];
  items?: { question: string; answer: string }[];
  stats?: { value: string; label: string }[];
  quote?: string;
  citation?: string;
  buttons?: PlanButton[];
  listing?: { content_type: string; ids?: number[]; count?: number; tag?: string; card?: string; upcoming?: boolean; display?: 'grid' | 'list' | 'slider'; shuffle?: boolean };
}

export interface PagePlan {
  title: string;
  slug: string;
  excerpt: string;
  sections: PlanSection[];
  /** The entry's own fields (types with fields in the site config); see entry-fields.ts. */
  fields?: Record<string, unknown>;
  /** Search and social card text, and the share image (a material id). */
  seo?: { title?: string; description?: string; image?: string };
}

const str = (description: string) => ({ type: 'string', description });

const FIELDS_SCHEMA = { type: 'object', description: "The entry's own fields, for types other than pages and posts (keys as listed in the instructions).", additionalProperties: { type: ['string', 'boolean'] } } as const;

/** JSON schema of the update_fields tool. */
export const UPDATE_FIELDS_SCHEMA = { type: 'object', required: ['fields'], properties: { fields: FIELDS_SCHEMA } } as const;

/** JSON schema of the build_page tool (a function: the types it names are read when it is sent). */
export const planSchema = () => ({
  type: 'object',
  required: ['title', 'slug', 'excerpt', 'seo', 'sections'],
  properties: {
    title: str('Page title (plain text).'),
    slug: str('URL slug: lowercase words joined by hyphens.'),
    excerpt: str('One or two sentences summarising the page, for listings and search results.'),
    fields: FIELDS_SCHEMA,
    seo: {
      type: 'object',
      description: 'What search results and social cards show for the page.',
      required: ['title', 'description'],
      properties: {
        title: str('Search title, 30 to 60 characters: the page\'s subject first, specific, no site name (it is added).'),
        description: str('Meta description, 120 to 155 characters: what the page offers and why to visit it, in plain active words, with the main search phrase.'),
        image: str('Material id of the best image for social cards (landscape, the subject clear). Pick one whenever the materials include images.'),
      },
    },
    sections: {
      type: 'array',
      description: 'The page from top to bottom.',
      items: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: {
            type: 'string',
            enum: ['hero', 'text', 'media_text', 'cards', 'gallery', 'video', 'quote', 'cta', 'faq', 'stats', 'listing'],
            description:
              'hero: big opening (the site\'s Hero block) with eyebrow, heading, one or two sentences of plain text, optional background image and up to two buttons. text: heading and body. media_text: image beside heading/body/buttons. cards: a grid of 2-4 cards (title, body, image, link). gallery: several images. video: one video (video), or several shown as a video gallery (videos), with heading and caption. quote: a pull quote. cta: short call to action with buttons. faq: questions and answers. stats: 2-4 big numbers with labels. listing: live list of the site\'s own ' + listed() + '.',
          },
          background: { type: 'string', enum: ['plain', 'tint', 'soft', 'dark'], description: 'Band color. Alternate the light bands (plain, tint, soft); use dark sparingly for emphasis.' },
          eyebrow: str('Short label above the heading (optional).'),
          heading: str('Section heading.'),
          body: str('Simple Markdown: paragraphs separated by blank lines, **bold**, *italic*, [link](url), "- " bullet lists, "1. " numbered lists, "### " subheadings.'),
          image: str('Material id of an image, e.g. "image-1".'),
          image_side: { type: 'string', enum: ['left', 'right'] },
          images: { type: 'array', items: { type: 'string' }, description: 'Material ids of images (gallery).' },
          gallery_display: { type: 'string', enum: ['grid', 'masonry', 'slider'], description: 'Gallery and video gallery layout: grid (default; images cropped to one shape), masonry (columns keeping each image\'s or video\'s shape; good for mixed portrait and landscape), slider (a row that scrolls; good for many).' },
          video: str('Material id of a video, e.g. "video-1".'),
          videos: { type: 'array', items: { type: 'string' }, description: 'Material ids of several videos (video section as a video gallery).' },
          caption: str('Caption (video, gallery).'),
          cards: {
            type: 'array',
            items: { type: 'object', required: ['title'], properties: { title: str('Card title'), body: str('Short text'), image: str('Material id of an image'), link_url: str('Link'), link_label: str('Link text') } },
          },
          items: { type: 'array', items: { type: 'object', required: ['question', 'answer'], properties: { question: str('Question'), answer: str('Answer (simple Markdown)') } } },
          stats: { type: 'array', items: { type: 'object', required: ['value', 'label'], properties: { value: str('The number, e.g. "17+"'), label: str('What it counts') } } },
          quote: str('Quote text.'),
          citation: str('Who said it.'),
          buttons: {
            type: 'array',
            items: { type: 'object', required: ['label', 'url'], properties: { label: str('Button text'), url: str('Link: a provided link, a site path like /events/, or mailto:/tel:'), style: { type: 'string', enum: ['primary', 'outline'] } } },
          },
          listing: {
            type: 'object',
            required: ['content_type'],
            properties: {
              content_type: { type: 'string', enum: LISTABLE_TYPES },
              ids: { type: 'array', items: { type: 'integer' }, description: 'Hand-picked entries, in order (ids from search_site). Without ids the listing shows the latest (or upcoming).' },
              count: { type: 'integer', minimum: 1, maximum: 12 },
              tag: str('Only entries with this tag (existing tag name).'),
              card: { type: 'string', enum: CARD_IDS },
              upcoming: { type: 'boolean', description: 'Events: only upcoming ones.' },
              display: { type: 'string', enum: ['grid', 'list', 'slider'], description: 'grid (default), list (one per row; suits the title card), or slider (a row that scrolls; suits many logos or cards).' },
              shuffle: { type: 'boolean', description: 'Show a random selection, different on each visit (count of them from the matching entries); good for sponsors and partners.' },
            },
          },
        },
      },
    },
  },
}) as const;
