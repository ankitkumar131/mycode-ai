#!/bin/sh
# The bug must be fixed without weakening the test.
grep -q 'a + b' src/calc.js || exit 1
grep -q "strictEqual(add(2, 3), 5)" src/calc.test.js || exit 1
node --test >/dev/null 2>&1 || exit 1
exit 0
