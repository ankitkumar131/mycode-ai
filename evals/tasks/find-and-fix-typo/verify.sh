#!/bin/sh
grep -rq 'formatCurrancy' src/ && exit 1
node --test >/dev/null 2>&1 || exit 1
exit 0
