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
  /** Field height: a key of FIELD_SIZES. */
  fieldSize?: string;
  /** Field text size: a key of TEXT_SIZES. */
  textSize?: string;
  /** Field border width: a CSS length from BORDER_WIDTHS. */
  borderWidth?: string;
  placeholder?: string;
  /** The border and ring round the field being typed in. */
  focus?: string;
  /** Checkboxes and radio buttons. */
  check?: string;
}

export const FORM_RADII: [string, string][] = [
  ['', 'Default'],
  ['0', 'Square'],
  ['4px', 'Slightly rounded'],
  ['8px', 'Rounded'],
  ['999px', 'Pill'],
];

/** Field heights, as their padding. */
export const FIELD_SIZES: [string, string][] = [
  ['', 'Normal'],
  ['compact', 'Compact'],
  ['large', 'Large'],
];
const FIELD_PADDING: Record<string, string> = { compact: '0.5rem 0.75rem', large: '1rem 1.125rem' };

export const TEXT_SIZES: [string, string][] = [
  ['', 'Normal'],
  ['small', 'Small'],
  ['large', 'Large'],
];
const TEXT_SIZE: Record<string, string> = { small: '0.875rem', large: '1.125rem' };

export const BORDER_WIDTHS: [string, string][] = [
  ['', 'Thin (default)'],
  ['0', 'None'],
  ['2px', 'Medium'],
  ['3px', 'Thick'],
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
  ['fieldSize', '--form-input-pad'],
  ['textSize', '--form-input-size'],
  ['borderWidth', '--form-border-width'],
  ['placeholder', '--form-placeholder'],
  ['focus', '--form-focus'],
  ['check', '--form-check'],
];

// A palette colour (var(--color-…)), a hex colour or a few keywords; sizes, widths and corners from the lists above.
const COLOR = /^(?:var\(--color-[a-z0-9-]+\)|#[0-9a-f]{3,8}|white|black|transparent)$/i;
const RADIUS = new Set(FORM_RADII.map(([v]) => v).filter(Boolean));
const WIDTHS = new Set(BORDER_WIDTHS.map(([v]) => v).filter(Boolean));

/** The style's custom properties (and the box's background, border and text colour), leaving out anything that isn't a colour (or corner) we allow. */
export function formStyleDecls(s: unknown): [string, string][] {
  if (!s || typeof s !== 'object') return [];
  const v = s as Record<string, unknown>;
  return PROPS.flatMap(([k, prop]): [string, string][] => {
    const x = typeof v[k] === 'string' ? (v[k] as string).trim() : '';
    if (!x) return [];
    // The settings picked from a list: only their own values.
    if (k === 'fieldSize') return FIELD_PADDING[x] ? [[prop, FIELD_PADDING[x]]] : [];
    if (k === 'textSize') return TEXT_SIZE[x] ? [[prop, TEXT_SIZE[x]]] : [];
    if (k === 'borderWidth') return WIDTHS.has(x) ? [[prop, x]] : [];
    if (k === 'radius' || k === 'buttonRadius') return RADIUS.has(x) ? [[prop, x]] : [];
    if (!COLOR.test(x)) return [];
    if (k === 'border') return [[prop, `1px solid ${x}`]];
    // The form's text colours its headings and small print too.
    if (k === 'text') return [[prop, x], ['--heading-color', x], ['--form-muted', x]];
    return [[prop, x]];
  });
}

/** The class a block adds when its form has a background or border of its own (a box, padding round the form). */
export const formStyleClass = (s: unknown) => (formStyleDecls(s).some(([p]) => p === 'background-color' || p === 'border') ? 'has-form-box' : null);
