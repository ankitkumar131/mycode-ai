#!/bin/sh
test -f src/money.js || exit 1
grep -q 'roundMoney' src/money.js || exit 1
grep -q "money.js" src/report.js || exit 1
grep -q "money.js" src/invoice.js || exit 1
grep -q 'Math.round' src/report.js && exit 1
grep -q 'Math.round' src/invoice.js && exit 1
node --test >/dev/null 2>&1 || exit 1
exit 0
