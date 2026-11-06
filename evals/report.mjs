#!/usr/bin/env node
/**
 * Render a head-to-head report from a results.json produced by run.mjs.
 *
 *   node evals/report.mjs                       # newest run set
 *   node evals/report.mjs evals/runs/results.json
 *   node evals/report.mjs --json                # machine-readable summary
 *
 * Reports medians as well as totals: a mean over three runs hides the case
 * where an agent solves a task once out of three by luck.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = join(HERE, 'runs');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
let resultsPath = args.find((a) => !a.startsWith('--'));

if (!resultsPath) {
  if (!existsSync(RUNS_DIR)) {
    console.error('  no runs yet — run: node evals/run.mjs');
    process.exit(1);
  }
  const candidates = readdirSync(RUNS_DIR)
    .filter((d) => d.startsWith('results'))
    .map((d) => join(RUNS_DIR, d))
    .concat(
      readdirSync(RUNS_DIR)
        .map((d) => join(RUNS_DIR, d, 'results.json'))
        .filter((p) => existsSync(p)),
    );
  candidates.push(join(RUNS_DIR, 'results.json'));
  const existing = candidates.filter((p) => existsSync(p));
  if (!existing.length) {
    console.error('  no results.json found — run: node evals/run.mjs');
    process.exit(1);
  }
  resultsPath = existing.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

const r = JSON.parse(readFileSync(resultsPath, 'utf-8'));
const agents = Object.keys(r.agents);
const runsPerTask = r.runs;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '-');
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '-');

/** Aggregate per-agent statistics from the run-level detail. */
function statsFor(agent) {
  const details = r.runsDetail.filter((d) => d.agent === agent);
  const ok = details.filter((d) => d.solved);
  return {
    label: r.agents[agent].label,
    tasks: r.agents[agent].total,
    solved: r.agents[agent].solved,
    solveRate: r.agents[agent].total ? r.agents[agent].solved / r.agents[agent].total : 0,
    medianWallMsSolved: median(ok.map((d) => d.wallMs)),
    medianWallMsAll: median(details.map((d) => d.wallMs)),
    totalRequests: sum(details.map((d) => d.requests)),
    medianRequests: median(details.map((d) => d.requests)),
    totalPromptTokens: sum(details.map((d) => d.promptTokens)),
    totalCompletionTokens: sum(details.map((d) => d.completionTokens)),
    cachedTokens: sum(details.map((d) => d.cachedTokens)),
    peakContext: Math.max(0, ...details.map((d) => d.promptTokensPeak ?? 0)),
    medianFirstPrompt: median(details.map((d) => d.firstPromptTokens ?? 0)),
    toolsAdvertised: Math.max(0, ...details.map((d) => d.toolsAdvertised ?? 0)),
    errors: sum(details.map((d) => d.errors)),
    timeouts: details.filter((d) => d.timedOut).length,
    toolCalls: sum(details.map((d) => d.toolCalls ?? 0)) || null,
    // Efficiency: tokens spent per task actually solved. Penalises an agent
    // that burns context and still fails.
    tokensPerSolve: r.agents[agent].solved
      ? sum(details.map((d) => d.promptTokens + d.completionTokens)) / r.agents[agent].solved
      : Infinity,
  };
}

const S = Object.fromEntries(agents.map((a) => [a, statsFor(a)]));

if (asJson) {
  console.log(JSON.stringify({ model: r.model, runs: runsPerTask, agents: S, tasks: r.tasks }, null, 2));
  process.exit(0);
}

const line = (n = 78) => '─'.repeat(n);
console.log(`\n${line()}`);
console.log(`  Head-to-head: ${agents.map((a) => S[a].label).join('  vs  ')}`);
console.log(`  model ${r.model} · ${runsPerTask} run(s) per task · ${Object.keys(r.tasks).length} tasks`);
console.log(`${line()}\n`);

// ── headline table
const rows = [
  ['Tasks solved', ...agents.map((a) => `${S[a].solved}/${S[a].tasks}  (${pct(S[a].solved, S[a].tasks)})`)],
  ['Median time to solve', ...agents.map((a) => `${fmt(S[a].medianWallMsSolved / 1000)}s`)],
  ['Median wall time (all runs)', ...agents.map((a) => `${fmt(S[a].medianWallMsAll / 1000)}s`)],
  ['LLM requests (total)', ...agents.map((a) => String(S[a].totalRequests))],
  ['Median requests / task', ...agents.map((a) => fmt(S[a].medianRequests, 0))],
  ['Prompt tokens (total)', ...agents.map((a) => `${(S[a].totalPromptTokens / 1000).toFixed(0)}k`)],
  ['Completion tokens (total)', ...agents.map((a) => `${(S[a].totalCompletionTokens / 1000).toFixed(0)}k`)],
  ['Cached prompt tokens', ...agents.map((a) => `${(S[a].cachedTokens / 1000).toFixed(0)}k`)],
  ['Fixed overhead (first request)', ...agents.map((a) => `${(S[a].medianFirstPrompt / 1000).toFixed(1)}k`)],
  ['Tool schemas advertised', ...agents.map((a) => String(S[a].toolsAdvertised))],
  ['Peak context in one request', ...agents.map((a) => `${(S[a].peakContext / 1000).toFixed(0)}k`)],
  ['Tokens per solved task', ...agents.map((a) => (Number.isFinite(S[a].tokensPerSolve) ? `${(S[a].tokensPerSolve / 1000).toFixed(0)}k` : '-'))],
  ['Tool calls', ...agents.map((a) => (S[a].toolCalls ? String(S[a].toolCalls) : 'n/a'))],
  ['Provider errors', ...agents.map((a) => String(S[a].errors))],
  ['Timeouts', ...agents.map((a) => String(S[a].timeouts))],
];

