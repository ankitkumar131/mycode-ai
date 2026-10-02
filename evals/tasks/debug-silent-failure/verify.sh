#!/bin/sh
node --test >/dev/null 2>&1 || exit 1
node -e "import('./src/list.js').then(m => {
  const xs = [1, 2, 3, 4];
  const cases = [[0, []], [1, [4]], [2, [3, 4]], [4, [1, 2, 3, 4]], [9, [1, 2, 3, 4]]];
  for (const [n, want] of cases) {
    const got = m.sliceLast(xs, n);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error('sliceLast([' + xs + '], ' + n + ') = ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
      process.exit(1);
    }
  }
  if (JSON.stringify(m.takeFirst(xs, 0)) !== '[]') process.exit(1);
})
" || exit 1
exit 0
