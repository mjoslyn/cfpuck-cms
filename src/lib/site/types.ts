// The shape of a site's configuration (src/site/config.ts). The core reads everything that differs
// between sites from it: identity, timezone, content types with their fields and URLs, taxonomies,
// and the brief Compose works from.

/** A field of an entry (stored in entries.fields under `key`), as the editor shows it. */
export type FieldDef =
  | ScalarField
  | { key: string; label: string; type: 'select'; options: [string, string][]; compose?: string }
  /** itemLabel: the item field shown as its title; itemName: what one item is called ("day": "Add day"). */
  | { key: string; label: string; type: 'repeater'; fields: FieldDef[]; itemLabel?: string; itemName?: string }
  /** Several entries of the given types, by id. */
  | { key: string; label: string; type: 'entries'; types: string[] }
  /** One entry of a type, by id; `create` lists the fields asked for when adding a new one inline. */
  | { key: string; label: string; type: 'entry'; entryType: string; create?: FieldDef[] };

export interface ScalarField {
  key: string;
  label: string;
  type: 'text' | 'url' | 'email' | 'textarea' | 'html' | 'bool' | 'image' | 'number';
  /**
   * Compose may fill this field from the editor's materials; the text tells Claude what it holds
   * (e.g. "phone number", "logo (image id)"). Fields without it are left to the editor.
   */
  compose?: string;
}

export interface ContentType {
  /** Stored in entries.type. `page`, `post` and `global` are required. `event` and `venue` come with the core's
   *  Events feature (Settings > Events); a site defines them only to change them. */
  type: string;
  /** Plural, for the admin list and listings ("Members"). */
  label: string;
  /** Singular ("Member"). */
  singular: string;
  /** URL segment for single entries: base "directory" serves /directory/<slug>/. Without it, entries live at the root. */
  base?: string;
  /** The type's listing page ("/directory/"). */
  archive?: string;
  /** Data only, with no page of its own; edited with a plain form (venues). */
  record?: boolean;
  /** No public page (globals, records). */
  pageless?: boolean;
  /** Left out of the admin's type tabs (e.g. types kept only for imported data). */
  hidden?: boolean;
  /** The type's main taxonomy ("member_category"): card labels, and the first offered to filter by. */
  category?: string;
  /** Its other taxonomies (tags apply to every type): each gets a picker in an entry's settings, and
   *  collections, filters and bulk actions offer them. */
  taxonomies?: string[];
  /** The type's own fields, shown in the editor's Details. */
  fields?: FieldDef[];
  /** For Compose: what an entry of this type is ("a member business's listing in the directory"). */
  describe?: string;
  /** An image field that is the entry's logo, used before the featured image when showing it (e.g. "logo"). */
  logoField?: string;
  /** The card design listings of this type default to (a card preset: "image", "event", "logo"...). Default "image". */
  card?: string;
  /** Default order when listing or searching this type: newest first ("date", default) or by name ("title"). */
  order?: 'date' | 'title';
}

export interface Taxonomy {
  /** Stored in terms.taxonomy. `category` and `tag` are required. */
  name: string;
  label: string;
  /** One term, as suggestions and filters name it ("Category"). Default: the label. */
  singular?: string;
  /** URL base for term pages: "directory/category" serves /directory/category/<slug>/. */
  base: string;
  /** The type a term page lists. Default: the one type filtered by this taxonomy (its `category`), else every type. */
  lists?: string;
  /** Its terms' own fields (stored in terms.fields under `key`), edited in each term's details and shown
   *  by the Field block on term pages. `template`, `image` and `seo` are reserved. */
  fields?: FieldDef[];
}

/** Compose's house style: the colors its sections use, as CSS values. Each defaults to a role token. */
export interface ComposeStyle {
  /** Section backgrounds: plain (the default band), tint and soft (light alternatives), dark (emphasis). */
  bands?: Partial<Record<ComposeBand, string>>;
  /** Body text on light bands (default var(--color-muted)). */
  body?: string;
  /** Text on dark bands (default var(--color-on-dark)). */
  onDark?: string;
  /** Eyebrows, the rule above headings and big numbers (default var(--color-accent)). */
  accent?: string;
  /** Card backgrounds on light bands (default var(--color-surface)). */
  card?: string;
  /** Other band names found in saved conversations (a site's older palette names), as the generic ones. */
  bandNames?: Record<string, ComposeBand>;
  /** Headings, quotes and big numbers (default var(--font-display)). */
  headingFont?: string;
  /** An accent rule between a section's eyebrow and its heading (default true). */
  rule?: boolean;
  /** Body text: size, weight, line height (default a fluid 14-18px, 300, 1.8). */
  bodySize?: string;
  bodyWeight?: string;
  bodyLineHeight?: string;
  /** A band's padding: above and below, and at the sides (default var(--space-80), var(--space-50)). */
  bandPadding?: { block?: string; inline?: string };
  /** Content widths: text (default 720px) and wide sections such as cards (default 1280px). */
  textWidth?: string;
  wideWidth?: string;
  /** Corner radius of cards and images (default 6px) and of buttons (default 2px). */
  radius?: string;
  buttonRadius?: string;
  /** Button labels in capitals, spaced (default true). */
  buttonCaps?: boolean;
}
export type ComposeBand = 'plain' | 'tint' | 'soft' | 'dark';

export interface SiteConfig {
  /** The site's name, as visitors see it ("This is Ellicottville"). */
  name: string;
  /** Who runs it ("Ellicottville Chamber of Commerce"): admin sign-in, mail sender name. */
  organization: string;
  /** IANA timezone for event times and dates ("America/New_York"). */
  timezone: string;
  /** Default From for outgoing mail (form notifications), overridden by MAIL_FROM. */
  mailFrom: string;
  /** Where form notifications go when a form doesn't say (FORMS_ADMIN_EMAIL overrides it). */
  adminEmail: string;
  /** What Compose knows about the site: who it is for, what it covers, its voice. A short paragraph. */
  brief: string;
  /** Compose's colors, when the site's differ from the role tokens. */
  compose?: ComposeStyle;
  types: ContentType[];
  taxonomies: Taxonomy[];
}

export const defineSite = (config: SiteConfig): SiteConfig => config;
