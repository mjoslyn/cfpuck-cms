// The site guide for editors and admins (docs-site/src/content/docs/guide/), linked from the admin bar's
// help button. HELP_URL points it elsewhere, such as a site's own guide.
import { env } from './env';

export const helpUrl = () => env('HELP_URL') || 'https://mjoslyn.github.io/cfpuck-cms/guide/';
