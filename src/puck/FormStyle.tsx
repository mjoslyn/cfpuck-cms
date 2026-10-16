// The Form, Subscribe and Newsletter blocks' Form style settings (`attrs.formStyle`, read by
// src/render/forms/style.ts): the form's background, border and text; field background, text, border,
// placeholder, focus colour, height, text size and border width; checkboxes; labels; button colours;
// field and button corners. Empty settings keep the defaults: white fields with black text, no box
// round the form.
import { Color, Group } from './panels';
import { Select, type Attrs } from './fields';
import { BORDER_WIDTHS, FIELD_SIZES, FORM_RADII, TEXT_SIZES, type FormStyle } from '../render/forms/style';

export function FormStylePanel({ a, set }: { a: Attrs; set: (patch: Attrs) => void }) {
  const s: FormStyle = a.formStyle ?? {};
  const put = (patch: Partial<FormStyle>) => {
    const next = Object.fromEntries(Object.entries({ ...s, ...patch }).filter(([, v]) => v));
    set({ formStyle: Object.keys(next).length ? next : undefined });
  };
  return (
    <Group title="Form style" open={false}>
      <Color title="Form background (default none)" value={s.background} onChange={(background) => put({ background })} />
      <Color title="Form border (default none)" value={s.border} onChange={(border) => put({ border })} />
      <Color title="Form text (heading, intro, small print)" value={s.text} onChange={(text) => put({ text })} />
      <Color title="Field background (default white)" value={s.inputBg} onChange={(inputBg) => put({ inputBg })} />
      <Color title="Field text (default black)" value={s.inputText} onChange={(inputText) => put({ inputText })} />
      <Color title="Field border" value={s.inputBorder} onChange={(inputBorder) => put({ inputBorder })} />
      <Color title="Labels" value={s.label} onChange={(label) => put({ label })} />
      <Color title="Button background" value={s.buttonBg} onChange={(buttonBg) => put({ buttonBg })} />
      <Color title="Button text" value={s.buttonText} onChange={(buttonText) => put({ buttonText })} />
      <Color title="Placeholder text" value={s.placeholder} onChange={(placeholder) => put({ placeholder })} />
      <Color title="Field being typed in (border and ring)" value={s.focus} onChange={(focus) => put({ focus })} />
      <Color title="Checkboxes and radio buttons" value={s.check} onChange={(check) => put({ check })} />
      <Select title="Field height" value={s.fieldSize ?? ''} options={FIELD_SIZES} onChange={(fieldSize) => put({ fieldSize: fieldSize || undefined })} />
      <Select title="Field text size" value={s.textSize ?? ''} options={TEXT_SIZES} onChange={(textSize) => put({ textSize: textSize || undefined })} />
      <Select title="Field border width" value={s.borderWidth ?? ''} options={BORDER_WIDTHS} onChange={(borderWidth) => put({ borderWidth: borderWidth || undefined })} />
      <Select title="Field corners" value={s.radius ?? ''} options={FORM_RADII} onChange={(radius) => put({ radius: radius || undefined })} />
      <Select title="Button corners" value={s.buttonRadius ?? ''} options={FORM_RADII} onChange={(buttonRadius) => put({ buttonRadius: buttonRadius || undefined })} />
    </Group>
  );
}
