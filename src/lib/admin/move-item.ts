/** Moves the item at `from` one place up (-1) or down (1); out of range leaves the list as it is. */
export const moveItem = <T>(list: T[], from: number, by: -1 | 1): T[] => {
  const to = from + by;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  [next[from], next[to]] = [next[to], next[from]];
  return next;
};
