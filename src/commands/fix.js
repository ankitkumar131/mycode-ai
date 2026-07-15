/**
 * Command: mycode fix <file|error.log>
 * Reads an error or problematic file and proposes fixes.
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { resolve, relative, extname } from 'path';
import { ProviderRouter } from '../providers/router.js';
import { AgentLoop } from '../agent/loop.js';
import { configExists, getProvidersSorted, loadConfig } from '../utils/config.js';
import logger from '../utils/logger.js';

export function registerFixCommand(program) {
  program
    .command('fix <target>')
    .description('Fix errors in a file or from error output')
    .option('-a, --auto', 'Automatically apply the fix without confirmation')
    .action(async (target, options) => {
      try {
        if (!configExists()) {
          logger.error('No providers configured. Run `mycode init` first.');
          process.exit(1);
        }

        await fixTarget(target, options);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });
}

async function fixTarget(target, options) {
  const cwd = process.cwd();
  const config = loadConfig();
  let prompt;

  // Check if target is a file or inline error text
  const filePath = resolve(cwd, target);

  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf-8');
    const ext = extname(filePath).slice(1);
    const relPath = relative(cwd, filePath);

    const isErrorLog = ext === 'log' || ext === 'txt' || target.includes('error');

    if (isErrorLog) {
      prompt = `Here is an error log. Analyze the errors, identify the root cause, and propose fixes.

If you can determine which source files need to be changed, use the readFile tool to read them,
then use editFile to apply the fixes.

Error log (${relPath}):
\`\`\`
${content.slice(0, 10_000)}
\`\`\``;
    } else {
      prompt = `This file has issues that need to be fixed. Read the file, analyze it for bugs, errors, 
anti-patterns, or potential problems, and fix them.

Use readFile to examine the file, then use editFile to apply targeted fixes.
After fixing, explain what you changed and why.

File to fix: ${relPath}`;
    }

    logger.info(`Analyzing: ${relPath}`);
  } else {
    // Treat target as inline error text
    prompt = `The user encountered this error. Analyze it, identify the root cause, and help fix it.

If you need to examine source files, use readFile and searchFiles to find the relevant code,
then use editFile to apply fixes.

Error:
\`\`\`
${target}
\`\`\``;

    logger.info('Analyzing error...');
  }

  console.log();

  const providers = getProvidersSorted();
  const router = new ProviderRouter(providers);
  const agent = new AgentLoop(router, cwd, {
    mode: 'fix',
    confirmWrites: !options.auto && config.preferences.confirm_writes,
    confirmCommands: config.preferences.confirm_commands,
  });

  await agent.run(prompt);
}
