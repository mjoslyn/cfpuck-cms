// What one Compose message may carry. Past these, the rest is left out of the message and the
// conversation says so (a note), rather than dropping it unseen.

export const MESSAGE_LIMITS = { text: 20_000, docs: 10, media: 40, links: 20 };

export interface TakenMaterials {
  message: string;
  docs: File[];
  mediaIds: number[];
  links: string[];
  /** What was left out, for the conversation to show. */
  notes: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Reads a Compose message's text and materials from its form, keeping each within MESSAGE_LIMITS. */
export function takeMaterials(form: FormData): TakenMaterials {
  const text = String(form.get('message') ?? '');
  const allDocs = form.getAll('docs').filter((f): f is File => f instanceof File && f.size > 0);
  const allMedia = form.getAll('media').map(Number).filter(Boolean);
  const allLinks = String(form.get('links') ?? '').split(/\s+/).map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l));
  const L = MESSAGE_LIMITS;
  const notes: string[] = [];
  const over = (n: number, max: number, one: string, many: string) => {
    if (n > max) notes.push(`Only the first ${plural(max, one, many)} were added (${n - max} left out). Send the rest in another message.`);
  };
  over(allDocs.length, L.docs, 'document', 'documents');
  over(allMedia.length, L.media, 'image or video', 'images and videos');
  over(allLinks.length, L.links, 'link', 'links');
  if (text.length > L.text) notes.push(`Your message was cut to its first ${L.text.toLocaleString('en')} characters. Add long text as a document instead.`);
  return {
    message: text.slice(0, L.text),
    docs: allDocs.slice(0, L.docs),
    mediaIds: allMedia.slice(0, L.media),
    links: allLinks.slice(0, L.links),
    notes,
  };
}
