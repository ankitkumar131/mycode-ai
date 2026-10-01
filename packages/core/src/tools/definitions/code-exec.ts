import type { ToolModule, ToolExecuteOptions } from '../types.js';
import { executeCommand } from '../command-executor.js';
import { classifyCommand } from '../command-safety.js';

export const codeExecTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'execute_code',
      description: 'Execute a short code snippet through MyCode command safety and approval checks.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Source code snippet to execute.',
          },
          language: {
            type: 'string',
            enum: ['javascript', 'typescript', 'python', 'bash', 'powershell'],
            default: 'javascript',
            description: 'Programming language of snippet.',
          },
        },
        required: ['code'],
      },
    },
  },
  execute: (async (args: Record<string, unknown>, cwd: string, options?: ToolExecuteOptions) => {
    const code = typeof args.code === 'string' ? args.code : '';
    const lang = typeof args.language === 'string' ? args.language : 'javascript';

    let cmd = '';
    if (lang === 'python') {
      cmd = `python -c ${JSON.stringify(code)}`;
    } else if (lang === 'bash' || lang === 'powershell') {
      cmd = code;
    } else {
      cmd = `node -e ${JSON.stringify(code)}`;
    }

    const safety = classifyCommand(cmd);
    if (safety.level === 'blocked') throw new Error(`Code execution blocked: ${safety.reason}`);
    if (options?.confirmFn) {
      const allowed = await options.confirmFn(cmd, `execute ${lang} snippet`, safety);
      if (!allowed) return 'Code execution cancelled by user.';
    }

    try {
      const res = await executeCommand(cmd, cwd, {
        timeout: 60_000,
        abortSignal: options?.abortSignal,
      });
      return {
        success: res.exitCode === 0,
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.exitCode,
        status: res.status,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || String(err),
      };
    }
  }) as unknown as ToolModule['execute'],
};
