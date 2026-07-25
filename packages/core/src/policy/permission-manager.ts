import chalk from 'chalk';
import * as readline from 'readline';
import { theme } from '../../../../packages/cli/src/ui/themes/theme.js';

export type Effect = 'allow' | 'deny' | 'ask';
export type Reply = 'once' | 'always' | 'reject';

export interface PermissionRule {
  permission: string;
  pattern: string;
  action: Effect;
  reason?: string;
}

export type RulesetArray = PermissionRule[];

interface PendingRequest {
  id: string;
  action: string;
  resource: string;
  agent?: string;
  resolve: (value: boolean) => void;
  reject: () => void;
}

export type PermissionPromptRequest = {
  toolName: string;
  resource: string;
  args: Record<string, unknown>;
  isDangerous: boolean;
};

export type PermissionPromptReply = 'once' | 'always' | 'reject';

export type PermissionPromptFunction = (
  req: PermissionPromptRequest
) => Promise<PermissionPromptReply>;

function wildcardMatch(input: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp('^' + escaped + '$', 's').test(input);
}

function findLastMatch(
  action: string,
  resource: string,
  ruleset: RulesetArray
): { effect: Effect; reason?: string } | undefined {
  let match: { effect: Effect; reason?: string } | undefined;
  for (const rule of ruleset) {
    if (
      wildcardMatch(action, rule.permission) &&
      wildcardMatch(resource, rule.pattern)
    ) {
      match = { effect: rule.action, reason: rule.reason };
    }
  }
  return match;
}

function evaluate(
  action: string,
  resource: string,
  ...rulesets: RulesetArray[]
): { effect: Effect; reason?: string } {
  const merged = rulesets.flat();
  return (
    findLastMatch(action, resource, merged) ?? {
      effect: 'ask',
    }
  );
}

const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-rf/,
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+DATABASE\b/i,
  /git\s+push\s+.*--force/,
  /git\s+push\s+.*-f\b/,
  /chmod\s+-R\s*777/,
  /\bsudo\b/,
  /\bdd\s+if=/,
  />\s*\/dev\/sd/,
  /mkfs\.\w+/,
  /:()\s*\{.*:\s*\}.*:/,
  /curl\s+.*\|\s*bash/,
  /wget\s+.*\|\s*bash/,
  /pkill\s+-9/,
  /killall\s+/,
  /shutdown\s+now/,
  /reboot\b/,
];

const READONLY_COMMAND_PATTERNS: string[] = [
  'git status*',
  'git log*',
  'git diff*',
  'git show*',
  'git branch*',
  'git stash*',
  'git remote*',
  'git tag*',
  'git config*',
  'git ls-*',
  'git shortlog*',
  'git describe*',
  'git grep*',
  'git blame*',
  'git rev-*',
  'git help*',
  'ls*',
  'cat *',
  'pwd',
  'which *',
  'head *',
  'tail *',
  'wc *',
  'echo *',
  'find *',
  'grep *',
  'rg *',
  'type *',
  'file *',
  'stat *',
  'du *',
  'df *',
  'env',
  'export',
  'printenv*',
  'date',
  'node --version',
  'npm --version',
  'npx --version',
  'tsc --noEmit*',
  'tsc --version',
  'eslint --print-config*',
  'prettier --check*',
  'gh pr view*',
  'gh issue view*',
  'gh repo list*',
  'docker ps*',
  'docker images*',
  'kubectl get*',
  'ps *',
];

const DEFAULT_RULES: RulesetArray = [
  { permission: 'read_file', pattern: '*', action: 'allow' },
  { permission: 'search_files', pattern: '*', action: 'allow' },
  { permission: 'url_fetch', pattern: '*', action: 'allow' },
  { permission: 'web_search', pattern: '*', action: 'allow' },
  { permission: 'read_instructions', pattern: '*', action: 'allow' },
  { permission: 'todo_read', pattern: '*', action: 'allow' },
  { permission: 'todo_write', pattern: '*', action: 'allow' },
  { permission: 'question', pattern: '*', action: 'allow' },
  { permission: 'task', pattern: '*', action: 'allow' },
  { permission: 'delegate', pattern: '*', action: 'allow' },
  { permission: 'switch_to_agent_mode', pattern: '*', action: 'allow' },
  { permission: 'write_file', pattern: '*', action: 'ask' },
  { permission: 'edit_file', pattern: '*', action: 'ask' },
  { permission: 'run_command', pattern: '*', action: 'ask' },
  { permission: 'code_exec', pattern: '*', action: 'ask' },
  ...READONLY_COMMAND_PATTERNS.map((p) => ({
    permission: 'run_command',
    pattern: p,
    action: 'allow' as const,
  })),
];

