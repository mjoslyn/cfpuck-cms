// Editor panels for the content blocks (src/render/c/content.ts). Values are stored as CSS, with the
// design tokens as var(--color-*), var(--space-*), var(--text-*), var(--font-*).
import type { ReactNode } from 'react';
import { Code, MediaModal, MediaPicker, RichText, Row, Segmented, Select, Text, Toggle, inputClass, type Attrs, FieldGroup } from './fields';
import { videoEmbedAttrs } from '../lib/media/video-link';
import { PRESETS as themeJson } from '../lib/site';
import { site } from '../lib/site';
import { LIST_ICONS, iconSvg } from '../render/c/icons';
import { useEffect, useState } from 'react';
import { browserClient } from '../lib/db/browser';
import { FocalPoints } from './FocalPoints';
import { parseRatio } from '../lib/media/focal';

type SetFn = (patch: Attrs) => void;
export type Panel = (a: Attrs, set: SetFn) => ReactNode;

const COLORS = themeJson.colors.map((c) => ({ value: `var(--color-${c.slug})`, name: c.name, hex: c.color }));
const SPACE = themeJson.spacing.map((s) => [`var(--space-${s.slug})`, `${s.name} (${s.size})`] as [string, string]);
const SIZES = themeJson.fontSizes.map((f) => [`var(--text-${f.slug})`, f.name] as [string, string]);
const WEIGHTS: [string, string][] = [['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold']];

/** Crop shapes offered for images (the first four have their own focal points in the media library). */
/** The image sizes the editor offers, by their stored names (the files made for each upload). */
export const IMAGE_SIZES: [string, string][] = [
  ['full', 'Full (the original)'],
  ['large', 'Large (1024px)'],
  ['medium_large', 'Medium (768px)'],
  ['medium', 'Small (300px)'],
  ['thumbnail', 'Thumbnail (150px square)'],
];

