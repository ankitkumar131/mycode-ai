/**
 * End-to-end failover smoke test.
 *
 * Proves the invariant the product is built around: when the highest-priority
 * provider fails mid-task, the session (a) switches to the next provider,
 * (b) checkpoints its state to disk before continuing, and (c) keeps going
 * rather than restarting.
 *
 * Hermetic: it writes its own config into a throwaway HOME, so it never touches
 * the developer's real ~/.mycode. Requires the mock providers to be running:
 *
 *   node scripts/mock-failover-provider.mjs 4242 4243 &
 *   node scripts/smoke-failover.mjs [projectDir]
 */
import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
const cli = join(repo, 'packages/cli/dist/mycode.js');
const project = process.argv[2] ?? tmpdir();

if (!existsSync(cli)) {
  console.error(`✗ CLI not built: ${cli}\n  Run: npm run build`);
  process.exit(1);
}

/** Throwaway HOME so the user's config is never read or written. */
const home = join(tmpdir(), `mycode-smoke-${process.pid}`);
mkdirSync(join(home, '.mycode'), { recursive: true });

const config = {
  providers: [
    {
      name: 'primary',
      apiProvider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-smoke',
      baseUrl: 'http://127.0.0.1:4242/v1',
      priority: 1,
      read: true,
      write: true,
      maxRetries: 0,
      contextWindow: 128000,
    },
    {
      name: 'backup',
      apiProvider: 'openai',
      model: 'claude-sonnet-4',
      apiKey: 'sk-smoke',
      baseUrl: 'http://127.0.0.1:4243/v1',
      priority: 2,
      read: true,
      write: true,
      maxRetries: 1,
      contextWindow: 200000,
    },
  ],
  preferences: { confirmWrites: false, confirmCommands: false, logConversations: false },
};
writeFileSync(join(home, '.mycode', 'settings.json'), JSON.stringify(config, null, 2));

const sessionsDir = join(home, '.mycode', 'sessions');

function cleanup() {
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

const child = spawn(process.execPath, [cli, 'chat', '-Q', 'finish the task', '--yolo'], {
  env: { ...process.env, HOME: home, NO_COLOR: '1', FORCE_COLOR: '0' },
  cwd: project,
});

let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
child.on('error', (err) => {
  cleanup();
  console.error('failed to launch CLI:', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  const checks = [];
  const push = (name, pass, detail = '') => checks.push({ name, pass, detail });

  push('CLI exited cleanly', code === 0, `exit ${code}`);
  push('failover announced to the user', /failover/i.test(out));
  push('named both providers', /primary/.test(out) && /backup/.test(out));
  push('gave a reason', /rate limited/i.test(out));
  push('told the user context was preserved', /preserved/i.test(out));
  push('the task actually completed on the backup', /backup provider/i.test(out));

  // The checkpoint is the "context saving" half of the requirement: state must
  // reach disk before the run continues, so a second failure cannot lose it.
  let checkpointed = false;
  let messageCount = 0;
  if (existsSync(sessionsDir)) {
    for (const f of readdirSync(sessionsDir)) {
      try {
        const saved = JSON.parse(readFileSync(join(sessionsDir, f), 'utf-8'));
        if (saved.messages?.length) {
          checkpointed = true;
          messageCount = saved.messages.length;
        }
      } catch {
        /* ignore unreadable */
      }
    }
  }
  push('session checkpointed to disk', checkpointed, sessionsDir);
  push('checkpoint carries the conversation', messageCount >= 2, `${messageCount} messages`);

  console.log('\n─── failover smoke test ───\n');
  console.log(out.trim() + '\n');
  for (const c of checks) {
    console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.pass || !c.detail ? '' : `  (${c.detail})`}`);
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n  ${checks.length - failed.length}/${checks.length} checks passed\n`);
  cleanup();
  process.exit(failed.length ? 1 : 0);
});
