import { readFile } from 'node:fs/promises';
import { ConfigManager, AgentSession, ProviderRouter } from '@mycode/core';
import chalk from 'chalk';
import { renderMarkdown } from '../ui/renderer.js';
import { createSpinner } from '../ui/spinner.js';
import { confirmFileWrite } from '../ui/prompt.js';
import { createInterface } from 'readline/promises';
import { createTwoFilesPatch } from 'diff';

export async function editCommand(filePath?: string, instruction?: string): Promise<void> {
  if (!filePath || !instruction) {
    console.log(chalk.yellow('Usage: mycode edit <file> "<instruction>"'));
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

  console.log(chalk.cyan(`Editing: ${filePath}`));
  console.log(chalk.dim(`Instruction: ${instruction}\n`));

  const session = new AgentSession({
    providerRouter: router,
    cwd: process.cwd(),
    maxIterations: 5,
  });

  const spinner = createSpinner('Generating edit...');
  spinner.start();

  try {
    const result = await session.run([
      'You are an expert code editor. Given a file and an edit instruction,',
      'output ONLY the complete updated file content inside a code block.',
      'Do NOT add any other commentary or explanation.',
      '',
      `File: ${filePath}`,
      '```',
      content,
      '```',
      '',
      `Instruction: ${instruction}`,
    ].join('\n'));

    spinner.stop();

    const match = result?.match(/```[\w]*\n([\s\S]*?)```/);
    if (!match) {
      console.log(chalk.yellow('Could not extract edited file. Response:'));
      console.log(renderMarkdown(result || ''));
      return;
    }

    const newContent = match[1];

    const diff = createTwoFilesPatch(filePath, filePath, content, newContent);
    console.log(diff);

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const confirmed = await confirmFileWrite(rl, filePath);
    rl.close();
    if (!confirmed) {
      console.log(chalk.dim('Edit cancelled.'));
      return;
    }

    const { writeFile } = await import('node:fs/promises');
    await writeFile(filePath, newContent, 'utf-8');
    console.log(chalk.green(`\nWrote ${filePath}`));
  } catch (err: any) {
    spinner.fail(chalk.red(err.message));
  }
}
