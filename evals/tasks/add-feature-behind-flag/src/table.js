export function render(rows, options = {}) {
  return rows.map(r => r.join(' | ')).join('\n');
}
