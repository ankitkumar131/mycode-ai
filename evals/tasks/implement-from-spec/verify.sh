#!/bin/sh
test -f src/slug.js || exit 1
test -f src/slug.test.js || exit 1
node --test >/dev/null 2>&1 || exit 1
node -e "import('./src/slug.js').then(m => { const f=m.slugify||m.default; const cases=[['Hello World','hello-world'],['  A  B  ','a-b'],['foo!!!bar','foo-bar'],['--x--','x']]; for (const [i,e] of cases) { if (f(i)!==e) { console.error('got',JSON.stringify(f(i)),'want',JSON.stringify(e)); process.exit(1);} } })" || exit 1
exit 0
