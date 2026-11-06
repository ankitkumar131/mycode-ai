#!/bin/sh
node --test >/dev/null 2>&1 || exit 1
test -f FINDINGS.md || exit 1
wc -w FINDINGS.md | awk '{ if ($1 < 15) exit 1 }' || exit 1
exit 0
