// The site's configuration: identity, content types (fields, URLs, what Compose may fill) and
// taxonomies. The core reads it through src/lib/site; see src/lib/site/types.ts for every option.
// Events (the event and venue types, event categories) come with the core: turn them on under
// Settings > Events; define them here only to change them.
// This is the example site: replace it with your own.
import { defineSite } from '../lib/site/types';

export default defineSite({
  name: 'Example Town',
  organization: 'Example Town Chamber of Commerce',
  timezone: 'America/New_York',
  mailFrom: 'Example Town <noreply@example.org>',
  adminEmail: 'info@example.org',
  brief: 'The Example Town Chamber of Commerce site: things to do, events and news for visitors and the businesses that serve them.',

  types: [
    { type: 'page', label: 'Pages', singular: 'Page', describe: 'a page on the site' },
    { type: 'post', label: 'Posts', singular: 'Post', archive: '/news/', category: 'category', describe: 'a news post (listed with the site news)' },
    { type: 'organizer', label: 'Organizers', singular: 'Organizer', base: 'organizer', record: true, hidden: true },
    { type: 'global', label: 'Globals', singular: 'Global', pageless: true },
  ],

  taxonomies: [
    { name: 'category', label: 'Category', base: 'category' },
    { name: 'tag', label: 'Tag', base: 'tag' },
  ],
});
