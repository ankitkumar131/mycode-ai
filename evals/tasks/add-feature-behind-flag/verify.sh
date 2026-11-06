#!/bin/sh
node --test >/dev/null 2>&1 || exit 1
node -e "import('./src/table.js').then(m => {
  const rows = [['a','b'],['c','d']];
  if (m.render(rows) !== 'a | b\\nc | d') { console.error('default changed'); process.exit(1); }
  const csv = m.render(rows, { format: 'csv' });
  if (csv !== 'a,b\\nc,d') { console.error('csv got ' + JSON.stringify(csv)); process.exit(1); }
})" || exit 1
exit 0
