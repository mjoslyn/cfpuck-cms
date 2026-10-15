// The Members only block's settings: which levels see its blocks, and what everyone else sees.
import { Text, Toggle, type Attrs } from './fields';
import { useMemberSettings } from './member-settings';

export function MembersPanel({ a, set }: { a: Attrs; set: (patch: Attrs) => void }) {
  const s = useMemberSettings();
  const chosen: string[] = Array.isArray(a.levels) ? a.levels : [];
  return (
    <>
      {s && !s.enabled && <p className="mb-3 rounded bg-admin-soft p-2 text-xs text-admin-muted">Members is off (Settings &gt; Members): only editors see these blocks.</p>}
      {s && s.levels.length > 0 && (
        <fieldset className="mb-3">
          <legend className="mb-1 text-xs font-medium text-admin-muted">Members of (none ticked: any level)</legend>
          {s.levels.map((l) => (
            <label key={l.id} className="mr-3 inline-flex items-center gap-1 text-sm">
              <input type="checkbox" checked={chosen.includes(l.id)} onChange={(e) => set({ levels: e.target.checked ? [...chosen, l.id] : chosen.filter((x) => x !== l.id) || undefined })} />
              {l.name}
            </label>
          ))}
        </fieldset>
      )}
      <Toggle title="Show nothing to everyone else" value={a.hide} onChange={(hide) => set({ hide: hide || undefined })} />
      {!a.hide && <Text title="Message for everyone else" value={a.message} placeholder={s?.message || 'This is for members.'} onChange={(v) => set({ message: v || undefined })} />}
      <p className="mb-2 text-xs text-admin-muted">
        Put blocks inside it. Members (and editors) see them; everyone else sees the message and a sign-in link. The page isn't cached, since it depends on who is looking. These blocks are part of the page's
        data, which the site's database API shares like any published page; for anything confidential, make the whole page members only (its settings).
      </p>
    </>
  );
}
