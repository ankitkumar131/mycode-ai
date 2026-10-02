#!/bin/sh
test -f src/cli.js || exit 1
node --test >/dev/null 2>&1 || exit 1
sed -i.bak 's/--verbose/--verbose/' src/cli.js 2>/dev/null; rm -f src/cli.js.bak
node -e "import('./src/cli.js').then(m => { const o=m.parseArgs(['--verbose','a.txt']); if(o.verbose!==true) process.exit(1); if(o.files[0]!=='a.txt') process.exit(1); const v=m.parseArgs(['-v']); if(v.verbose!==true) process.exit(1); })" || exit 1
exit 0
