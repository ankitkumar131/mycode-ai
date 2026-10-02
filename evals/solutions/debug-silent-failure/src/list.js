export function sliceLast(items, n) {
  if (!(n > 0)) return [];
  return items.slice(-n);
}

export function takeFirst(items, n) {
  if (!(n > 0)) return [];
  return items.slice(0, n);
}
