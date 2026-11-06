#!/bin/sh
grep -q 'unused' src/util.js && exit 1
grep -q 'alsoUnused' src/util.js && exit 1
grep -q 'export function used' src/util.js || exit 1
node --test >/dev/null 2>&1 || exit 1
exit 0
