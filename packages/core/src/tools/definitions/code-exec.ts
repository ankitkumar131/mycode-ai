import type { ToolModule } from '../types.js';
import { executeCommand } from '../command-executor.js';

export const codeExecTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'execute_code',
      description: 'Execute code snippets safely in an isolated shell execution environment.',
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
  execute: (async (args: Record<string, unknown>, cwd: string) => {
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

    try {
      const res = await executeCommand(cmd, cwd, { timeout: 60_000 });
      return {
        success: res.exitCode === 0,
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.exitCode,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || String(err),
      };
    }
  }) as unknown as ToolModule['execute'],
};
