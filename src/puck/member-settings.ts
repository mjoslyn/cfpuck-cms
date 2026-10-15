// The member settings in the editor (Settings > Members): whether Members is on and its levels, for the
// entry settings' access, member ticket prices and the Members only block. Read once per page.
import { useEffect, useState } from 'react';
import { browserClient } from '../lib/supabase-browser';
import { memberSettings, type MemberSettings } from '../lib/members/config';

let loading: Promise<MemberSettings> | null = null;

export function useMemberSettings(): MemberSettings | null {
  const [s, setS] = useState<MemberSettings | null>(null);
  useEffect(() => {
    loading ??= Promise.resolve(browserClient().from('settings').select('value').eq('key', 'site').maybeSingle()).then(({ data }) => memberSettings(data?.value));
    let live = true;
    loading.then((v) => live && setS(v), () => live && setS(memberSettings(null)));
    return () => {
      live = false;
    };
  }, []);
  return s;
}
