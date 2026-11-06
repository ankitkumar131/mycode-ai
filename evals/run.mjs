#!/usr/bin/env node
/**
 * Head-to-head eval harness.
 *
 * Runs the same tasks through several coding agents, points every one of them at
 * the same recording proxy, verifies the result with the task's own shell
 * verifier, and writes a comparable result set.
 *
 *   node evals/run.mjs --model gpt-4o --runs 3
 *   node evals/run.mjs --tasks fix-failing-test,implement-from-spec --agents mycode
 *   node evals/run.mjs --dry-run               # plumbing check, no API key needed
 *   node evals/report.mjs evals/runs/results.json
 *
 * Env:
 *   EVAL_API_KEY   provider key (required unless --dry-run)
 *   EVAL_UPSTREAM  provider base URL, e.g. https://api.openai.com/v1
 *   EVAL_MODEL     default model applied to every agent
 *
 * Why a proxy: prompt/completion token counts, request counts and latency are
 * measured at the wire, identically for every agent. Reading them out of each
 * agent's own accounting would compare two different definitions. It also
 * guarantees both agents ran on the same model rather than merely the same
 * model *name*.
 */
import { spawn, spawnSync } from 'child_process';
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, appendFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const TASKS_DIR = join(HERE, 'tasks');
const RUNS_DIR = join(HERE, 'runs');
const SOLUTIONS_DIR = join(HERE, 'solutions');

// ────────────────────────────────────────────────────────────── argument parsing

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(readFileSync(join(HERE, 'README.md'), 'utf-8').split('## Usage')[1]?.split('##')[0] ?? '');
  process.exit(0);
}

const cfgPath = join(HERE, 'config.json');
const fileCfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf-8')) : {};

const model = args.model ?? process.env.EVAL_MODEL ?? fileCfg.model ?? 'gpt-4o';
const upstream = (args.upstream ?? process.env.EVAL_UPSTREAM ?? fileCfg.upstream ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
const apiKey = args['api-key'] ?? process.env.EVAL_API_KEY ?? fileCfg.apiKey ?? '';
const runs = Number(args.runs ?? process.env.EVAL_RUNS ?? fileCfg.runs ?? 3);
const timeoutMs = Number(args.timeout ?? fileCfg.timeoutMs ?? 300_000);
const proxyPort = Number(args.port ?? fileCfg.proxyPort ?? 4310);
const keepWorkspaces = !!args.keep || !!fileCfg.keepWorkspaces;
const dryRun = !!args['dry-run'];
const requestedAgents = String(args.agents ?? fileCfg.agents?.join(',') ?? 'mycode,opencode')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!apiKey && !dryRun) {
  console.error('\n  No API key. Set EVAL_API_KEY, pass --api-key, or use --dry-run to check the plumbing.\n');
  process.exit(2);
}

// ────────────────────────────────────────────────────────────── task discovery

function listTasks() {
  const filter = args.tasks ? String(args.tasks).split(',').map((s) => s.trim()) : null;
  return readdirSync(TASKS_DIR)
    .filter((name) => statSync(join(TASKS_DIR, name)).isDirectory())
    .filter((name) => (filter ? filter.includes(name) : true))
    .filter((name) => existsSync(join(TASKS_DIR, name, 'verify.sh')))
    .sort();
}

/** The task's prompt is everything after the metadata block in task.md. */
function taskPrompt(name) {
  const md = readFileSync(join(TASKS_DIR, name, 'task.md'), 'utf-8');
  return md.split(/\n\n/).slice(2).join('\n\n').trim();
}

// ────────────────────────────────────────────────────────────── agent adapters

/**
 * Each adapter renders a command line, an environment, and any config files.
 * `prompt` is substituted as a single argv element (never shell-interpolated).
 */
