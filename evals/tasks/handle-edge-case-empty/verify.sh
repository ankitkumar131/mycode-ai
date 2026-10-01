#!/bin/sh
node --test >/dev/null 2>&1 || exit 1
node -e "import('./src/stats.js').then(m => {
  for (const fn of ['mean','median','max']) if (m[fn]([]) !== null) { console.error(fn+'([], want null) got '+m[fn]([])); process.exit(1); }
  if (m.median([5]) !== 5) process.exit(1);
  if (m.median([1,2,3,4]) !== 2.5) process.exit(1);
})" || exit 1
exit 0
