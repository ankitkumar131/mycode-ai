import type { ToolModule } from '../types.js';
import { executeCommand } from '../command-executor.js';

export const codeExecTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'code_exec',
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
  execute: async (args: { code: string; language?: string }, opts?: { cwd?: string }) => {
    const lang = args.language || 'javascript';
    const cwd = opts?.cwd || process.cwd();

    let cmd = '';
    if (lang === 'python') {
      cmd = `python -c ${JSON.stringify(args.code)}`;
    } else if (lang === 'bash' || lang === 'powershell') {
      cmd = args.code;
    } else {
      cmd = `node -e ${JSON.stringify(args.code)}`;
    }

    try {
      const res = await executeCommand(cmd, { cwd });
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
  },
};
