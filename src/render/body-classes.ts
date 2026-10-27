// Classes on <body>: what kind of page this is, for page-specific styles.
import type { Queried } from './env';

export function bodyClasses(q: Queried): string {
  const c: string[] = [];
  const e = q.entry;
  if (q.kind === 'singular' && e) {
    c.push('is-single', `type-${e.type}`);
    if (q.isFront) c.push('is-front');
    if (q.notFound) c.push('is-404');
    if (e.template && e.template !== 'default') c.push(`template-${e.template.replace(/[/.]/g, '-')}`);
  } else if (q.kind === 'archive') {
    c.push('is-archive', `archive-${q.postType}`);
  } else if (q.kind === 'taxonomy' && q.term) {
    c.push('is-archive', `taxonomy-${q.term.taxonomy}`, `term-${q.term.slug}`);
  } else if (q.kind === 'search') {
    c.push('is-search');
  } else if (q.kind === '404') {
    c.push('is-404');
  }
  if (q.page > 1) c.push('is-paged');
  return c.join(' ');
}