const w0 = Math.max(...rows.map((x) => x[0].length)) + 2;
const w = agents.map((a, i) => Math.max(S[a].label.length, ...rows.map((x) => String(x[i + 1]).length)) + 2);
console.log('  ' + 'Metric'.padEnd(w0) + agents.map((a, i) => S[a].label.padEnd(w[i])).join(''));
console.log('  ' + '─'.repeat(w0 + sum(w)));
for (const row of rows) {
  const label = row[0].padEnd(w0);
  const cells = agents.map((a, i) => String(row[i + 1]).padEnd(w[i])).join('');
  console.log('  ' + label + cells);
}

// ── per-task matrix
console.log(`\n${line()}`);
console.log('  Per task (solved / runs)\n');
const taskNames = Object.keys(r.tasks).sort();
const tw = Math.max(...taskNames.map((t) => t.length)) + 2;
const cw = agents.map((a) => Math.max(S[a].label.length, 6) + 2);
console.log('  ' + 'Task'.padEnd(tw) + 'Category'.padEnd(15) + agents.map((a, i) => S[a].label.padEnd(cw[i])).join(''));
console.log('  ' + '─'.repeat(tw + 15 + sum(cw)));
let wins = Object.fromEntries(agents.map((a) => [a, 0]));
for (const t of taskNames) {
  const cells = agents.map((a) => {
    const n = r.tasks[t].solverByAgent?.[a] ?? 0;
    return `${n}/${runsPerTask}`.padEnd(cw[agents.indexOf(a)]);
  });
  const counts = agents.map((a) => r.tasks[t].solverByAgent?.[a] ?? 0);
  const best = Math.max(...counts);
  for (const a of agents) if ((r.tasks[t].solverByAgent?.[a] ?? 0) === best && best > 0) wins[a]++;
  console.log('  ' + t.padEnd(tw) + String(r.tasks[t].category ?? '').padEnd(15) + cells.join(''));
}

// ── tasks one agent solved and another never did: the sharpest signal
console.log(`\n${line()}`);
const onlyOne = taskNames.filter((t) => {
  const counts = agents.map((a) => r.tasks[t].solverByAgent?.[a] ?? 0);
  return Math.max(...counts) > 0 && Math.min(...counts) === 0;
});
if (onlyOne.length && agents.length === 2) {
  console.log('  Solved by exactly one agent\n');
  for (const t of onlyOne) {
    const counts = agents.map((a) => r.tasks[t].solverByAgent?.[a] ?? 0);
    const winner = agents[counts.indexOf(Math.max(...counts))];
    const loser = agents[1 - counts.indexOf(Math.max(...counts))];
    console.log(`    ${t.padEnd(tw)} ${S[winner].label}  (${counts.join(' vs ')}, ${S[loser].label} never)`);
  }
} else {
  console.log('  No task separated the agents by a full miss.');
}
console.log(`\n  Task wins: ${agents.map((a) => `${S[a].label} ${wins[a]}`).join('   ')}`);

// ── verdict
console.log(`\n${line()}`);
if (agents.length === 2) {
  const [a, b] = agents;
  const lead = (k, lowerIsBetter = false) => {
    const va = S[a][k];
    const vb = S[b][k];
    if (va === vb) return null;
    const aWins = lowerIsBetter ? va < vb : va > vb;
    return aWins ? a : b;
  };
  const solveLead = lead('solveRate');
  const tokLead = lead('totalPromptTokens', true);
  const speedLead = lead('medianWallMsSolved', true);
  console.log(
    `  Verdict: ${solveLead ? `${S[solveLead].label} solves more tasks (${pct(S[solveLead].solveRate, 1)} vs ${pct(S[solveLead === a ? b : a].solveRate, 1)})` : 'both agents solve tasks at the same rate'}`,
  );
  console.log(
    `           ${tokLead ? `${S[tokLead].label} is cheaper on prompt tokens` : 'token spend is level'}` +
      `${speedLead ? `, ${S[speedLead].label} is faster when it solves` : ''}.`,
  );
  // Honesty check: with 3 runs per task the confidence interval is wide. Say so.
  const solves = S[a].solved + S[b].solved;
  if (solves < 40) {
    console.log(
      `           Note: ${S[a].solved + S[b].solved} solved runs is a small sample — differences under ~15 points ` +
        `are within noise. Raise --runs and add tasks before treating a close result as decided.`,
    );
  }
} else if (agents.length > 2) {
  const best = agents.reduce((x, y) => (S[y].solveRate > S[x].solveRate ? y : x), agents[0]);
  console.log(`  Verdict: ${S[best].label} solves the most tasks (${pct(S[best].solveRate, S[best].tasks)}).`);
}
console.log(`${line()}\n`);
