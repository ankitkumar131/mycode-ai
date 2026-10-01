import { spawn } from 'node:child_process';
import { BaseProvider } from './base-provider.js';
import type { ProviderConfig } from './types.js';

const MAX_OUTPUT = 200_000;

/**
 * Munder-style external agent adapter.
 *
 * The adapter deliberately uses spawn(argv) rather than a shell so a provider
 * command cannot accidentally become a second shell injection surface. The
 * configured CLI remains responsible for its own authentication and model
 * protocol; MyCode reports failures and lets ProviderRouter fail over.
 */
export class CliAgentProvider extends BaseProvider {
  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    super();
    this.config = config;
  }

  get name(): string {
    return this.config.name;
  }

  get model(): string {
    return this.config.model;
  }

  get canRead(): boolean {
    return this.config.read !== false;
  }

  get canWrite(): boolean {
    return this.config.write !== false;
  }

  private buildPrompt(messages: unknown[]): string {
    return (messages as Array<{ role?: string; content?: unknown }>)
      .map(message => `[${message.role ?? 'message'}]\n${String(message.content ?? '')}`)
      .join('\n\n');
  }

  private commandAndArgs(prompt: string): { command: string; args: string[]; promptOnStdin: boolean } {
    const command = this.config.command?.trim();
    if (!command) {
      throw new Error(`External provider "${this.name}" has no command configured. Set providers[].command.`);
    }

    const configuredArgs = this.config.args ?? [];
    let usedPromptPlaceholder = false;
    const args = configuredArgs.map(arg => {
      let value = String(arg);
      if (value.includes('{prompt}')) {
        usedPromptPlaceholder = true;
        value = value.replaceAll('{prompt}', prompt);
      }
      value = value.replaceAll('{model}', this.model);
      return value;
    });

    return { command, args, promptOnStdin: !usedPromptPlaceholder };
  }

  async chat(messages: unknown[], _tools: unknown[] = [], options: any = {}): Promise<any> {
    const prompt = this.buildPrompt(messages);
    const invocation = this.commandAndArgs(prompt);
    const timeout = Math.max(1_000, this.config.timeout ?? options.timeout ?? 180_000);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const child = spawn(invocation.command, invocation.args, {
        cwd: typeof options.cwd === 'string' ? options.cwd : process.cwd(),
        env: {
          ...process.env,
          ...(this.config.env ?? {}),
          MYCODE_MODEL: this.model,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const finish = (error?: Error, code?: number | null, signal?: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        options.abortSignal?.removeEventListener('abort', abort);

        if (error) {
          this.recordFailure();
          reject(error);
          return;
        }
        if (code !== 0) {
          this.recordFailure();
          const detail = stderr.trim() || stdout.trim() || `process exited with ${signal ?? `code ${code ?? '?'}`}`;
          reject(new Error(`External provider "${this.name}" failed: ${detail.slice(0, 2_000)}`));
          return;
        }
        this.recordSuccess();
        resolve({
          content: stdout.trim(),
          toolCalls: [],
          usage: {},
          finish_reason: 'stop',
        });
      };

      const abort = () => {
        child.kill('SIGTERM');
        finish(new Error(`External provider "${this.name}" request aborted.`));
      };

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        finish(new Error(`External provider "${this.name}" timed out after ${timeout}ms.`));
      }, timeout);

      if (options.abortSignal) {
        if (options.abortSignal.aborted) {
          abort();
          return;
        }
        options.abortSignal.addEventListener('abort', abort, { once: true });
      }

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length >= MAX_OUTPUT) return;
        const text = chunk.toString('utf8');
        stdout = (stdout + text).slice(0, MAX_OUTPUT);
        options.onStream?.(text);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT) stderr = (stderr + chunk.toString('utf8')).slice(0, MAX_OUTPUT);
      });
      child.once('error', error => finish(new Error(`Unable to start external provider "${this.name}": ${error.message}`)));
      child.once('close', (code, signal) => finish(undefined, code, signal));

      if (invocation.promptOnStdin) child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  async *stream(messages: unknown[], tools: unknown[] = [], options: any = {}): AsyncGenerator<any> {
    const result = await this.chat(messages, tools, options);
    if (result.content) yield { type: 'text', content: result.content };
    yield { type: 'finish', finish_reason: 'stop', usage: result.usage ?? {} };
  }
}
