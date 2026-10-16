// A form's own colours and corners (the Form, Subscribe and Newsletter blocks' `attrs.formStyle`), as the
// CSS custom properties src/styles/forms.css reads: fields default to white with black text and the
// site's border, labels to the text around them, buttons to the site's button. A background or border
// of the form's own puts it in a box with room round it (`has-form-box`). Safe in the browser.

export interface FormStyle {
  /** Behind the whole form. */
  background?: string;
  /** A line round the whole form. */
  border?: string;
  /** The form's own text (headings, intro, consent wording), where it sits on its own background. */
  text?: string;
  inputBg?: string;
  inputText?: string;
  inputBorder?: string;
  label?: string;
  buttonBg?: string;
  buttonText?: string;
  /** Field corners: a CSS length from FORM_RADII. */
  radius?: string;
  /** Button corners: a CSS length from FORM_RADII. */
  buttonRadius?: string;
}

export const FORM_RADII: [string, string][] = [
  ['', 'Default'],
  ['0', 'Square'],
  ['4px', 'Slightly rounded'],
  ['8px', 'Rounded'],
  ['999px', 'Pill'],
];

const PROPS: [keyof FormStyle, string][] = [
  ['background', 'background-color'],
  ['border', 'border'],
  ['text', 'color'],
  ['inputBg', '--form-input-bg'],
  ['inputText', '--form-input-text'],
  ['inputBorder', '--form-border'],
  ['label', '--form-label'],
  ['buttonBg', '--button-bg'],
  ['buttonText', '--button-color'],
  ['radius', '--form-radius'],
  ['buttonRadius', '--form-button-radius'],
];

// A palette colour (var(--color-…)), a hex colour or a few keywords; corners from the list above.
const COLOR = /^(?:var\(--color-[a-z0-9-]+\)|#[0-9a-f]{3,8}|white|black|transparent)$/i;
const RADIUS = new Set(FORM_RADII.map(([v]) => v).filter(Boolean));

/** The style's custom properties (and the box's background, border and text colour), leaving out anything that isn't a colour (or corner) we allow. */
export function formStyleDecls(s: unknown): [string, string][] {
  if (!s || typeof s !== 'object') return [];
  const v = s as Record<string, unknown>;
  return PROPS.flatMap(([k, prop]): [string, string][] => {
    const x = typeof v[k] === 'string' ? (v[k] as string).trim() : '';
    const corner = k === 'radius' || k === 'buttonRadius';
    if (!x || (corner ? !RADIUS.has(x) : !COLOR.test(x))) return [];
    if (k === 'border') return [[prop, `1px solid ${x}`]];
    // The form's text colours its headings and small print too.
    if (k === 'text') return [[prop, x], ['--heading-color', x], ['--form-muted', x]];
    return [[prop, x]];
  });
}

/** The class a block adds when its form has a background or border of its own (a box, padding round the form). */
export const formStyleClass = (s: unknown) => (formStyleDecls(s).some(([p]) => p === 'background-color' || p === 'border') ? 'has-form-box' : null);
