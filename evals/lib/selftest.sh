#!/bin/sh
# Self-test for the eval suite: every task must be both *unsatisfied* by its
# seed and *satisfiable* by its reference solution.
#
#   failing on the seed      → the task actually requires work
#   passing on the solution  → the verifier is achievable
#
# A suite that fails either half measures nothing: the first means the score is
# free, the second means every agent scores zero. Run this before trusting any
# head-to-head number.
#
#   sh evals/lib/selftest.sh
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
EVALS=$(dirname "$HERE")
ROOT=$(dirname "$EVALS")

# A TypeScript compiler for the type-checking task: prefer the one in this
# repo's node_modules so the suite never needs the network.
if [ -z "${EVAL_TSC:-}" ] && [ -x "$ROOT/node_modules/.bin/tsc" ]; then
  EVAL_TSC="$ROOT/node_modules/.bin/tsc"
  export EVAL_TSC
fi
TASKS="$EVALS/tasks"
SOLUTIONS="$EVALS/solutions"

seed_pass=0
seed_bad=0
soln_pass=0
soln_bad=0
bad_names=""

for task_dir in "$TASKS"/*/; do
  name=$(basename "$task_dir")
  [ -f "$task_dir/verify.sh" ] || continue

  # ── 1. seed must fail
  work=$(mktemp -d)
  cp -r "$task_dir"/. "$work"/ 2>/dev/null
  rm -f "$work/task.md" "$work/verify.sh"
  if (cd "$work" && sh "$task_dir/verify.sh" >/dev/null 2>&1); then
    seed_bad=$((seed_bad + 1))
    bad_names="$bad_names\n  seed passes:     $name"
  else
    seed_pass=$((seed_pass + 1))
  fi
  rm -rf "$work"

  # ── 2. reference solution must pass (when one is provided)
  if [ -d "$SOLUTIONS/$name" ]; then
    work=$(mktemp -d)
    cp -r "$task_dir"/. "$work"/ 2>/dev/null
    rm -f "$work/task.md" "$work/verify.sh"
    cp -r "$SOLUTIONS/$name"/. "$work"/ 2>/dev/null
    # A leading "." cannot be stored in the repo, so .gitignore ships as gitignore.txt
    [ -f "$work/gitignore.txt" ] && mv "$work/gitignore.txt" "$work/.gitignore"
    if (cd "$work" && sh "$task_dir/verify.sh" >/dev/null 2>&1); then
      soln_pass=$((soln_pass + 1))
    else
      soln_bad=$((soln_bad + 1))
      bad_names="$bad_names\n  solution fails:  $name"
    fi
    rm -rf "$work"
  fi
done

echo
echo "  tasks that require work ......... $seed_pass"
echo "  seeds that already pass ......... $seed_bad"
echo "  solutions that pass ............. $soln_pass"
echo "  solutions that FAIL ............. $soln_bad"

if [ "$seed_bad" -gt 0 ] || [ "$soln_bad" -gt 0 ]; then
  printf "$bad_names\n"
  echo
  echo "  FAIL"
  exit 1
fi

echo
echo "  OK — every task is both unfinished and achievable."
exit 0
