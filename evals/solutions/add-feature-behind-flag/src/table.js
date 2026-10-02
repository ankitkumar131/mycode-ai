export function render(rows, options = {}) {
  if (options.format === 'csv') return rows.map(r => r.join(',')).join('\n');
  return rows.map(r => r.join(' | ')).join('\n');
}
