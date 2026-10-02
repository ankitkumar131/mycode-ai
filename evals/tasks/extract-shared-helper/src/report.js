export function reportTotal(cents) {
  const rounded = Math.round(cents) / 100;
  return '$' + rounded.toFixed(2);
}
