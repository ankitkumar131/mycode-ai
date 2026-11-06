export function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
export function max(xs) {
  return Math.max(...xs);
}
