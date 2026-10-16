// A form's own colours and corners (the Form, Subscribe and Newsletter blocks' `attrs.formStyle`), as the
// CSS custom properties src/styles/forms.css reads: fields default to white with black text and the
// site's border, labels to the text around them, buttons to the site's button. Safe in the browser.

export interface FormStyle {
  inputBg?: string;
  inputText?: string;
  inputBorder?: string;
  label?: string;
  buttonBg?: string;
  buttonText?: string;
  /** Field corners: a CSS length. */
  radius?: string;
}

export const FORM_RADII: [string, string][] = [
  ['', 'Slightly rounded (default)'],
  ['0', 'Square'],
  ['8px', 'Rounded'],
  ['999px', 'Pill'],
];

const PROPS: [keyof FormStyle, string][] = [
  ['inputBg', '--form-input-bg'],
  ['inputText', '--form-input-text'],
  ['inputBorder', '--form-border'],
  ['label', '--form-label'],
  ['buttonBg', '--button-bg'],
  ['buttonText', '--button-color'],
  ['radius', '--form-radius'],
];

// A palette colour (var(--color-…)), a hex colour or a few keywords; corners from the list above.
const COLOR = /^(?:var\(--color-[a-z0-9-]+\)|#[0-9a-f]{3,8}|white|black|transparent)$/i;
const RADIUS = new Set(FORM_RADII.map(([v]) => v).filter(Boolean));

/** The style's custom properties, leaving out anything that isn't a colour (or corner) we allow. */
export function formStyleDecls(s: unknown): [string, string][] {
  if (!s || typeof s !== 'object') return [];
  const v = s as Record<string, unknown>;
  return PROPS.flatMap(([k, prop]): [string, string][] => {
    const x = typeof v[k] === 'string' ? (v[k] as string).trim() : '';
    if (!x || (k === 'radius' ? !RADIUS.has(x) : !COLOR.test(x))) return [];
    return [[prop, x]];
  });
}