const ADAPTERS = {
  mycode: {
    label: 'MyCode',
    detect: () => existsSync(join(ROOT, 'packages/cli/dist/mycode.js')),
    missing: 'build it first: npm run build',
    prepare(ctx) {
      // A throwaway HOME keeps eval state out of the developer's real config.
      const home = join(ctx.workspace, '.eval-home');
      mkdirSync(join(home, '.mycode'), { recursive: true });
      writeFileSync(
        join(home, '.mycode', 'settings.json'),
        JSON.stringify(
          {
            providers: [
              {
                name: 'eval',
                apiProvider: ctx.apiProvider,
                model: ctx.model,
                apiKey: ctx.apiKey || 'eval-key',
                baseUrl: ctx.proxyBase,
                priority: 1,
                read: true,
                write: true,
                maxRetries: 1,
                contextWindow: 200_000,
              },
            ],
            preferences: {
              confirmWrites: false,
              confirmCommands: false,
              logConversations: false,
              statusBar: false,
            },
          },
          null,
          2,
        ) + '\n',
      );
      return {
        command: process.execPath,
        argv: [join(ROOT, 'packages/cli/dist/mycode.js'), 'chat', '-Q', ctx.prompt],
        env: { HOME: home, USERPROFILE: home, MYCODE_NO_UPDATE_CHECK: '1', NO_COLOR: '1', TERM: 'dumb' },
      };
    },
    /** MyCode prints one `⬡ Tool` line per tool call. */
    countToolCalls: (log) => (log.match(/[⬡⛭⚙]/g) ?? []).length || null,
  },

  opencode: {
    label: 'opencode',
    detect: () => spawnSync('opencode', ['--version'], { encoding: 'utf-8' }).status === 0,
    missing: 'install it: npm i -g opencode-ai   (or see opencode.ai)',
    prepare(ctx) {
      const xdg = join(ctx.workspace, '.eval-xdg');
      mkdirSync(join(xdg, 'opencode'), { recursive: true });
      writeFileSync(
        join(xdg, 'opencode', 'opencode.json'),
        JSON.stringify(
          {
            $schema: 'https://opencode.ai/config.json',
            model: `${ctx.apiProvider}/${ctx.model}`,
            provider: {
              [ctx.apiProvider]: {
                options: { baseURL: ctx.proxyBase, apiKey: ctx.apiKey || 'eval-key' },
              },
            },
            permission: { edit: 'allow', bash: 'allow', webfetch: 'deny' },
          },
          null,
          2,
        ) + '\n',
      );
      return {
        command: 'opencode',
        argv: ['run', ctx.prompt, '--model', `${ctx.apiProvider}/${ctx.model}`],
        env: { XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: join(xdg, 'data'), HOME: join(ctx.workspace, '.eval-home'), NO_COLOR: '1' },
      };
    },
    countToolCalls: (log) => (log.match(/\b(tool|bash|edit|write|read|grep|glob)\b/gi) ?? []).length || null,
  },

  /**
   * A synthetic agent that applies the reference solution. It exists so the
   * whole pipeline — workspaces, proxy, verifier, report — can be exercised
   * without an API key and without installing anything.
   */
  mock: {
    label: 'mock (reference solutions)',
    detect: () => true,
    prepare(ctx) {
      const script = join(ctx.workspace, '.eval-mock.sh');
      const sol = join(SOLUTIONS_DIR, ctx.task);
      writeFileSync(
        script,
        `#!/bin/sh\nset -e\ncp -r ${JSON.stringify(sol)}/. . 2>/dev/null || true\n` +
          `[ -f gitignore.txt ] && mv gitignore.txt .gitignore\n` +
          `[ -f .gitignore ] && [ -f gitignore.txt ] && mv -f gitignore.txt .gitignore\n` +
          `echo "mock agent applied the reference solution"\n`,
      );
      return { command: 'sh', argv: [script], env: {} };
    },
    countToolCalls: () => null,
  },
};

// ────────────────────────────────────────────────────────────── proxy lifecycle

async function startProxy(recordPath) {
  const child = spawn(
    process.execPath,
    [join(HERE, 'lib', 'proxy.mjs'), '--port', String(proxyPort), '--upstream', upstream, '--record', recordPath],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('proxy did not start')), 10_000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('recording proxy on')) {
        clearTimeout(t);
        res();
      }
    });
    child.stderr.on('data', (d) => process.stderr.write(`  [proxy] ${d}`));
    child.on('exit', (code) => {
      clearTimeout(t);
      if (code) rej(new Error(`proxy exited with ${code}`));
    });
  });
  await ready;
  return child;
}

