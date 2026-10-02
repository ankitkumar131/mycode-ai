#!/bin/sh
node --test >/dev/null 2>&1 || exit 1
grep -qE 'new Map|new Set' src/lookup.js || exit 1
exit 0
