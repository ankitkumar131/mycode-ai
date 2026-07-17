# MyCode Project Context

This is the MyCode AI project — a multi-provider AI coding agent for the terminal.

## Key Facts
- Monorepo with packages: cli, core, sdk, a2a-server, devtools, test-utils
- Built with TypeScript + Ink (React for CLIs)
- Supports multiple AI providers (OpenAI, OpenRouter, Ollama, Google Gemini)
- Skills discovered from ~/.mycode/skills/ and .mycode/skills/
- MYCODE.md files provide hierarchical context
- Configuration at ~/.mycode/settings.json

## Build Commands
- `npm run build` — Build all packages
- `npm test` — Run tests with vitest
- `npm run lint` — Lint with ESLint
- `npm run typecheck` — TypeScript type checking