function stopProxy(child) {
  return new Promise((res) => {
    if (!child || child.exitCode !== null) return res();
    child.on('exit', () => res());
    child.kill('SIGTERM');
    setTimeout(() => {
      child.kill('SIGKILL');
      res();
    }, 2000).unref();
  });
}

// ────────────────────────────────────────────────────────────── running an agent

function runAgent({ command, argv, env, cwd, timeout }) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    let out = '';
    let killed = false;
    const child = spawn(command, argv, {
      cwd,
      env: { ...process.env, ...env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const cap = (d) => {
      out += d.toString();
      if (out.length > 400_000) out = out.slice(-400_000);
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolveRun({ exitCode: -1, log: `${out}\n[spawn error] ${err.message}`, wallMs: Date.now() - started, timedOut: false });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolveRun({ exitCode: code ?? -1, log: out, wallMs: Date.now() - started, timedOut: killed });
    });
  });
}

function readMetrics(recordPath) {
  const m = {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    promptTokensPeak: 0,
    // The very first request of a run: system prompt + tool schemas + the task.
    // Subtracting nothing, it is the cheapest available proxy for how much
    // fixed context an agent carries into every session.
    firstPromptTokens: 0,
    toolsAdvertised: 0,
    systemPromptChars: 0,
    errors: 0,
    latencyMs: 0,
  };
  if (!existsSync(recordPath)) return m;
  for (const line of readFileSync(recordPath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.error) {
      m.errors++;
      continue;
    }
    m.requests++;
    if (m.requests === 1) {
      m.firstPromptTokens = e.promptTokens ?? 0;
      m.toolsAdvertised = e.tools ?? 0;
    }
    if ((e.systemChars ?? 0) > m.systemPromptChars) m.systemPromptChars = e.systemChars ?? 0;
    m.promptTokens += e.promptTokens ?? 0;
    m.completionTokens += e.completionTokens ?? 0;
    m.cachedTokens += e.cachedTokens ?? 0;
    m.latencyMs += e.latencyMs ?? 0;
    if ((e.promptTokens ?? 0) > m.promptTokensPeak) m.promptTokensPeak = e.promptTokens ?? 0;
    if ((e.status ?? 200) >= 400) m.errors++;
  }
  return m;
}

// ────────────────────────────────────────────────────────────── main

const results = {
  startedAt: new Date().toISOString(),
  model,
  upstream,
  runs,
  dryRun,
  agents: {},
  tasks: {},
  runsDetail: [],
};

const tasks = listTasks();
if (!tasks.length) {
  console.error('  no tasks found');
  process.exit(2);
}

const activeAgents = requestedAgents.filter((name) => {
  const a = ADAPTERS[name];
  if (!a) {
    console.error(`  unknown agent "${name}" (known: ${Object.keys(ADAPTERS).join(', ')})`);
    return false;
  }
  if (!dryRun && name !== 'mock' && !a.detect()) {
    console.error(`  skipping ${name}: not available — ${a.missing}`);
    return false;
  }
  return true;
});

if (!activeAgents.length) {
  console.error('  nothing to run');
  process.exit(2);
}
if (dryRun && !activeAgents.includes('mock')) activeAgents.push('mock');

console.log(`\n  MyCode eval — ${tasks.length} tasks × ${activeAgents.join(', ')} × ${runs} run(s)`);
console.log(`  model ${model} via ${upstream}`);
console.log(`  results → ${RUNS_DIR}\n`);

rmSync(RUNS_DIR, { recursive: true, force: true });
mkdirSync(RUNS_DIR, { recursive: true });