let sessionSavedRules: RulesetArray = [];
let currentAgent: string | undefined = undefined;
let parentAgent: string | undefined = undefined;

export function setCurrentAgent(name: string | undefined): void {
  currentAgent = name;
}

export function getCurrentAgent(): string | undefined {
  return currentAgent;
}

export function setParentAgent(name: string | undefined): void {
  parentAgent = name;
}

export function getParentAgent(): string | undefined {
  return parentAgent;
}

function getResource(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'write_file':
      return String(args.path || args.targetFile || '');
    case 'edit_file':
      return String(args.path || args.targetFile || '');
    case 'run_command':
    case 'exec_command':
      return String(args.command || args.commandLine || '');
    case 'code_exec':
      return String(args.code || '').slice(0, 80);
    default:
      return String(args.path || args.command || args.pattern || '*');
  }
}

export interface PermissionCheckOptions {
  agentName?: string;
}

export class PermissionManager {
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestCounter = 0;
  private sessionLevel: 'allow' | 'deny' | 'ask' | null = null;
  private promptFn: PermissionPromptFunction | null = null;

  setSessionLevel(level: 'allow' | 'deny' | 'ask' | null): void {
    this.sessionLevel = level;
  }

  getSessionLevel(): 'allow' | 'deny' | 'ask' | null {
    return this.sessionLevel;
  }

  setPromptFunction(fn: PermissionPromptFunction | null): void {
    this.promptFn = fn;
  }

  isDangerousCommand(command: string): boolean {
    return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
  }

  async check(
    toolName: string,
    args: Record<string, unknown>,
    opts: PermissionCheckOptions = {}
  ): Promise<boolean> {
    if (this.sessionLevel === 'allow') return true;
    if (this.sessionLevel === 'deny') return false;

    const resource = getResource(toolName, args);
    const resolvedAgent = opts.agentName ?? currentAgent;

    const allRules: RulesetArray = [...DEFAULT_RULES, ...sessionSavedRules];
    const rule = evaluate(toolName, resource, allRules);

    if (rule.effect === 'allow') return true;
    if (rule.effect === 'deny') return false;

    const isDangerous =
      (toolName === 'run_command' || toolName === 'exec_command') &&
      this.isDangerousCommand(resource);

    if (resolvedAgent && resolvedAgent !== 'build') {
      return false;
    }

    return this.promptUser(toolName, resource, args, isDangerous);
  }

  private promptUser(
    toolName: string,
    resource: string,
    args: Record<string, unknown>,
    isDangerous: boolean
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const id = `req_${++this.requestCounter}`;
      this.pendingRequests.set(id, {
        id,
        action: toolName,
        resource,
        resolve,
        reject: () => resolve(false),
      });

      const replyHandler = (reply: PermissionPromptReply) => {
        this.pendingRequests.delete(id);
        if (reply === 'once') {
          resolve(true);
        } else if (reply === 'always') {
          sessionSavedRules.push({
            permission: toolName,
            pattern: '*',
            action: 'allow',
          });
          resolve(true);
        } else {
          resolve(false);
        }
      };

      if (this.promptFn) {
        this.promptFn({
          toolName,
          resource,
          args,
          isDangerous,
        }).then(replyHandler);
        return;
      }

      this.renderReadlinePrompt(toolName, resource, args, isDangerous, replyHandler);
    });
  }

  private renderReadlinePrompt(
    toolName: string,
    resource: string,
    args: Record<string, unknown>,
    isDangerous: boolean,
    onReply: (reply: PermissionPromptReply) => void
  ) {
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      onReply('reject');
      return;
    }

    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) {
      stdin.setRawMode(false);
    }

    const prompt = isDangerous
      ? `Dangerous Operation: ${toolName} -> ${resource}\nAllow? (y/N): `
      : `Permission Request: ${toolName} -> ${resource}\n[y] Once  [a] Always for session  [n] Deny: `;

    const rl = readline.createInterface({ input: stdin, output: process.stdout });

    rl.question(prompt, (answer) => {
      rl.close();

      if (stdin.isTTY && wasRaw) {
        stdin.setRawMode(true);
      }

      const a = answer.trim().toLowerCase();
      if (a === 'y' || a === 'yes') {
        onReply('once');
      } else if (a === 'a' || a === 'always') {
        onReply('always');
      } else {
        onReply('reject');
      }
    });
  }
}

export const permissionManager = new PermissionManager();
