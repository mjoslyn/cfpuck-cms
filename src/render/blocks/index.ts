import { register, rendererFor } from '../engine';
import { EVENT_BLOCKS, eventsOn } from '../../lib/events/on';
import { eventDate } from '../events/date';
import { eventDetails, eventSchedule } from '../events/single';
import { renderCalendar, type Calendar } from '../events/calendar';
import { SITE_BLOCKS } from '../../lib/site/render';
import { eventCalendar } from '../events/event-calendar';
import { CONTENT_RENDERERS } from '../c/content';
import { ENTRY_RENDERERS } from '../c/entry';
import { COLLECTION_RENDERERS } from '../c/collection';
import { STRUCTURE_RENDERERS } from '../c/structure';
import { SEARCH_RENDERERS } from '../c/search';
import { FILTER_RENDERERS } from '../c/filters';
import { MAP_RENDERERS } from '../c/map';
import { NAVIGATION_RENDERERS } from '../c/navigation';
import { SOCIAL_RENDERERS } from '../c/social';
import { TICKETS_RENDERERS } from '../c/tickets';
import { MEMBERS_RENDERERS } from '../c/members';
import { embedForm } from '../forms/embed';
import type { FormRow } from '../../lib/forms/types';

register(
  {
    'event-date': eventDate,
    'event-details': eventDetails,
    'event-schedule': eventSchedule,
    // A form from /admin/forms/, by id.
    'form': (b, env) => {
      const row = (env.ctx.data.get('forms') as FormRow[] | undefined)?.find((f) => f.id === Number(b.attrs.formId));
      if (!row) return env.ctx.editor ? '<p style="padding:1rem;border:1px dashed #ccc">Choose a form in the block settings.</p>' : '';
      return embedForm(env, row, { title: !!b.attrs.showTitle, description: !!b.attrs.showDescription });
    },
    ...CONTENT_RENDERERS,
    ...ENTRY_RENDERERS,
    ...COLLECTION_RENDERERS,
    ...STRUCTURE_RENDERERS,
    ...SEARCH_RENDERERS,
    ...FILTER_RENDERERS,
    ...MAP_RENDERERS,
    ...NAVIGATION_RENDERERS,
    ...SOCIAL_RENDERERS,
    ...TICKETS_RENDERERS,
    ...MEMBERS_RENDERERS,
    // The site's own blocks (src/site/render.ts).
    ...Object.fromEntries(Object.entries(SITE_BLOCKS).map(([type, def]) => [type, def.render])),
  },
  // Unknown types render their children.
  (_b, _env, inner) => inner(),
);

// The calendars are prepared in prepare.ts (buildCalendar, event-calendar data).
register({ 'event-calendar': eventCalendar });
register({ 'events-calendar': (_b, env) => `<main class="c-cal-page">${renderCalendar(env.ctx.data.get('calendar') as Calendar, env.ctx.queried.url.origin)}</main>` });

// Event blocks while events are off (Settings > Events): nothing on the site, a note in the editor.
for (const type of EVENT_BLOCKS) {
  const render = rendererFor(type);
  register({ [type]: (b, env, inner) => (eventsOn(env.ctx.settings.site) ? render(b, env, inner) : env.ctx.editor ? '<div class="cms-editor-note">Events are off (Settings &gt; Events): this block shows nothing.</div>' : '') });
}
