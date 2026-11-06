// The blocks a selected block sits inside, outermost first, for the settings panel's trail
// (src/puck/FieldsTrail.tsx). Puck names a block's place by its zone, "<parent id>:<slot>", or
// "root:<zone>" at the top of the page.
export function ancestorsOf(id: string, zoneOf: (id: string) => string | undefined): string[] {
  const out: string[] = [];
  const seen = new Set([id]);
  let current = id;
  for (;;) {
    const zone = zoneOf(current);
    const parent = zone?.split(':')[0];
    if (!parent || parent === 'root' || seen.has(parent)) return out;
    seen.add(parent);
    out.unshift(parent);
    current = parent;
  }
}
