import { readFile } from 'node:fs/promises';
import { ConfigManager, AgentSession, ProviderRouter } from '@mycode/core';
import chalk from 'chalk';
import { renderMarkdown } from '../ui/renderer.js';
import { createSpinner } from '../ui/spinner.js';

export async function explainCommand(filePath?: string): Promise<void> {
  if (!filePath) {
    console.log(chalk.yellow('Usage: mycode explain <file>'));
    return;
  }

  const config = new ConfigManager();
  const cfg = config.configExists() ? await config.load() : config.get();

  if (cfg.providers.length === 0) {
    console.log(chalk.red('No providers configured. Run mycode init first.'));
    return;
  }

  const router = new ProviderRouter(cfg.providers);

  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err: any) {
    console.log(chalk.red(`Cannot read file: ${err.message}`));
    return;
  }

  const spinner = createSpinner('Analyzing...');
  spinner.start();

  const session = new AgentSession({
    providerRouter: router,
    cwd: process.cwd(),
    onError(msg) { spinner.fail(chalk.red(msg)); },
    onFinish() { spinner.stop(); },
  });

  try {
    const result = await session.run([
      'You are a senior engineer. Explain the following code file clearly and concisely.',
      'Describe what it does, its structure, key functions, and any notable patterns.',
      '',
      `File: ${filePath}`,
      '```',
      content,
      '```',
    ].join('\n'));
    console.log(renderMarkdown(result || '(no response)'));
  } catch (err: any) {
    spinner.fail(chalk.red(err.message));
  }
}
