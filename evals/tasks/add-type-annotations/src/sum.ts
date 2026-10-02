export function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}

export function firstOf(items) {
  return items.length ? items[0] : undefined;
}

export function pluck(rows, key) {
  return rows.map(r => r[key]);
}
