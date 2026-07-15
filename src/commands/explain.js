/**
 * Command: mycode explain <file>
 * Sends a file to the AI for a structured explanation.
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { resolve, relative, extname } from 'path';
import { ProviderRouter } from '../providers/router.js';
import { AgentLoop } from '../agent/loop.js';
import { configExists, getProvidersSorted, loadConfig } from '../utils/config.js';
import logger from '../utils/logger.js';

export function registerExplainCommand(program) {
  program
    .command('explain <file>')
    .description('Get an AI-powered explanation of a file')
    .option('-d, --detailed', 'Include a more detailed analysis')
    .action(async (file, options) => {
      try {
        if (!configExists()) {
          logger.error('No providers configured. Run `mycode init` first.');
          process.exit(1);
        }

        await explainFile(file, options);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });
}

async function explainFile(file, options) {
  const cwd = process.cwd();
  const filePath = resolve(cwd, file);
  const relPath = relative(cwd, filePath);

  if (!existsSync(filePath)) {
    logger.error(`File not found: ${file}`);
    process.exit(1);
  }

  const content = readFileSync(filePath, 'utf-8');
  const ext = extname(filePath).slice(1);

  // Build the explanation prompt
  const detailLevel = options.detailed ? 'detailed' : 'concise';
  const prompt = `Explain this ${ext} file (${relPath}). Provide a ${detailLevel} analysis including:

1. **Purpose**: What does this file do?
2. **Key Components**: Main functions, classes, or sections
3. **Dependencies**: What does it import/require?
4. **How It Works**: Step-by-step logic flow
${options.detailed ? '5. **Potential Issues**: Any bugs, anti-patterns, or improvements\n6. **Suggestions**: How could this code be improved?' : ''}

\`\`\`${ext}
${content.slice(0, 15_000)}
\`\`\`${content.length > 15_000 ? '\n\n(File truncated — showing first 15,000 characters)' : ''}`;

  const providers = getProvidersSorted();
  const router = new ProviderRouter(providers);
  const agent = new AgentLoop(router, cwd, { mode: 'explain' });

  logger.info(`Explaining: ${relPath}`);
  console.log();

  await agent.run(prompt);
}
