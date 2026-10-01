#!/bin/sh
test -f scripts/migrate.js || exit 1
node scripts/migrate.js >/dev/null 2>&1 || exit 1
test -f data.migrated.json || exit 1
node -e "const d=require('./data.migrated.json'); if(d.length!==2||d[0].fullName!=='a'||'name' in d[0]) process.exit(1)" || exit 1
cp data.migrated.json /tmp/_m1.json 2>/dev/null || cp data.migrated.json "$TMPDIR/_m1.json"
node scripts/migrate.js >/dev/null 2>&1 || exit 1
node -e "const a=require('/tmp/_m1.json'),b=require('./data.migrated.json'); if(JSON.stringify(a)!==JSON.stringify(b)) process.exit(1)" 2>/dev/null || node -e "const a=require(process.env.TMPDIR+'/_m1.json'),b=require('./data.migrated.json'); if(JSON.stringify(a)!==JSON.stringify(b)) process.exit(1)" || exit 1
exit 0
