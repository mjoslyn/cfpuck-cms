import type { Data } from '@puckeditor/core';

export interface MediaSize {
  path: string;
  width?: number;
  height?: number;
  mime_type?: string;
  /** Modern-format copies of this size: { webp: path, avif: path }. */
  formats?: Record<string, string>;
}

export interface Media {
  id: number;
  path: string;
  /** When its files were last (re)made: a focal point change re-crops them under the same names. */
  processed_at?: string | null;
  mime_type: string;
  width: number | null;
  height: number | null;
  alt: string;
  caption: string;
  title: string;
  sizes: Record<string, MediaSize>;
  /** Point to keep in view when the image is cropped (0..1 from the top left). */
  focal_point?: { x: number; y: number } | null;
  /** Focal points for particular crop shapes ("1/1", "16/9", "4/3", "3/4"), overriding focal_point. */
  crop_focals?: Record<string, { x: number; y: number }> | null;
  /** Another image to show for a crop shape, wherever this one is cropped to it, and the focal point
   *  for that use (only there: the other image's own focal points are untouched). */
  crop_images?: Record<string, { id: number; focal?: { x: number; y: number } | null }> | null;
  /** The loaded rows of crop_images (attached by Loader.loadMedia; not stored). */
  crop_media?: Record<string, Media>;
  /** Modern-format copies of the full size. */
  formats?: Record<string, string>;
  /** The stored file's size in bytes (documents and videos; null for images processed before). */
  filesize?: number | null;
}

export interface Term {
  id: number;
  taxonomy: string;
  slug: string;
  name: string;
  description: string;
  parent_id: number | null;
  fields: Record<string, any>;
  /** Order among the terms beside it (lower first, then by name). */
  sort?: number;
}

export interface Entry {
  id: number;
  type: string;
  slug: string;
  title: string;
  title_rendered: string | null;
  excerpt: string;
  excerpt_rendered: string | null;
  status: 'publish' | 'draft' | 'private' | 'trash';
  template: string | null;
  parent_id: number | null;
  menu_order: number;
  featured_media_id: number | null;
  fields: Record<string, any>;
  content: Data | null;
  event_start: string | null;
  event_end: string | null;
  event_all_day: boolean | null;
  published_at: string;
  updated_at: string;
  /** Joined: term ids assigned to this entry, in order. */
  term_ids?: number[];
  /** Joined: path of the parent chain for hierarchical pages. */
  parent_slugs?: string[];
  /** Occurrence of a recurring event (Y-m-d); see lib/recurrence.ts. */
  occurrence?: string;
  /** Occurrence of a recurring event: the series' entry id. */
  series_id?: number;
  /** A members-only entry the viewer may not see (Loader.lockedEntry): its title, excerpt, image and access only. */
  locked?: boolean;
}

export const ENTRY_COLUMNS =
  'id, type, slug, title, title_rendered, excerpt, excerpt_rendered, status, template, parent_id, menu_order, featured_media_id, fields, event_start, event_end, event_all_day, published_at, updated_at';
