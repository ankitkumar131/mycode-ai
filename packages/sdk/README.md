# @mycode/sdk

Programmatic API for the [MyCode](https://github.com/ankitkumar131/mycode-ai) agent — embed the
terminal agent's loop in your own app: same provider routing, same failover, same 22 tools.

## Install

```bash
npm install @mycode/sdk @mycode/core
```

## Quick start

```ts
import { MyCodeAgent } from '@mycode/sdk';

const agent = new MyCodeAgent({
  cwd: process.cwd(),
  providers: [
    {
      name: 'openrouter',
      apiProvider: 'openrouter',
      model: 'google/gemini-2.5-flash',
      apiKey: process.env.OPENROUTER_API_KEY,
      priority: 1,
      read: true,
      write: true,
    },
    {
      name: 'local',
      apiProvider: 'ollama',
      model: 'llama3.1:8b',
      baseUrl: 'http://localhost:11434',
      priority: 2,
      read: true,
      write: false,
    },
  ],
});

const answer = await agent.run('summarise src/', {
  events: {
    onText: (text) => process.stdout.write(text),
    onToolCall: (call) => console.log(`\n→ ${call.name}`),
    onFailover: (event) => console.warn(`switched ${event.from} → ${event.to} (${event.reason})`),
  },
});
```

Providers are tried in priority order, so the second one is what answers when the first
rate-limits or goes down. The run is checkpointed before it continues.

## Approvals are fail-closed

An embedded agent must not silently write files, so **writes and shell commands are refused unless
you say otherwise**:

```ts
// 1. Decide per request (recommended)
const agent = new MyCodeAgent({
  confirm: async ({ target, context, safety }) => {
    if (safety?.level === 'dangerous') return false;
    return await askTheUser(`${target}?`); // your UI
  },
});

// 2. Or opt out entirely, like `mycode agent --yolo`
const trusted = new MyCodeAgent({ autoApprove: true });
```

With neither, the model still _plans_ writes and calls the tool — the tool reports it was
cancelled and the run continues, so nothing is lost and nothing is written.

## Extensions

```ts
// A tool the model can call, alongside the built-ins
agent.registerTool({
  name: 'deploy',
  description: 'Deploy the application',
  parameters: {
    type: 'object',
    properties: { environment: { type: 'string' } },
    required: ['environment'],
  },
  handler: async ({ environment }) => `deployed to ${environment}`,
});

// A provider backend: any config with apiProvider: 'acme-llm' now routes here
agent.registerProvider({
  id: 'acme-llm',
  create: (config) => new AcmeProvider(config), // extends BaseProvider from @mycode/core
});
```

## Skills

```ts
await agent.loadSkills('./skills'); // discover <dir>/<name>/SKILL.md
const body = await agent.readSkill('deploy-checklist');
```

Discovered skills reach the agent's skill index and the `skill_view` tool, exactly as they do in
the CLI.

## API

| Member                                      | Purpose                                                                                                                                                         |
| :------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new MyCodeAgent(config)`                   | `cwd`, `providers`, `provider`, `model`, `maxIterations`, `tools`, `toolsets`, `systemPrompt`, `autoApprove`, `confirm`, `askUser`, `persistSessions`, `verify` |
| `run(input, options?)`                      | Runs one turn. `options`: `signal` (abort), `events`, `maxIterations`. Resolves with the final text                                                             |
| `abort()` · `newSession()` · `getSession()` | Stop the current run; start a fresh conversation; reach the live session (registry, usage, id)                                                                  |
| `registerTool()` · `registerProvider()`     | Extension points                                                                                                                                                |
| `loadSkills()` · `readSkill()`              | Skills                                                                                                                                                          |
| `loadConfig(path?)` · `listProviders()`     | Load `~/.mycode/settings.json` (or a JSON file) and inspect the chain                                                                                           |
| `getInfo()`                                 | `version`, `model`, `provider`, `tools`, `skills`, `uptime`, `sessionId`                                                                                        |

### Events

`onText` · `onReasoning` · `onToolCall` · `onToolResult` · `onError` · `onUsage` · `onFailover` ·
`onCompress` · `onFinish`

### What is wired for you

Provider routing and failover with checkpointing · the full tool registry (files, terminal, git,
web, skills, agent) · post-write formatter + diagnostics verification · sub-agent delegation via
the `delegate` tool · context compaction against the active provider's window · todo/plan state.

Give the host UI a `askUser` bridge and the `question` tool works too; without it the tool reports
itself unavailable rather than silently no-oping.

## Status

In-repo and publishable, but not yet on npm (`@mycode/core` is unpublished as well). Until both are
published, consume it from the monorepo:

```bash
npm run build            # from the repo root: bundles + .d.ts
npm test                 # 464 tests
```

## Licence

MIT — see [LICENSE](../../LICENSE).
