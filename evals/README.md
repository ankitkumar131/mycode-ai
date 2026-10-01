# Head-to-head eval harness

Measures MyCode against other coding agents on the same tasks, the same model,
and the same provider endpoint — then reports the difference.

The point is to replace "ours feels better" with numbers. Every metric here is
either a fact about the result (`did the task's own verifier pass?`) or a fact
measured at the wire (`how many tokens did the agent actually send?`). Nothing
is self-reported by the agent, so an agent cannot flatter itself.

## Why a recording proxy

Both agents are pointed at a local proxy that forwards to the real provider and
records every request. That buys three things:

1. **Identical measurement.** Prompt tokens, completion tokens, request count
   and latency come from the same place for every agent, instead of each agent's
   own accounting — which differs in what it counts and when it resets.
2. **Same model, not just same model name.** A misconfigured agent that silently
   fell back to a different model shows up in the recorded `model` field.
3. **Context pressure is visible.** The largest single request is the real
   context cost, including system prompt and tool schemas. That is usually the
   number that decides both bill size and how long a session survives.

## Usage

```sh
# Self-test the suite first: every task must fail on its seed and pass on its
# reference solution. If this fails, head-to-head numbers are meaningless.
npm run eval:selftest

# Dry run — exercises workspaces, proxy, verifiers and report without an API key.
npm run eval -- --dry-run

# One agent, one run: the cheapest useful real comparison.
EVAL_API_KEY=sk-... EVAL_UPSTREAM=https://api.openai.com/v1 \
  npm run eval -- --model gpt-4o --agents mycode --runs 1

# Full comparison.
EVAL_API_KEY=sk-... EVAL_UPSTREAM=https://api.openai.com/v1 \
  npm run eval -- --model gpt-4o --agents mycode,opencode --runs 3

npm run eval:report                # newest result set
npm run eval:report -- --json      # machine-readable
```

Options: `--tasks a,b` `--runs N` `--timeout MS` `--keep` `--port N`
`--api-key K` `--upstream URL` `--model M` `--agents mycode,opencode,mock`.

Environment: `EVAL_API_KEY`, `EVAL_UPSTREAM`, `EVAL_MODEL`, `EVAL_RUNS`.

## What is measured

| Metric | Meaning |
| --- | --- |
| Tasks solved | The task's own `verify.sh` exited 0 |
| Median time to solve | Wall clock, successful runs only |
| LLM requests | Round trips to the provider — a proxy for agent-loop efficiency |
| Prompt / completion tokens | Measured at the proxy, cached tokens counted separately |
| **Fixed overhead** | Prompt tokens on the *first* request: system prompt + tool schemas + task. What every session pays before doing anything. |
| **Tool schemas advertised** | How much of that overhead is tool definitions |
| Peak context | Largest single request — the real context ceiling in practice |
| Tokens per solved task | Cost efficiency; punishes burning context and still failing |
| Tool calls | Best-effort, parsed from the agent's own log (not comparable across agents) |

## Tasks

20 tasks in `tasks/`, each a self-contained workspace plus a `verify.sh` that
exits 0 only on a genuine solution. Categories: bugfix, feature, refactor,
performance, concurrency, types, validation, scripting, docs, investigation,
cleanup, architecture, resilience, config, edge-cases.

Verifiers are written to resist the obvious shortcuts: they check the *behaviour*
(e.g. `sliceLast([1,2,3,4], 0)` returns `[]`, not the whole list), they re-run the
project's own tests, and several forbid weakening the test file. The verifier runs
from the original task directory, so an agent cannot pass by editing the checker.

`solutions/` holds a reference solution for every task. It is not used during
scoring — it is there so the suite can prove it is satisfiable, and so
`--dry-run` can exercise the whole pipeline.

Run `npm run eval:selftest` after touching any task. It enforces both halves:

- **seed fails** — otherwise the task scores points for free;
- **solution passes** — otherwise no agent can ever score.

## Fairness notes

- Same provider endpoint, same key, same model string for every agent.
- Each run gets a fresh workspace and a fresh proxy, so runs are independent.
- A task-level timeout kills the agent; the run counts as unsolved.
- Verifiers are executed outside the agent's workspace copy of them.
- `--runs 3` is a small sample. The report says so explicitly rather than
  implying significance the data does not support.

## Layout

```
evals/
  run.mjs              runner: workspaces, agents, proxy, verification, results.json
  report.mjs           renders the comparison (and --json)
  config.json          optional defaults (model, upstream, runs, agents)
  lib/proxy.mjs        recording proxy (also usable stand-alone)
  lib/selftest.sh      seed-fails / solution-passes check for the task suite
  tasks/<name>/        workspace + task.md + verify.sh
  solutions/<name>/    reference solution
  runs/                output (git-ignored)
```
