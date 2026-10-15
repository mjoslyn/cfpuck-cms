// Settings > Members (settings.site.members; src/lib/members/config.ts): Members on or off, the levels,
// whether visitors can sign up (and the level they get), and the message members-only things show to
// everyone else. The members themselves are managed on the Members screen.
import { Segmented, Select, Text, Toggle } from '../puck/fields';
import type { MemberLevel, MemberSettings } from '../lib/members/config';

const idFor = (name: string, taken: MemberLevel[]) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'level';
  let id = base;
  for (let n = 2; taken.some((l) => l.id === id); n++) id = `${base}-${n}`;
  return id;
};

export default function MemberSettingsPanel({ value, onChange }: { value: Partial<MemberSettings>; onChange: (v: Partial<MemberSettings>) => void }) {
  const set = (patch: Partial<MemberSettings>) => onChange({ ...value, ...patch });
  const levels = value.levels ?? [];
  const setLevel = (i: number, name: string) => set({ levels: levels.map((l, j) => (j === i ? { ...l, name } : l)) });
  return (
    <>
      <p className="mb-3 text-xs text-admin-muted">
        Members have an account on the site and a membership level. Pages can be for members only (in their settings), the Members only block shows its blocks to members, and ticket types can have member prices or be for members only.
      </p>
      <Toggle title="Members on" value={value.enabled} onChange={(enabled) => set({ enabled })} />
      {value.enabled && (
        <>
          <span className="mt-2 mb-1 block text-xs font-semibold tracking-wider text-admin-muted uppercase">Levels</span>
          <p className="mb-2 text-xs text-admin-muted">Pages, blocks and ticket prices can be for some levels. A level's name can change; removing one leaves its members without a level.</p>
          {levels.map((l, i) => (
            <div key={l.id} className="mb-2 flex items-center gap-2">
              <input aria-label="Level name" className="w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm" value={l.name} onChange={(e) => setLevel(i, e.target.value)} />
              <button type="button" className="text-xs text-[#c4592a]" onClick={() => confirm(`Remove the level “${l.name}”?`) && set({ levels: levels.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="mb-4 rounded-sm border border-admin-ink/20 px-2 py-1 text-xs font-semibold hover:border-admin-ink/50"
            onClick={() => {
              const name = prompt('Level name (e.g. Business, Individual, Patron)')?.trim();
              if (name) set({ levels: [...levels, { id: idFor(name, levels), name }] });
            }}
          >
            Add level
          </button>
          <Segmented
            title="Sign-ups"
            value={value.signup ?? 'off'}
            options={[['off', 'Admins add members'], ['approve', 'Sign up, then approved'], ['open', 'Sign up and join']]}
            onChange={(signup) => set({ signup: signup as MemberSettings['signup'] })}
          />
          {value.signup && value.signup !== 'off' && levels.length > 0 && (
            <Select title="Level for sign-ups" value={value.signupLevel ?? levels[0].id} options={levels.map((l) => [l.id, l.name] as [string, string])} onChange={(signupLevel) => set({ signupLevel })} />
          )}
          <Text title="Message for visitors who can't see members-only things" value={value.message} placeholder="This is for members." onChange={(message) => set({ message: message || undefined })} />
          <p className="text-xs text-admin-muted">
            Members sign in and sign up at <a className="underline" href="/account/" target="_blank">/account/</a>. Their links (set a password, confirm an address) go there, so Supabase Auth's redirect URLs must include this site's address.
          </p>
        </>
      )}
    </>
  );
}
