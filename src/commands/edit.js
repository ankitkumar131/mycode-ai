/**
 * Command: mycode edit <file> "instruction"
 * AI-powered file editing with diff preview.
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { resolve, relative, extname } from 'path';
import { ProviderRouter } from '../providers/router.js';
import { AgentLoop } from '../agent/loop.js';
import { configExists, getProvidersSorted, loadConfig } from '../utils/config.js';
import logger from '../utils/logger.js';

export function registerEditCommand(program) {
  program
    .command('edit <file> [instruction...]')
    .description('Apply AI-powered edits to a file')
    .option('-a, --auto', 'Automatically apply without confirmation')
    .action(async (file, instruction, options) => {
      try {
        if (!configExists()) {
          logger.error('No providers configured. Run `mycode init` first.');
          process.exit(1);
        }

        const instructionText = instruction.join(' ');
        if (!instructionText) {
          logger.error('Please provide an edit instruction. Example: mycode edit app.js "add error handling"');
          process.exit(1);
        }

        await editFile(file, instructionText, options);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });
}

async function editFile(file, instruction, options) {
  const cwd = process.cwd();
  const config = loadConfig();
  const filePath = resolve(cwd, file);
  const relPath = relative(cwd, filePath);

  if (!existsSync(filePath)) {
    logger.error(`File not found: ${file}`);
    process.exit(1);
  }

  const prompt = `Edit the file "${relPath}" with the following instruction:

"${instruction}"

Steps:
1. Use readFile to read the current contents of "${relPath}"
2. Understand the code and the requested change
3. Use editFile to apply targeted search-and-replace edits
4. Explain what you changed and why

Be precise and make the minimum necessary changes.`;

  logger.info(`Editing: ${relPath}`);
  logger.info(`Instruction: ${instruction}`);
  console.log();

  const providers = getProvidersSorted();
  const router = new ProviderRouter(providers);
  const agent = new AgentLoop(router, cwd, {
    mode: 'edit',
    confirmWrites: !options.auto && config.preferences.confirm_writes,
    confirmCommands: config.preferences.confirm_commands,
  });

  await agent.run(prompt);
}
