#!/bin/sh
test -f .gitignore || exit 1
for p in node_modules dist .env '*.log' coverage; do grep -q -- "$p" .gitignore || exit 1; done
exit 0
