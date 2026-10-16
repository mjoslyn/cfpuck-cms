// The Form, Subscribe and Newsletter blocks' Form style settings (`attrs.formStyle`, read by
// src/render/forms/style.ts): field background, text and border, label colour, button colours and the
// fields' corners. Empty settings keep the defaults: white fields with black text.
import { Color, Group } from './panels';
import { Select, type Attrs } from './fields';
import { FORM_RADII, type FormStyle } from '../render/forms/style';

export function FormStylePanel({ a, set }: { a: Attrs; set: (patch: Attrs) => void }) {
  const s: FormStyle = a.formStyle ?? {};
  const put = (patch: Partial<FormStyle>) => {
    const next = Object.fromEntries(Object.entries({ ...s, ...patch }).filter(([, v]) => v));
    set({ formStyle: Object.keys(next).length ? next : undefined });
  };
  return (
    <Group title="Form style" open={false}>
      <Color title="Field background (default white)" value={s.inputBg} onChange={(inputBg) => put({ inputBg })} />
      <Color title="Field text (default black)" value={s.inputText} onChange={(inputText) => put({ inputText })} />
      <Color title="Field border" value={s.inputBorder} onChange={(inputBorder) => put({ inputBorder })} />
      <Color title="Labels" value={s.label} onChange={(label) => put({ label })} />
      <Color title="Button background" value={s.buttonBg} onChange={(buttonBg) => put({ buttonBg })} />
      <Color title="Button text" value={s.buttonText} onChange={(buttonText) => put({ buttonText })} />
      <Select title="Field corners" value={s.radius ?? ''} options={FORM_RADII} onChange={(radius) => put({ radius: radius || undefined })} />
    </Group>
  );
}
