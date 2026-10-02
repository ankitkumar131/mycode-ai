#!/bin/sh
# EVAL_TSC is exported by the harness so this does not need the network.
TSC="${EVAL_TSC:-tsc}"
grep -qE '\\bany\\b' src/sum.ts && exit 1
"$TSC" --noEmit -p tsconfig.json >/dev/null 2>&1 || exit 1
exit 0
