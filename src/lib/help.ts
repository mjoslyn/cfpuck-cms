// The guides linked from the admin bar's help button: the Editor guide for editors and the Admin guide for
// admins (docs-site/src/content/docs/editors/ and admins/). HELP_URL points editors elsewhere, such as a
// site's own guide, and admins too unless ADMIN_HELP_URL points them somewhere else again.
import { env } from './env';

export const EDITOR_GUIDE = 'https://moonpuck.com/editors/';
export const ADMIN_GUIDE = 'https://moonpuck.com/admins/';

export const helpUrl = (isAdmin = false) =>
  isAdmin
    ? env('ADMIN_HELP_URL') || env('HELP_URL') || ADMIN_GUIDE
    : env('HELP_URL') || EDITOR_GUIDE;
