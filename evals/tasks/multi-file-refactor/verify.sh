#!/bin/sh
grep -rq 'getUser' src/ && exit 1
grep -q 'export function fetchUser' src/api.js || exit 1
grep -q 'fetchUser' src/app.js || exit 1
grep -q 'fetchUser' src/other.js || exit 1
node --test >/dev/null 2>&1 || exit 1
exit 0
