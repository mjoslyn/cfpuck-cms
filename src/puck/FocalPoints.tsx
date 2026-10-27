// Focal points per screen size for the Hero and Image blocks (attrs.focal, focalTablet, focalPhone):
// click the image to choose the part that stays in view on desktop, tablet or phone; a preview shows
// the crop at that size's shape. A size without its own falls back to the image's focal points from the
// media library (its point for the crop's shape, else its main point), as the renderer does.
import { useEffect, useRef, useState } from 'react';
import { browserClient } from '../lib/db/browser';
import { focalFor, type Point } from '../lib/media/focal';
import { FieldGroup, type Attrs } from './fields';

type SizeKey = 'focal' | 'focalTablet' | 'focalPhone';
const SIZES: { key: SizeKey; name: string }[] = [
  { key: 'focal', name: 'Desktop' },
  { key: 'focalTablet', name: 'Tablet' },
  { key: 'focalPhone', name: 'Phone' },
];
const pct = (p: Point) => `${Math.round(p.x * 100)}% ${Math.round(p.y * 100)}%`;
const isPoint = (p: unknown): p is Point => !!p && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y);

/** `ratios`: the crop's width / height on each size (desktop, tablet, phone), for the previews and the fallback. */
export function FocalPoints({ a, set, ratios, note }: { a: Attrs; set: (p: Attrs) => void; ratios: [number, number, number]; note?: string }) {
  const [size, setSize] = useState<SizeKey>('focal');
  // The image's own focal points, from the media library.
  const [media, setMedia] = useState<{ focal_point: Point | null; crop_focals: Record<string, Point> | null } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMedia(null);
    if (!a.mediaId) return;
    browserClient()
      .from('media')
      .select('focal_point, crop_focals')
      .eq('id', Number(a.mediaId))
      .maybeSingle()
      .then(({ data }) => setMedia((data as typeof media) ?? null));
  }, [a.mediaId]);
  if (!a.src) return null;

  const i = SIZES.findIndex((s) => s.key === size);
  const own = isPoint(a[size]) ? (a[size] as Point) : null;
  const fallback = media ? focalFor(media, ratios[i]) : null;
  const point = own ?? fallback ?? { x: 0.5, y: 0.5 };
  const pick = (e: React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect();
    const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    set({ [size]: { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) } });
  };

  return (
    <FieldGroup title="Focal point">
      <div className="mb-2 flex overflow-hidden rounded border border-admin-ink/15">
        {SIZES.map((s) => (
          <button key={s.key} type="button" aria-pressed={size === s.key} onClick={() => setSize(s.key)} className={`flex-1 border-l border-admin-ink/15 px-2 py-1 text-xs first:border-l-0 ${size === s.key ? 'bg-admin-ink text-white' : 'bg-white hover:text-admin-accent'}`}>
            {s.name}
            {isPoint(a[s.key]) ? ' •' : ''}
          </button>
        ))}
      </div>
      <div className="flex items-start gap-2">
        <div ref={box} className="relative min-w-0 flex-1 cursor-crosshair select-none" onClick={pick}>
          <img src={a.src} alt="" draggable={false} className="block w-full rounded" />
          <span className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(26,26,46,0.6)]" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />
        </div>
        <img src={a.src} alt="" title={`${SIZES[i].name} crop`} className="block h-20 max-w-[45%] shrink-0 rounded object-cover" style={{ aspectRatio: String(ratios[i]), objectPosition: pct(point) }} />
      </div>
      <p className="mt-1 text-xs text-admin-muted">
        Click the part that should stay in view on {SIZES[i].name.toLowerCase()} screens.{' '}
        {own ? (
          <button type="button" className="underline" onClick={() => set({ [size]: undefined })}>
            Use the image's own
          </button>
        ) : (
          `Now: the image's own focal point${fallback ? '' : ' (the centre)'}, from the media library.`
        )}
        {note ? ` ${note}` : ''}
      </p>
    </FieldGroup>
  );
}