export const ASPECTS: [string, string][] = [
  ['1/1', 'Square (1:1)'],
  ['16/9', 'Wide (16:9)'],
  ['4/3', 'Landscape (4:3)'],
  ['3/4', 'Portrait (3:4)'],
  ['3/2', 'Photo (3:2)'],
  ['2/3', 'Tall (2:3)'],
  ['21/9', 'Cinema (21:9)'],
  ['3/1', 'Banner (3:1)'],
  ['9/16', 'Story (9:16)'],
];
const ratioOf = (v: unknown): number | null => {
  const m = String(v ?? '').trim().match(/^(\d+(?:\.\d+)?)(?:\s*[/:]\s*(\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const r = Number(m[1]) / Number(m[2] ?? 1);
  return Number.isFinite(r) && r > 0 ? r : null;
};

/**
 * Aspect ratio as a dropdown. Stored as "w/h" text (images) or a number (embeds, `numeric`); a saved
 * value that isn't in the list stays selectable as "Custom".
 */
export function AspectSelect({ title, value, onChange, numeric, originalLabel = 'Original' }: { title: string; value: unknown; onChange: (v: string | number | undefined) => void; numeric?: boolean; originalLabel?: string }) {
  const r = ratioOf(value);
  const match = r ? ASPECTS.find(([k]) => Math.abs((ratioOf(k) ?? 0) - r) < 0.01)?.[0] : undefined;
  const current = match ?? (r ? `custom:${value}` : '');
  return (
    <Row title={title}>
      <select
        className={inputClass}
        value={current}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return onChange(undefined);
          if (v.startsWith('custom:')) return;
          onChange(numeric ? Number((ratioOf(v) ?? 1).toFixed(4)) : v);
        }}
      >
        <option value="">{originalLabel}</option>
        {ASPECTS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
        {current.startsWith('custom:') && <option value={current}>Custom ({String(value)})</option>}
      </select>
    </Row>
  );
}

/** A titled, collapsible group of settings; open unless `open={false}`. */
export function Group({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="mb-2 border-t border-admin-ink/10 pt-2">
      <summary className="mb-2 cursor-pointer text-[11px] font-semibold tracking-wider text-admin-muted uppercase">{title}</summary>
      {children}
    </details>
  );
}

/** Palette swatches plus a free CSS colour. */
export function Color({ title, value, onChange }: { title: string; value: string | undefined; onChange: (v: string | undefined) => void }) {
  const custom = value && !COLORS.some((c) => c.value === value) ? value : '';
  return (
    <FieldGroup title={title}>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => onChange(undefined)} className={`h-6 w-6 rounded-full border text-[10px] ${!value ? 'ring-2 ring-admin-accent' : 'border-admin-ink/20'}`} title="Default">
          /
        </button>
        {COLORS.map((c) => (
          <button key={c.value} type="button" title={c.name} onClick={() => onChange(c.value)} className={`h-6 w-6 rounded-full border border-admin-ink/20 ${value === c.value ? 'ring-2 ring-admin-accent ring-offset-1' : ''}`} style={{ background: c.hex }} />
        ))}
        <input className={`${inputClass} w-24 py-0.5 text-xs`} placeholder="#hex" value={custom} onChange={(e) => onChange(e.target.value || undefined)} />
      </div>
    </FieldGroup>
  );
}

/** A spacing token or a custom CSS length. */
export function Space({ title, value, onChange }: { title: string; value: string | undefined; onChange: (v: string | undefined) => void }) {
  const isToken = !value || SPACE.some(([v]) => v === value);
  return (
    <Row title={title}>
      <select className={inputClass} value={isToken ? value ?? '' : '__custom'} onChange={(e) => onChange(e.target.value === '__custom' ? value || '1rem' : e.target.value || undefined)}>
        <option value="">None</option>
        {SPACE.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
        <option value="__custom">Custom</option>
      </select>
      {!isToken && <input className={`${inputClass} mt-1`} value={value} onChange={(e) => onChange(e.target.value || undefined)} />}
    </Row>
  );
}

const setIn = (a: Attrs, key: string, patch: Record<string, unknown>): Attrs => {
  const next = { ...(a[key] ?? {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
  return { [key]: Object.keys(next).length ? next : undefined };
};

type StyleParts = { colors?: boolean; background?: boolean; spacing?: boolean; typography?: boolean; border?: boolean; width?: boolean };

/** Colour, spacing, typography, border and width controls shared by the blocks. */
export function StyleControls({ a, set, parts = {} }: { a: Attrs; set: SetFn; parts?: StyleParts }) {
  const s = a.style ?? {};
  const st = (patch: Record<string, unknown>) => set(setIn(a, 'style', patch));
  const side = (key: 'padding' | 'margin', k: string, v: string | undefined) => st({ [key]: { ...(s[key] ?? {}), [k]: v } });
  const p = { colors: true, background: true, spacing: true, typography: false, border: true, width: true, ...parts };
  return (
    <>
      {p.width && <Select title="Width" value={a.width} options={[['wide', 'Wide'], ['full', 'Full width']]} onChange={(v) => set({ width: v })} />}
      {p.colors && (
        <Group title="Color">
          <Color title="Text" value={s.color} onChange={(v) => st({ color: v })} />
          {p.background && <Color title="Background" value={s.background} onChange={(v) => st({ background: v })} />}
          <Color title="Links" value={s.linkColor} onChange={(v) => st({ linkColor: v })} />
        </Group>
      )}
      {p.typography && (
        <Group title="Text">
          <Select title="Size" value={s.fontSize} options={SIZES} onChange={(v) => st({ fontSize: v })} />
          <Select title="Font" value={s.fontFamily} options={[['var(--font-display)', 'Display (Fraunces)'], ['var(--font-body)', 'Body (Work Sans)']]} onChange={(v) => st({ fontFamily: v })} />
          <Select title="Weight" value={s.fontWeight} options={WEIGHTS} onChange={(v) => st({ fontWeight: v })} />
          <Select title="Alignment" value={s.textAlign} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} onChange={(v) => st({ textAlign: v })} />
          <Select title="Case" value={s.textTransform} options={[['uppercase', 'Uppercase'], ['none', 'As typed']]} onChange={(v) => st({ textTransform: v })} />
          <Text title="Letter spacing" value={s.letterSpacing} placeholder="0.06em" onChange={(v) => st({ letterSpacing: v || undefined })} />
          <Text title="Line height" value={s.lineHeight} placeholder="1.6" onChange={(v) => st({ lineHeight: v || undefined })} />
        </Group>
      )}
      {p.spacing && (
        <Group title="Spacing">
          <div className="grid grid-cols-2 gap-x-2">
            {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
              <Space key={k} title={`Padding ${k}`} value={s.padding?.[k]} onChange={(v) => side('padding', k, v)} />
            ))}
            <Space title="Margin top" value={s.margin?.top} onChange={(v) => side('margin', 'top', v)} />
            <Space title="Margin bottom" value={s.margin?.bottom} onChange={(v) => side('margin', 'bottom', v)} />
          </div>
        </Group>
      )}
      {p.border && (
        <Group title="Border">
          <Text title="Corner radius" value={typeof s.radius === 'string' ? s.radius : ''} placeholder="6px" onChange={(v) => st({ radius: v || undefined })} />
          <Text title="Border width" value={s.borderWidth} placeholder="1px" onChange={(v) => st({ borderWidth: v || undefined })} />
          <Color title="Border color" value={s.borderColor} onChange={(v) => st({ borderColor: v })} />
        </Group>
      )}
      <Text title="CSS class" value={a.className} onChange={(v) => set({ className: v || undefined })} />
    </>
  );
}

const LAYOUTS: [string, string][] = [
  ['flow', 'Stacked'],
  ['constrained', 'Stacked, centred content width'],
  ['row', 'Row'],
  ['stack', 'Column (flex)'],
  ['grid', 'Grid'],
];

/** Content widths for constrained layouts; the default is the site's --content-size (720px). */
const CONTENT_WIDTHS: [string, string][] = [
  ['560px', 'Narrow (560px)'],
  ['640px', 'Reading (640px)'],
  ['800px', 'Medium (800px)'],
  ['960px', 'Large (960px)'],
  ['1120px', 'Extra large (1120px)'],
  ['1280px', 'Wide (1280px)'],
  ['100%', 'Full width'],
];

function WidthSelect({ value, onChange }: { value: unknown; onChange: (v: string | undefined) => void }) {
  const v = typeof value === 'string' ? value.trim() : '';
  const custom = v && v !== '720px' && !CONTENT_WIDTHS.some(([k]) => k === v);
  return (
    <Row title="Content width">
      <select className={inputClass} value={v === '720px' ? '' : v} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Standard (720px)</option>
        {CONTENT_WIDTHS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
        {custom && <option value={v}>Custom ({v})</option>}
      </select>
    </Row>
  );
}

function LayoutControls({ a, set }: { a: Attrs; set: SetFn }) {
  const l = a.layout ?? { type: 'flow' };
  const lt = (patch: Record<string, unknown>) => set(setIn(a, 'layout', patch));
  return (
    <Group title="Layout" open>
      <Select title="Arrange children" value={l.type ?? 'flow'} options={LAYOUTS} onChange={(v) => lt({ type: v ?? 'flow' })} />
      {l.type === 'constrained' && <WidthSelect value={l.contentSize} onChange={(v) => lt({ contentSize: v })} />}
      {(l.type === 'row' || l.type === 'stack') && (
        <>
          <Select title="Justify" value={l.justify} options={[['left', 'Start'], ['center', 'Center'], ['right', 'End'], ['space-between', 'Space between']]} onChange={(v) => lt({ justify: v })} />
          <Select title="Align" value={l.align} options={[['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom'], ['stretch', 'Stretch']]} onChange={(v) => lt({ align: v })} />
          <Toggle title="Wrap onto new lines" value={l.wrap !== false} onChange={(v) => lt({ wrap: v ? undefined : false })} />
        </>
      )}
      {l.type === 'grid' && (
        <>
          <Text title="Columns" value={l.columns} placeholder="Automatic" onChange={(v) => lt({ columns: Number(v) || undefined })} />
          <Text title="Minimum column width" value={l.minColumnWidth} placeholder="12rem" onChange={(v) => lt({ minColumnWidth: v || undefined })} />
        </>
      )}
      <Space title="Gap between children" value={typeof a.gap === 'string' ? a.gap : a.gap?.row} onChange={(v) => set({ gap: v })} />
    </Group>
  );
}

const imagePicker = (a: Attrs, set: SetFn) => (
  <MediaPicker title="Image" url={a.src} onSelect={(m) => set({ mediaId: m.mediaId ?? undefined, src: m.url, alt: a.alt || m.alt || undefined, focal: undefined, focalTablet: undefined, focalPhone: undefined })} />
);

export const CONTENT_PANELS: Record<string, Panel> = {
  section: (a, set) => (
    <>
      <Select title="Element" value={a.tag} options={[['section', 'section'], ['main', 'main'], ['header', 'header'], ['footer', 'footer'], ['aside', 'aside'], ['article', 'article']]} onChange={(v) => set({ tag: v })} />
      <LayoutControls a={a} set={set} />
      <StyleControls a={a} set={set} />
    </>
  ),
  columns: (a, set) => (
    <>
      <Space title="Gap" value={typeof a.gap === 'string' ? a.gap : a.gap?.column} onChange={(v) => set({ gap: v })} />
      <Select title="Vertical alignment" value={a.verticalAlign} options={[['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom']]} onChange={(v) => set({ verticalAlign: v })} />
      <Toggle title="Keep side by side on phones" value={a.unstacked} onChange={(v) => set({ unstacked: v || undefined })} />
      <StyleControls a={a} set={set} />
    </>
  ),
  column: (a, set) => (
    <>
      <Text title="Width" value={a.basis} placeholder="Automatic (e.g. 33.33%)" onChange={(v) => set({ basis: v || undefined })} />
      <Select title="Vertical alignment" value={a.verticalAlign} options={[['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom'], ['stretch', 'Stretch']]} onChange={(v) => set({ verticalAlign: v })} />
      <Space title="Gap between blocks" value={typeof a.gap === 'string' ? a.gap : undefined} onChange={(v) => set({ gap: v })} />
      <StyleControls a={a} set={set} parts={{ width: false }} />
    </>
  ),
  text: (a, set) => (
    <>
      <RichText title="Text" value={a.content} onChange={(v) => set({ content: v })} />
      <StyleControls a={a} set={set} parts={{ typography: true, border: false, width: false }} />
    </>
  ),
  heading: (a, set) => (
    <>
      <Select title="Level" value={String(a.level ?? 2)} options={[['1', 'H1'], ['2', 'H2'], ['3', 'H3'], ['4', 'H4'], ['5', 'H5'], ['6', 'H6']]} onChange={(v) => set({ level: Number(v) || 2 })} />
      <RichText title="Text" value={a.content} onChange={(v) => set({ content: v })} />
      <StyleControls a={a} set={set} parts={{ typography: true, border: false, width: false }} />
    </>
  ),
  image: (a, set) => (
    <>
      {imagePicker(a, set)}
      <Text title="Alt text (describes the image)" value={a.alt} onChange={(v) => set({ alt: v || undefined })} />
      <RichText title="Caption" value={a.caption ?? ''} onChange={(v) => set({ caption: v || undefined })} />
      <Text title="Link" value={a.href} placeholder="https://" onChange={(v) => set({ href: v || undefined })} />
      {a.href && <Toggle title="Open link in a new tab" value={a.target === '_blank'} onChange={(v) => set({ target: v ? '_blank' : undefined, rel: v ? 'noopener' : undefined })} />}
      <Select title="Placement" value={a.align} options={[['left', 'Float left'], ['right', 'Float right'], ['center', 'Centred'], ['wide', 'Wide'], ['full', 'Full width']]} onChange={(v) => set({ align: v })} />
      {a.mediaId && <Select title="Image size" value={a.size} options={IMAGE_SIZES} onChange={(v) => set({ size: v })} />}
      <AspectSelect title="Aspect ratio" value={a.aspectRatio === 'auto' ? undefined : a.aspectRatio} onChange={(v) => set({ aspectRatio: (v as string) || undefined })} />
      <Select title="Fit" value={a.scale} options={[['cover', 'Cover (crop to fill)'], ['contain', 'Contain (show the whole image)']]} onChange={(v) => set({ scale: v })} />
      <p className="-mt-2 mb-3 text-xs text-admin-muted">Default: cropped to fill a set aspect ratio, else the image as it is. Cover and Contain also fill the block's space (a column, a card).</p>
      <Toggle title="Circle" value={a.variant === 'circle'} onChange={(v) => set({ variant: v ? 'circle' : undefined })} />
      <Toggle title="Fill the block behind the content" value={!!a.cover} onChange={(v) => set({ cover: v || undefined })} />
      <Toggle title="Shade (darker towards the bottom)" value={!!a.shade} onChange={(v) => set({ shade: v || undefined })} />
      {(parseRatio(a.aspectRatio) || a.cover || a.scale === 'cover') && (
        <FocalPoints a={a} set={set} ratios={[parseRatio(a.aspectRatio) ?? 4 / 3, parseRatio(a.aspectRatio) ?? 4 / 3, parseRatio(a.aspectRatio) ?? 4 / 3]} />
      )}
      <StyleControls a={a} set={set} parts={{ colors: false, spacing: true, width: false }} />
    </>
  ),
  buttons: (a, set) => (
    <>
      <Select title="Justify" value={a.justify} options={[['left', 'Start'], ['center', 'Center'], ['right', 'End'], ['space-between', 'Space between']]} onChange={(v) => set({ justify: v })} />
      <Toggle title="Stack vertically" value={a.vertical} onChange={(v) => set({ vertical: v || undefined })} />
      <Space title="Gap" value={typeof a.gap === 'string' ? a.gap : undefined} onChange={(v) => set({ gap: v })} />
    </>
  ),
  button: (a, set) => (
    <>
      <Text title="Label" value={a.text} onChange={(v) => set({ text: v })} />
      <Text title="Link" value={a.href} placeholder="/plan-your-trip/" onChange={(v) => set({ href: v || undefined })} />
      <Toggle title="Open in a new tab" value={a.target === '_blank'} onChange={(v) => set({ target: v ? '_blank' : undefined, rel: v ? 'noopener' : undefined })} />
      <Select title="Style" value={a.variant} options={[['outline', 'Outline']]} onChange={(v) => set({ variant: v })} />
      <Select title="Width" value={a.widthPct ? String(a.widthPct) : undefined} options={[['25', '25%'], ['50', '50%'], ['75', '75%'], ['100', '100%']]} onChange={(v) => set({ widthPct: v ? Number(v) : undefined })} />
      <StyleControls a={a} set={set} parts={{ typography: true, spacing: false, width: false }} />
    </>
  ),
  list: (a, set) => <ListPanel a={a} set={set} />,
  'list-item': (a, set) => <RichText title="Item" value={a.content} onChange={(v) => set({ content: v })} />,
  quote: (a, set) => (
    <>
      <RichText title="Citation" value={a.citation ?? ''} onChange={(v) => set({ citation: v || undefined })} />
      <StyleControls a={a} set={set} parts={{ typography: true }} />
    </>
  ),
  separator: (a, set) => (
    <>
      <Select title="Style" value={a.variant} options={[['long', 'Full width line'], ['dots', 'Dots']]} onChange={(v) => set({ variant: v })} />
      <StyleControls a={a} set={set} parts={{ spacing: true, border: false, colors: true }} />
    </>
  ),
  spacer: (a, set) => <Text title="Height" value={a.height} placeholder="100px" onChange={(v) => set({ height: v || '100px' })} />,
  cover: (a, set) => (
    <>
      {imagePicker(a, set)}
      <Toggle title="Use the page's featured image" value={a.useFeaturedImage} onChange={(v) => set({ useFeaturedImage: v || undefined })} />
      <Text title="Alt text" value={a.alt} onChange={(v) => set({ alt: v || undefined })} />
      {!a.useFeaturedImage && <FocalPoints a={a} set={set} ratios={[16 / 9, 3 / 4, 3 / 4]} />}
      <Color title="Overlay color" value={a.overlay} onChange={(v) => set({ overlay: v })} />
      <Segmented title="Overlay" value={a.overlayStyle ?? 'solid'} options={[['solid', 'Even'], ['bottom', 'From bottom'], ['left', 'From left']]} onChange={(v) => set({ overlayStyle: v === 'solid' ? undefined : v })} />
      <p className="-mt-2 mb-3 text-xs text-admin-muted">A gradient keeps text readable where it sits and leaves the rest of the picture clear.</p>
      <Row title={`Overlay opacity (${a.dim ?? (a.overlayStyle ? 80 : 50)}%)`}>
        <input type="range" min={0} max={100} step={10} className="w-full" value={a.dim ?? (a.overlayStyle ? 80 : 50)} onChange={(e) => set({ dim: Number(e.target.value) })} />
      </Row>
      <Text title="Minimum height" value={a.minHeight} placeholder="430px" onChange={(v) => set({ minHeight: v || undefined })} />
      <Select
        title="Content position"
        value={a.position}
        options={[['top-left', 'Top left'], ['top-center', 'Top'], ['top-right', 'Top right'], ['center-left', 'Left'], ['center-right', 'Right'], ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom'], ['bottom-right', 'Bottom right']]}
        onChange={(v) => set({ position: v })}
      />
      <Toggle title="Dark text (light image)" value={a.light} onChange={(v) => set({ light: v || undefined })} />
      <LayoutControls a={a} set={set} />
      <StyleControls a={a} set={set} parts={{ background: false }} />
    </>
  ),
  hero: (a, set) => (
    <>
      <MediaPicker title="Image" url={a.src} onSelect={(m) => set({ mediaId: m.mediaId ?? undefined, src: m.url, focal: undefined, focalTablet: undefined, focalPhone: undefined })} />
      <FocalPoints a={a} set={set} ratios={[16 / 9, 3 / 4, 3 / 4]} />
      <Segmented title="Overlay (keeps the text readable)" value={a.overlay ?? 'medium'} options={[['none', 'None'], ['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong']]} onChange={(v) => set({ overlay: v === 'medium' ? undefined : v })} />
      {a.overlay !== 'none' && <Segmented title="Darkest at" value={a.overlayFrom ?? 'bottom'} options={[['bottom', 'Bottom'], ['left', 'Left'], ['even', 'All over']]} onChange={(v) => set({ overlayFrom: v === 'bottom' ? undefined : v })} />}
      <Text title="Eyebrow" value={a.eyebrow} placeholder="(none)" onChange={(v) => set({ eyebrow: v || undefined })} />
      <Text title="Title" value={a.title} onChange={(v) => set({ title: v || undefined })} />
      <Row title="Text">
        <textarea className={inputClass} rows={4} value={a.text ?? ''} onChange={(e) => set({ text: e.target.value || undefined })} />
      </Row>
      <Text title="Button label" value={a.primaryLabel} placeholder="(no button)" onChange={(v) => set({ primaryLabel: v || undefined })} />
      <Text title="Button link" value={a.primaryHref} placeholder="/plan-your-trip/" onChange={(v) => set({ primaryHref: v || undefined })} />
      <Text title="Second button label" value={a.secondaryLabel} placeholder="(no button)" onChange={(v) => set({ secondaryLabel: v || undefined })} />
      <Text title="Second button link" value={a.secondaryHref} placeholder="/experiences/" onChange={(v) => set({ secondaryHref: v || undefined })} />
      <Segmented title="Height" value={a.height ?? 'screen'} options={[['screen', 'Full screen'], ['large', 'Large'], ['medium', 'Medium']]} onChange={(v) => set({ height: v === 'screen' ? undefined : v })} />
      <Toggle title="Title is the page's main heading (h1)" value={a.level !== 2} onChange={(v) => set({ level: v ? undefined : 2 })} />
    </>
  ),
  gallery: (a, set) => <GalleryPanel a={a} set={set} />,
  'video-gallery': (a, set) => <GalleryPanel a={a} set={set} video />,
  embed: (a, set) => (
    <>
      <Text title="URL" value={a.url} onChange={(v) => set({ url: v })} />
      <Code title="Embed HTML" value={a.html ?? ''} rows={6} onChange={(v) => set({ html: v })} />
      <AspectSelect title="Aspect ratio" numeric originalLabel="Provider's size" value={a.ratio} onChange={(v) => set({ ratio: (v as number) || undefined })} />
    </>
  ),
  html: (a, set) => <Code title="HTML" value={a.html ?? ''} rows={14} onChange={(v) => set({ html: v })} />,
  'media-text': (a, set) => (
    <>
      {imagePicker(a, set)}
      <Select title="Image side" value={a.mediaPosition} options={[['right', 'Right']]} onChange={(v) => set({ mediaPosition: v })} />
      <Text title="Image width (%)" value={a.mediaWidth} placeholder="50" onChange={(v) => set({ mediaWidth: Number(v) || undefined })} />
      <Segmented title="Text position" value={a.verticalAlign === 'top' || a.verticalAlign === 'bottom' ? a.verticalAlign : 'center'} options={[['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom']]} onChange={(v) => set({ verticalAlign: v === 'center' ? undefined : v })} />
      <Toggle title="Stack on phones" value={a.stack !== false} onChange={(v) => set({ stack: v ? undefined : false })} />
      <StyleControls a={a} set={set} />
    </>
  ),
};

const linkControls = (a: Attrs, set: SetFn, what: string) => (
  <>
    <Toggle title={`Link to the ${what}`} value={a.link} onChange={(v) => set({ link: v || undefined })} />
    {a.link && <Toggle title="Open in a new tab" value={a.target === '_blank'} onChange={(v) => set({ target: v ? '_blank' : undefined })} />}
  </>
);

Object.assign(CONTENT_PANELS, {
  'entry-title': (a: Attrs, set: SetFn) => (
    <>
      <Select title="Level" value={String(a.level ?? 2)} options={[0, 1, 2, 3, 4, 5, 6].map((n) => [String(n), n ? `H${n}` : 'Paragraph'] as [string, string])} onChange={(v) => set({ level: Number(v ?? 2) })} />
      {linkControls(a, set, 'entry')}
      <StyleControls a={a} set={set} parts={{ typography: true, width: false }} />
    </>
  ),
  'entry-excerpt': (a: Attrs, set: SetFn) => (
    <>
      <Text title="Word limit" value={a.length} placeholder="55" onChange={(v) => set({ length: Number(v) || undefined })} />
      <Text title="Read more text" value={a.moreText} onChange={(v) => set({ moreText: v || undefined })} />
      <StyleControls a={a} set={set} parts={{ typography: true, width: false }} />
    </>
  ),
  'entry-date': (a: Attrs, set: SetFn) => (
    <>
      <Text title="Date format" value={a.format} placeholder="F j, Y" onChange={(v) => set({ format: v || undefined })} />
      <Toggle title="Last updated date" value={a.modified} onChange={(v) => set({ modified: v || undefined })} />
      {linkControls(a, set, 'entry')}
      <StyleControls a={a} set={set} parts={{ typography: true, width: false }} />
    </>
  ),
  'entry-terms': (a: Attrs, set: SetFn) => (
    <>
      <Select title="Taxonomy" value={a.taxonomy} options={site.taxonomies.map((t) => [t.name, t.label])} onChange={(v) => set({ taxonomy: v })} />
      <Text title="Separator" value={a.separator} placeholder=", " onChange={(v) => set({ separator: v || undefined })} />
      <StyleControls a={a} set={set} parts={{ typography: true, width: false }} />
    </>
  ),
  'entry-image': (a: Attrs, set: SetFn) => (
    <>
      {linkControls(a, set, 'entry')}
      <AspectSelect title="Aspect ratio" value={a.aspectRatio === 'auto' ? undefined : a.aspectRatio} onChange={(v) => set({ aspectRatio: (v as string) || undefined })} />
      <Text title="Height" value={a.height} placeholder="200px" onChange={(v) => set({ height: v || undefined })} />
      <Select title="Fit" value={a.scale} options={[['cover', 'Cover (crop to fill)'], ['contain', 'Contain (show the whole image)']]} onChange={(v) => set({ scale: v })} />
      <p className="-mt-2 mb-3 text-xs text-admin-muted">Default: a set aspect ratio or height is filled (cropped; a logo field's image is shown whole), else the image as it is. Cover and Contain also fill the block's space (a card, a column).</p>
      <Select title="Image size" value={a.size} options={IMAGE_SIZES} onChange={(v) => set({ size: v })} />
      <Toggle title="Fill the card behind the content" value={!!a.cover} onChange={(v) => set({ cover: v || undefined })} />
      <p className="-mt-2 mb-3 text-xs text-admin-muted">The image covers the block it is in (a card), with the rest of the card over it at the bottom. Give the card a minimum height.</p>
      <Toggle title="Shade (darker towards the bottom)" value={!!a.shade} onChange={(v) => set({ shade: v || undefined })} />
      <Row title={`Overlay (${a.dim ?? 0}%)`}>
        <input type="range" min={0} max={100} step={10} className="w-full" value={a.dim ?? 0} onChange={(e) => set({ dim: Number(e.target.value) || undefined })} />
      </Row>
      <StyleControls a={a} set={set} parts={{ colors: false }} />
    </>
  ),
  'entry-content': (a: Attrs, set: SetFn) => (
    <>
      <Text title="Content area" value={a.area} placeholder="main" onChange={(v) => set({ area: v ? v.toLowerCase().replace(/[^a-z0-9-]+/g, '-') : undefined })} />
      <p className="-mt-2 mb-3 text-xs text-admin-muted">main (the default) is the page's own content. Another name (sidebar, intro...) is a separate area each page using this template fills in. Each Page content block needs its own area: a second one left as main is named area-2 when you save.</p>
      <LayoutControls a={a} set={set} />
    </>
  ),
  // Columns, spacing and the card design are the collection's settings.
  'collection-items': () => <p className="mb-2 text-xs text-admin-muted">The card repeated for each entry. Columns, spacing and the card design are in the collection's settings; select a block inside the first card to change the card.</p>,
  'collection-empty': (a: Attrs, set: SetFn) => <StyleControls a={a} set={set} />,
  pagination: (a: Attrs, set: SetFn) => (
    <>
      <Select title="Justify" value={a.justify} options={[['left', 'Start'], ['center', 'Center'], ['right', 'End'], ['space-between', 'Space between']]} onChange={(v) => set({ justify: v })} />
      <Select title="Arrows" value={a.arrow} options={[['arrow', 'Arrow'], ['chevron', 'Chevron']]} onChange={(v) => set({ arrow: v })} />
    </>
  ),
  'pagination-next': (a: Attrs, set: SetFn) => <Text title="Label" value={a.label} placeholder="Next Page" onChange={(v) => set({ label: v || undefined })} />,
  'pagination-previous': (a: Attrs, set: SetFn) => <Text title="Label" value={a.label} placeholder="Previous Page" onChange={(v) => set({ label: v || undefined })} />,
  'pagination-numbers': (a: Attrs, set: SetFn) => <Text title="Pages either side of the current one" value={a.midSize} placeholder="2" onChange={(v) => set({ midSize: Number(v) || undefined })} />,
  'social-links': (a: Attrs, set: SetFn) => (
    <>
      <p className="mb-3 text-xs text-admin-muted">The links come from Settings &gt; Social.</p>
      <Text title="Icon size (px)" value={a.size} placeholder="22" onChange={(v) => set({ size: Number(v) || undefined })} />
      <Select title="Alignment" value={a.justify} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} onChange={(v) => set({ justify: v })} />
      <Toggle title="Show the network names" value={!!a.showLabels} onChange={(v) => set({ showLabels: v || undefined })} />
      <StyleControls a={a} set={set} parts={{ typography: true, width: false }} />
    </>
  ),
  navigation: (a: Attrs, set: SetFn) => (
    <>
      <p className="mb-3 text-xs text-admin-muted">The site's menu: edit its items under Settings &gt; Menu. Items with links, an intro or cards open a panel; on small screens a menu button shows the list.</p>
      <Toggle title="Search button" value={a.search !== false} onChange={(v) => set({ search: v ? undefined : false })} />
      <Text title="Name for screen readers" value={a.label} placeholder="Primary" onChange={(v) => set({ label: v || undefined })} />
    </>
  ),
  'site-title': (a: Attrs, set: SetFn) => (
    <>
      <p className="mb-3 text-xs text-admin-muted">The site's icon and name (Settings), linking to the home page.</p>
      <Toggle title="Icon" value={a.icon !== false} onChange={(v) => set({ icon: v ? undefined : false })} />
      <Toggle title="Name" value={a.name !== false} onChange={(v) => set({ name: v ? undefined : false })} />
      {a.name !== false && <Text title="Before the name" value={a.prefix} placeholder="e.g. Welcome to " onChange={(v) => set({ prefix: v || undefined })} />}
    </>
  ),
  map: (a: Attrs, set: SetFn) => (
    <>
      <p className="mb-3 text-xs text-admin-muted">Pins for the published entries of a type that have coordinates (OpenStreetMap). Each pin links to its entry.</p>
      <Select title="Show" value={a.postType} options={site.types.filter((t) => !t.hidden).map((t) => [t.type, t.label] as [string, string])} onChange={(v) => set({ postType: v || undefined })} />
      <Select title="Follow the Filters block's" value={a.taxonomy} options={site.taxonomies.map((t) => [t.name, t.label] as [string, string])} onChange={(v) => set({ taxonomy: v || undefined })} />
      <Toggle title="Only featured entries until filtered" value={!!a.featuredFirst} onChange={(v) => set({ featuredFirst: v || undefined })} />
      <Text title="Center (latitude, longitude)" value={a.center} placeholder="All pins in view" onChange={(v) => set({ center: v || undefined })} />
      <Text title="Zoom (1-19)" value={a.zoom} placeholder="14" onChange={(v) => set({ zoom: Number(v) || undefined })} />
      <Text title="Height" value={a.height} placeholder="500px" onChange={(v) => set({ height: v || undefined })} />
      <FieldGroup title="Fields">
        <Text title="Latitude field" value={a.latField} placeholder="latitude" onChange={(v) => set({ latField: v || undefined })} />
        <Text title="Longitude field" value={a.lngField} placeholder="longitude" onChange={(v) => set({ lngField: v || undefined })} />
        <Text title="Address field (popup)" value={a.addressField} placeholder="address" onChange={(v) => set({ addressField: v || undefined })} />
        <Text title="Leave out when this field is on" value={a.excludeField} placeholder="none" onChange={(v) => set({ excludeField: v || undefined })} />
      </FieldGroup>
    </>
  ),
  'collection-filters': (a: Attrs, set: SetFn) => (
    <>
      <p className="mb-3 text-xs text-admin-muted">Filters the page's listing (on a listing, category or search page): a search box, a category's terms to add as filters, and the count. The listing updates as they change.</p>
      <Toggle title="Search box" value={a.search !== false} onChange={(v) => set({ search: v ? undefined : false })} />
      {a.search !== false && (
        <>
          <Text title="Search placeholder" value={a.placeholder} placeholder="Search…" onChange={(v) => set({ placeholder: v || undefined })} />
          <Toggle title="Suggestions as you type" value={a.suggest !== false} onChange={(v) => set({ suggest: v ? undefined : false })} />
        </>
      )}
      <Select title="Filter by" value={a.taxonomy} options={site.taxonomies.map((t) => [t.name, t.label] as [string, string])} onChange={(v) => set({ taxonomy: v || undefined })} />
      {a.taxonomy && <Text title="Dropdown placeholder" value={a.termPlaceholder} placeholder={`All ${(site.taxonomies.find((t) => t.name === a.taxonomy)?.label ?? '').toLowerCase()}`} onChange={(v) => set({ termPlaceholder: v || undefined })} />}
      <Toggle title="Show the count" value={a.count !== false} onChange={(v) => set({ count: v ? undefined : false })} />
      <FieldGroup title="Addresses">
        <p className="mb-2 text-xs text-admin-muted">The query-string names the filters use, e.g. to keep older links working.</p>
        {a.search !== false && <Text title="Search parameter" value={a.searchParam} placeholder="search" onChange={(v) => set({ searchParam: v.replace(/[^\w-]/g, '') || undefined })} />}
        {a.taxonomy && <Text title="Filter parameter" value={a.termParam} placeholder={a.taxonomy} onChange={(v) => set({ termParam: v.replace(/[^\w-]/g, '') || undefined })} />}
      </FieldGroup>
    </>
  ),
  'search-form': (a: Attrs, set: SetFn) => (
    <>
      <Text title="Placeholder" value={a.placeholder} placeholder="Search the site" onChange={(v) => set({ placeholder: v || undefined })} />
      <Text title="Button text" value={a.buttonText} placeholder="Search" onChange={(v) => set({ buttonText: v || undefined })} />
      <Text title="Label" value={a.label} placeholder="Search" onChange={(v) => set({ label: v || undefined })} />
      <Toggle title="Show the label" value={!!a.showLabel} onChange={(v) => set({ showLabel: v || undefined })} />
      <StyleControls a={a} set={set} parts={{ typography: true, width: true }} />
    </>
  ),
  'archive-title': (a: Attrs, set: SetFn) => (
    <>
      <Toggle title="Show the prefix (e.g. 'Member Category:')" value={a.showPrefix !== false} onChange={(v) => set({ showPrefix: v ? undefined : false })} />
      <StyleControls a={a} set={set} parts={{ typography: true, width: false }} />
    </>
  ),
  part: (a: Attrs, set: SetFn) => <Select title="Part" value={a.slug} options={[['header', 'Header'], ['footer', 'Footer']]} onChange={(v) => set({ slug: v })} />,
  pattern: (a: Attrs, set: SetFn) => <Text title="Pattern" value={a.slug} onChange={(v) => set({ slug: v })} />,
  video: (a: Attrs, set: SetFn) => (
    <>
      <Text title="Video file URL" value={a.src} placeholder="/media/2026/09/clip.mp4" onChange={(v) => set({ src: v || undefined })} />
      <Text title="Poster image URL" value={a.poster} onChange={(v) => set({ poster: v || undefined })} />
      <RichText title="Caption" value={a.caption} onChange={(v) => set({ caption: v || undefined })} />
      <Toggle title="Autoplay (muted)" value={a.autoplay} onChange={(v) => set({ autoplay: v || undefined })} />
      <Toggle title="Loop" value={a.loop} onChange={(v) => set({ loop: v || undefined })} />
      <Toggle title="Show controls" value={a.controls !== false} onChange={(v) => set({ controls: v ? undefined : false })} />
    </>
  ),
  global: (a: Attrs, set: SetFn) => <GlobalPicker value={a.ref} onChange={(ref) => set({ ref })} />,
});

export const CONTENT_LABELS: Record<string, string> = {
  section: 'Section',
  columns: 'Columns',
  column: 'Column',
  text: 'Paragraph',
  heading: 'Heading',
  image: 'Image',
  buttons: 'Buttons',
  button: 'Button',
  list: 'List',
  'list-item': 'List item',
  quote: 'Quote',
  separator: 'Separator',
  spacer: 'Spacer',
  cover: 'Cover',
  hero: 'Hero',
  gallery: 'Image gallery',
  'video-gallery': 'Video gallery',
  embed: 'Embed',
  html: 'HTML',
  'media-text': 'Media & text',
  'entry-title': 'Title',
  'entry-excerpt': 'Excerpt',
  'entry-date': 'Date',
  'entry-terms': 'Categories',
  'entry-image': 'Featured image',
  'entry-content': 'Page content',
  collection: 'Collection',
  'collection-items': 'Collection items',
  'collection-empty': 'No results',
  pagination: 'Pagination',
  'pagination-next': 'Next page',
  'pagination-previous': 'Previous page',
  'pagination-numbers': 'Page numbers',
  'archive-title': 'Listing title',
  'search-form': 'Search',
  'collection-filters': 'Filters',
  map: 'Map',
  navigation: 'Navigation',
  'site-title': 'Site title',
  'social-links': 'Social links',
  part: 'Template part',
  pattern: 'Pattern',
  global: 'Global',
  video: 'Video',
};

export const CONTENT_DEFAULTS: Record<string, Attrs> = {
  collection: { query: { postType: 'post', perPage: 6, order: 'desc', orderBy: 'date' }, display: 'grid', columns: 3, card: 'image' },
  section: { layout: { type: 'constrained' } },
  text: { content: 'New paragraph' },
  heading: { content: 'New heading', level: 2 },
  list: { marker: 'bullet', items: [{ content: 'First item' }, { content: 'Second item' }] },
  button: { text: 'Button', href: '#' },
  spacer: { height: '40px' },
  cover: { dim: 50, overlay: 'var(--color-dark)', minHeight: '430px' },
  'event-calendar': { title: 'Upcoming events' },
  hero: { title: 'Page title', text: 'A short introduction to this page.', primaryLabel: 'Learn more', primaryHref: '/' },
  html: { html: '' },
};

export const CONTENT_CONTAINERS = ['section', 'columns', 'column', 'buttons', 'quote', 'cover', 'gallery', 'video-gallery', 'media-text', 'collection', 'collection-items', 'collection-empty', 'pagination'];

type GalleryItem = { type: 'image' | 'video' | 'embed'; attrs: Attrs };

const btn = 'rounded border border-admin-ink/15 bg-white px-3 py-1.5 text-xs hover:border-admin-accent';

/**
 * Image and video galleries: grid, masonry or slider. Picked media are handed over as `attrs.add`;
 * the gallery's resolveData (config.tsx) turns them into its image, video or embed blocks.
 */
function GalleryPanel({ a, set, video }: { a: Attrs; set: SetFn; video?: boolean }) {
  const [picking, setPicking] = useState(false);
  const [links, setLinks] = useState('');
  const [bad, setBad] = useState<string[]>([]);
  const display = a.display === 'masonry' || a.display === 'slider' ? a.display : 'grid';
  const add = (items: GalleryItem[]) => items.length && set({ add: [...(a.add ?? []), ...items] });
  const addLinks = () => {
    const lines = links.split(/\s+/).filter(Boolean);
    const found = lines.map((u) => [u, videoEmbedAttrs(u)] as const);
    add(found.filter(([, e]) => e).map(([, e]) => ({ type: 'embed', attrs: e! })));
    const rejected = found.filter(([, e]) => !e).map(([u]) => u);
    setBad(rejected);
    setLinks(rejected.join('\n'));
  };
  return (
    <>
      <Segmented
        title="Display"
        value={display}
        options={[['grid', 'Grid'], ['masonry', 'Masonry'], ['slider', 'Slider']]}
        onChange={(v) => set({ display: v === 'grid' ? undefined : v })}
      />
      <FieldGroup title={video ? 'Videos' : 'Images'}>
        <button type="button" className={btn} onClick={() => setPicking(true)}>
          {video ? 'Add uploaded videos' : 'Add images'}
        </button>
        <p className="mt-1 text-[11px] text-admin-muted">Select an item in the gallery to change, reorder or remove it.</p>
      </FieldGroup>
      {video && (
        <FieldGroup title="Add YouTube or Vimeo links">
          <textarea className={`${inputClass} font-mono`} rows={3} placeholder="One link per line" value={links} onChange={(e) => setLinks(e.target.value)} />
          <button type="button" className={`${btn} mt-1`} disabled={!links.trim()} onClick={addLinks}>
            Add links
          </button>
          {bad.length > 0 && <p className="mt-1 text-xs text-[#c4592a]">Not a YouTube or Vimeo link: {bad.join(', ')}</p>}
        </FieldGroup>
      )}
      {picking && (
        <MediaModal
          multiple
          only={video ? 'video' : 'image'}
          onClose={() => setPicking(false)}
          onSelectMany={(list) => {
            setPicking(false);
            add(list.map((m) => (video ? { type: 'video', attrs: { src: m.url, mediaId: m.mediaId, controls: true } } : { type: 'image', attrs: { mediaId: m.mediaId, src: m.url, alt: m.alt || undefined, size: 'large' } })));
          }}
        />
      )}
      <Text title={display === 'slider' ? 'Visible at once' : 'Columns'} value={a.columns} placeholder="3" onChange={(v) => set({ columns: Number(v) || undefined })} />
      {!video && display !== 'masonry' && <AspectSelect title="Image shape" value={a.ratio} originalLabel="As uploaded" onChange={(v) => set({ ratio: (v as string) || undefined })} />}
      {!video && display === 'grid' && !a.ratio && <Toggle title="Crop images to fit" value={a.crop !== false} onChange={(v) => set({ crop: v ? undefined : false })} />}
      <Space title="Gap" value={a.gap} onChange={(v) => set({ gap: v })} />
      {!video && display === 'slider' && <Toggle title="Advance automatically" value={a.autoplay} onChange={(v) => set({ autoplay: v || undefined })} />}
    </>
  );
}

/** Which global to show: content kept once (Globals in the admin) and placed on many pages. */
function GlobalPicker({ value, onChange }: { value: unknown; onChange: (ref: number | undefined) => void }) {
  const [globals, setGlobals] = useState<{ id: number; title: string }[]>([]);
  useEffect(() => {
    browserClient().from('entries').select('id, title').eq('type', 'global').neq('status', 'trash').order('title').then(({ data }) => setGlobals((data ?? []) as any));
  }, []);
  const id = Number(value) || 0;
  return (
    <>
      <Select title="Global" value={id ? String(id) : undefined} options={globals.map((g) => [String(g.id), g.title || `(untitled #${g.id})`])} onChange={(v) => onChange(v ? Number(v) : undefined)} />
      <p className="-mt-2 mb-3 text-[11px] text-admin-muted">
        Edits to a global show everywhere it's placed.{' '}
        {id > 0 && (
          <a className="underline hover:text-admin-accent" href={`/admin/edit/${id}/`} target="_blank" rel="noopener">
            Edit this global
          </a>
        )}
      </p>
    </>
  );
}

/** Icon choices as a grid of previews. `allowNone` offers "Same as the list" (per-item icons). */
function IconGrid({ value, onChange, allowNone }: { value?: string; onChange: (v: string | undefined) => void; allowNone?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {allowNone && (
        <button type="button" onClick={() => onChange(undefined)} className={`h-7 rounded border px-1.5 text-[10px] ${!value ? 'border-admin-accent bg-admin-accent/10' : 'border-admin-ink/15'}`}>
          List icon
        </button>
      )}
      {LIST_ICONS.map(([k, label]) => (
        <button key={k} type="button" title={label} aria-label={label} aria-pressed={value === k} onClick={() => onChange(k)} className={`flex h-7 w-7 items-center justify-center rounded border text-base ${value === k ? 'border-admin-accent bg-admin-accent/10 text-admin-accent' : 'border-admin-ink/15 text-admin-ink'}`} dangerouslySetInnerHTML={{ __html: iconSvg(k) }} />
      ))}
    </div>
  );
}

type ListItem = { content?: string; icon?: string };

/** The list block: marker, icon, items (each with its own text and optional icon), text styling. */
function ListPanel({ a, set }: { a: Attrs; set: SetFn }) {
  const items: ListItem[] = Array.isArray(a.items) ? a.items : [];
  const marker: string = a.marker ?? (a.ordered ? 'number' : a.variant === 'plain' ? 'none' : 'bullet');
  const setItems = (next: ListItem[]) => set({ items: next });
  const move = (i: number, d: number) => {
    const n = [...items];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    setItems(n);
  };
  return (
    <>
      <div className="mb-3">
        <span className="mb-1 block text-xs font-medium text-admin-muted">Marker</span>
        <div className="flex overflow-hidden rounded border border-admin-ink/15">
          {[['bullet', 'Bullets'], ['number', 'Numbers'], ['icon', 'Icon'], ['none', 'None']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => set({ marker: k, ordered: undefined, variant: undefined, ...(k === 'icon' && !a.icon ? { icon: 'check' } : {}) })} className={`flex-1 px-2 py-1.5 text-xs ${marker === k ? 'bg-admin-ink text-white' : 'bg-white hover:bg-admin-soft'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {marker === 'icon' && (
        <>
          <div className="mb-3">
            <span className="mb-1 block text-xs font-medium text-admin-muted">Icon</span>
            <IconGrid value={a.icon ?? 'check'} onChange={(v) => set({ icon: v ?? 'check' })} />
          </div>
          <Color title="Icon color" value={a.iconColor} onChange={(v) => set({ iconColor: v })} />
        </>
      )}

      <div className="mb-3">
        <span className="mb-1 block text-xs font-medium text-admin-muted">Items</span>
        {items.map((it, i) => (
          <div key={i} className="mb-1.5 rounded border border-admin-ink/10 bg-admin-bg p-1.5">
            <RichText title={`Item ${i + 1}`} value={it.content ?? ''} onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, content: v } : x)))} />
            {marker === 'icon' && (
              <details open className="-mt-1 mb-1">
                <summary className="cursor-pointer text-[11px] text-admin-muted">Icon for this item{it.icon ? `: ${LIST_ICONS.find(([k]) => k === it.icon)?.[1] ?? it.icon}` : ''}</summary>
                <div className="mt-1">
                  <IconGrid allowNone value={it.icon} onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, icon: v } : x)))} />
                </div>
              </details>
            )}
            <div className="flex gap-2 text-[11px] text-admin-muted">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="enabled:hover:text-admin-ink disabled:opacity-30">
                Up
              </button>
              <button type="button" disabled={i === items.length - 1} onClick={() => move(i, 1)} className="enabled:hover:text-admin-ink disabled:opacity-30">
                Down
              </button>
              <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="ml-auto text-[#c4592a]">
                Remove
              </button>
            </div>
          </div>
        ))}
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setItems([...items, { content: '' }])} className="rounded border border-dashed border-admin-ink/25 px-3 py-1 text-xs text-admin-muted hover:border-admin-accent hover:text-admin-accent">
            Add item
          </button>
          <PasteLines onAdd={(lines) => setItems([...items, ...lines.map((content) => ({ content }))])} />
        </div>
      </div>

      <Group title="Text" open>
        <StyleControls a={a} set={set} parts={{ typography: true, border: false, width: false }} />
        <Space title="Space between items" value={a.itemGap} onChange={(v) => set({ itemGap: v })} />
      </Group>
    </>
  );
}

/** Add several items at once: one per line. */
function PasteLines({ onAdd }: { onAdd: (lines: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded border border-dashed border-admin-ink/25 px-3 py-1 text-xs text-admin-muted hover:border-admin-accent hover:text-admin-accent">
        Paste several
      </button>
    );
  return (
    <div className="w-full">
      <textarea autoFocus rows={4} className={inputClass} placeholder="One item per line" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-1 flex gap-2 text-xs">
        <button
          type="button"
          className="rounded bg-admin-ink px-2 py-1 text-white"
          onClick={() => {
            onAdd(text.split('\n').map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean).map(esc));
            setText('');
            setOpen(false);
          }}
        >
          Add lines
        </button>
        <button type="button" className="text-admin-muted" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
