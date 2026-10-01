#!/bin/sh
test -f README.md || exit 1
for fn in clamp lerp; do grep -q "$fn" README.md || exit 1; done
grep -qi 'min' README.md || exit 1
grep -qi 't' README.md || exit 1
wc -w README.md | awk '{ if ($1 < 30) exit 1 }' || exit 1
exit 0
