import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ConfigManager, AgentSession, ProviderRouter } from '@mycode/core';
import chalk from 'chalk';
import { renderMarkdown } from '../ui/renderer.js';
import { createSpinner } from '../ui/spinner.js';

export async function fixCommand(target?: string): Promise<void> {
  if (!target) {
    console.log(chalk.yellow('Usage: mycode fix <file> or mycode fix "<error-message>"'));
    return;
  }

  const config = new ConfigManager();
  const cfg = config.configExists() ? await config.load() : config.get();

  if (cfg.providers.length === 0) {
    console.log(chalk.red('No providers configured. Run mycode init first.'));
    return;
  }

  const router = new ProviderRouter(cfg.providers);

  let context = '';
  const isFilePath = existsSync(target);

  if (isFilePath) {
    try {
      context = await readFile(target, 'utf-8');
      console.log(chalk.cyan(`Analyzing: ${target}\n`));
    } catch (err: any) {
      console.log(chalk.red(`Cannot read file: ${err.message}`));
      return;
    }
  }

  const spinner = createSpinner('Diagnosing...');
  spinner.start();

  const session = new AgentSession({
    providerRouter: router,
    cwd: process.cwd(),
    onError(msg) { spinner.fail(chalk.red(msg)); },
    onFinish() { spinner.stop(); },
  });

  try {
    const prompt = isFilePath
      ? [
          'You are a senior debugging engineer. Analyze the following file for bugs,',
          'errors, or code quality issues. Identify problems and provide fixes.',
          '',
          `File: ${target}`,
          '```',
          context,
          '```',
        ].join('\n')
      : [
          'You are a senior debugging engineer. Diagnose the following error',
          'and explain what caused it and how to fix it:',
          '',
          target,
        ].join('\n');

    const result = await session.run(prompt);
    console.log(renderMarkdown(result || '(no diagnosis)'));
  } catch (err: any) {
    spinner.fail(chalk.red(err.message));
  }
}
