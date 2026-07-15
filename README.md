# ⚡ MyCode

**Multi-Provider AI Coding Agent for the Terminal**

Like Claude Code, but provider-agnostic. Use OpenRouter, NVIDIA NIM, Ollama, OpenAI, or any OpenAI-compatible API — with automatic failover when providers hit rate limits or go down.

```
npm install -g mycode-ai
```

---

## 🚀 Quick Start

```bash
# 1. Install globally
npm install -g mycode-ai

# 2. Configure your AI providers
mycode init

# 3. Start coding with AI
mycode chat
```

## 🎯 Commands

| Command | Description |
|---|---|
| `mycode init` | Setup wizard — configure your AI providers |
| `mycode chat` | Interactive AI conversation with tool access |
| `mycode agent` | Full autonomous coding agent |
| `mycode explain <file>` | Get an AI explanation of any file |
| `mycode fix <file\|error>` | AI-powered error diagnosis and fixing |
| `mycode edit <file> "instruction"` | Apply AI-powered edits to a file |
| `mycode config list` | List configured providers |
| `mycode config test` | Test provider connections |

## ⚡ Multi-Provider Failover

The killer feature. Configure multiple AI providers with priorities:

```json
{
  "providers": [
    {
      "priority": 1,
      "name": "OpenRouter GPT",
      "api_provider": "openrouter",
      "model": "openai/gpt-4o",
      "api_key": "sk-or-xxxx",
      "base_url": "https://openrouter.ai/api/v1",
      "read": true,
      "write": true
    },
    {
      "priority": 2,
      "name": "Local Ollama",
      "api_provider": "ollama",
      "model": "llama3.1:8b",
      "base_url": "http://localhost:11434",
      "read": true,
      "write": false
    }
  ]
}
```

**When Provider #1 fails** (rate limit, server error, auth issue), MyCode **automatically switches** to Provider #2 — seamlessly, with a notification in the terminal.

## 🔧 Supported Providers

| Provider | Type | API Key Required |
|---|---|---|
| **OpenRouter** | 100+ models via one API | ✅ |
| **NVIDIA NIM** | GPU-optimized inference | ✅ |
| **Ollama** | Local, free | ❌ |
| **OpenAI** | Direct API | ✅ |
| **Custom** | Any OpenAI-compatible endpoint | Varies |

## 🛡️ Safety

- **File writes** require confirmation (shows diff preview)
- **Command execution** requires confirmation
- **Dangerous commands** are blocked (rm -rf /, etc.)
- Use `--yes` flag to auto-approve (for experienced users)

## 📁 Configuration

Config is stored at `~/.mycode/settings.json`. You can edit it directly or use:

```bash
mycode config list      # View providers
mycode config test      # Test connections
mycode config remove    # Remove a provider
mycode config path      # Show config file path
```

## 🤖 Agent Mode

The agent can autonomously:
- Read and understand your codebase
- Write new files and edit existing ones
- Search across your project
- Execute shell commands (with confirmation)
- Use git to track changes

```bash
# Single task
mycode agent "create a REST API with Express"

# Interactive mode
mycode agent
```

## 📝 Project Instructions

Create a `MYCODE.md` file in your project root (like Claude's `CLAUDE.md`) to give the AI project-specific instructions:

```markdown
# Project Guidelines

- Use TypeScript strict mode
- Follow the existing patterns in src/
- Always add tests for new functions
- Use Vitest for testing
```

## 📄 License

MIT
