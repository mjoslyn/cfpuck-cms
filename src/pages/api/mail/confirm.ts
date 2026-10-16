// A sign-up's confirmation: the button on the page its emailed link opens (a GET never confirms: mail
// scanners follow links). On to the preferences page, signed for the person.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/supabase';
import { PREFERENCES_PATH } from '../../../lib/mailing/config';
import { confirm } from '../../../lib/mailing/contacts';
import { sign, verify } from '../../../lib/mailing/tokens';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const id = verify('confirm', form.get('confirm'));
  if (!id) return redirect(`${PREFERENCES_PATH}?error=${encodeURIComponent('That link isn’t valid. Sign up again for a new one.')}`, 303);
  const contact = await confirm(serviceClient(), id);
  if (!contact) return redirect(`${PREFERENCES_PATH}?error=${encodeURIComponent('That subscription no longer exists. Sign up again.')}`, 303);
  return redirect(`${PREFERENCES_PATH}?t=${sign('manage', id)}&m=confirmed`, 303);
};
