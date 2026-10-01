#!/bin/sh
node --test >/dev/null 2>&1 || exit 1
grep -q "export function fromA" src/a.js || exit 1
grep -q "export function fromB" src/b.js || exit 1
# The cycle itself must be gone: b.js may no longer import from a.js.
grep -qE "from ['\"]\./a\.js['\"]" src/b.js && exit 1
exit 0