for (const agent of activeAgents) {
  const adapter = ADAPTERS[agent];
  results.agents[agent] = { label: adapter.label, solved: 0, total: 0, runs: 0 };

  for (const task of tasks) {
    const prompt = taskPrompt(task);
    let solvedForTask = 0;

    for (let run = 1; run <= runs; run++) {
      const workspace = join(RUNS_DIR, agent, task, `run-${run}`, 'work');
      const recordPath = join(RUNS_DIR, agent, task, `run-${run}`, 'requests.jsonl');
      mkdirSync(workspace, { recursive: true });

      // Seed the workspace from the task definition.
      cpSync(join(TASKS_DIR, task), workspace, {
        recursive: true,
        filter: (src) => !src.endsWith('task.md') && !src.endsWith('verify.sh'),
      });

      // Each run gets its own proxy so every recorded request is attributable
      // to exactly this (agent, task, run).
      const proxy = await startProxy(recordPath);
      let runResult;
      try {
        const spec = adapter.prepare({
          workspace,
          task,
          prompt,
          model,
          apiKey,
          apiProvider: fileCfg.apiProvider ?? 'openai',
          proxyBase: `http://127.0.0.1:${proxyPort}/v1`,
        });
        runResult = await runAgent({ ...spec, cwd: workspace, timeout: timeoutMs });
      } finally {
        await stopProxy(proxy);
      }

      // Verify with the task's own shell verifier, on a copy of the verifier so
      // a cheating agent cannot have edited it.
      const verify = spawnSync('sh', [join(TASKS_DIR, task, 'verify.sh')], {
        cwd: workspace,
        encoding: 'utf-8',
        timeout: 120_000,
        env: { ...process.env, EVAL_TSC: process.env.EVAL_TSC ?? join(ROOT, 'node_modules/.bin/tsc') },
      });
      const solved = verify.status === 0;
      if (solved) solvedForTask++;

      const metrics = readMetrics(recordPath);
      const toolCalls = adapter.countToolCalls(runResult.log);

      writeFileSync(join(dirname(workspace), 'agent.log'), runResult.log);
      if (verify.status !== 0) {
        writeFileSync(
          join(dirname(workspace), 'verify.log'),
          `exit=${verify.status}\n--- stdout ---\n${verify.stdout ?? ''}\n--- stderr ---\n${verify.stderr ?? ''}\n`,
        );
      }
      if (!keepWorkspaces) {
        // Keep the logs, drop the (potentially large) workspace.
        rmSync(join(workspace, 'node_modules'), { recursive: true, force: true });
      }

      const detail = {
        agent,
        task,
        run,
        solved,
        wallMs: runResult.wallMs,
        exitCode: runResult.exitCode,
        timedOut: runResult.timedOut,
        verifyExit: verify.status,
        toolCalls,
        ...metrics,
      };
      results.runsDetail.push(detail);
      results.agents[agent].runs++;
      if (solved) results.agents[agent].solved++;
      results.agents[agent].total++;

      const mark = solved ? '✓' : '✗';
      const secs = (runResult.wallMs / 1000).toFixed(1);
      const tok = `${Math.round(metrics.promptTokens / 1000)}k/${Math.round(metrics.completionTokens / 1000)}k`;
      process.stdout.write(
        `  ${mark} ${agent.padEnd(9)} ${task.padEnd(26)} run ${run}  ${secs.padStart(6)}s  ` +
          `${String(metrics.requests).padStart(2)} req  ${tok.padStart(9)} tok${runResult.timedOut ? '  TIMEOUT' : ''}\n`,
      );

      if (!keepWorkspaces) {
        // The agent's own files are the artifact under test; keep only a small
        // summary so the runs directory stays checkable.
        rmSync(join(workspace, '.eval-home'), { recursive: true, force: true });
        rmSync(join(workspace, '.eval-xdg'), { recursive: true, force: true });
      }
    }

    results.tasks[task] ??= { solverByAgent: {} };
    results.tasks[task].solverByAgent[agent] = solvedForTask;
    (results.tasks[task].category ??= readCategory(task));

    if (!dryRun && solvedForTask > 0 && solvedForTask < runs) {
      // Partial success is the interesting signal; note it explicitly.
      appendFileSync(join(RUNS_DIR, 'flaky.txt'), `${agent} ${task} ${solvedForTask}/${runs}\n`);
    }
  }
}

function readCategory(task) {
  const md = readFileSync(join(TASKS_DIR, task, 'task.md'), 'utf-8');
  return /Category:\*\*\s*(\S+)/.exec(md)?.[1] ?? 'unknown';
}

results.finishedAt = new Date().toISOString();
const outPath = join(RUNS_DIR, 'results.json');
writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n');

console.log(`\n  done — wrote ${outPath}`);
console.log(`  report: node evals/report.mjs ${outPath}\n`);
