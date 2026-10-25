// The site settings the editor needs, read once per page: Members (on or off, its levels: the entry
// settings' access, member ticket prices, the Members only block) and whether events are on (event and
// ticket blocks, the event type in pickers) and whether mailing is on (the Subscribe and Email preferences blocks).
import { useEffect, useState } from 'react';
import { browserClient } from '../lib/db/browser';
import { memberSettings, type MemberSettings } from '../lib/members/config';
import { eventsOn } from '../lib/events/on';
import { mailingOn } from '../lib/mailing/config';

let loading: Promise<Record<string, any> | null> | null = null;

export function useSite(): Record<string, any> | null | undefined {
  const [site, setSite] = useState<Record<string, any> | null | undefined>(undefined);
  useEffect(() => {
    loading ??= Promise.resolve(browserClient().from('settings').select('value').eq('key', 'site').maybeSingle()).then(({ data }) => data?.value ?? null, () => null);
    let live = true;
    loading.then((v) => live && setSite(v));
    return () => {
      live = false;
    };
  }, []);
  return site;
}

/** The member settings (null while loading). */
export function useMemberSettings(): MemberSettings | null {
  const site = useSite();
  return site === undefined ? null : memberSettings(site);
}

/** Whether events are on (null while loading). */
export function useEventsOn(): boolean | null {
  const site = useSite();
  return site === undefined ? null : eventsOn(site);
}

/** Whether mailing is on (null while loading). */
export function useMailingOn(): boolean | null {
  const site = useSite();
  return site === undefined ? null : mailingOn(site);
}
