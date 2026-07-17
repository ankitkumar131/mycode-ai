import { createInterface } from 'readline/promises';
import { ConfigManager, AgentSession, ProviderRouter } from '@mycode/core';
import chalk from 'chalk';

export async function chatCommand(options: { model?: string; provider?: string } = {}): Promise<void> {
  const config = new ConfigManager();
  const cfg = config.configExists() ? await config.load() : config.get();

  if (cfg.providers.length === 0) {
    console.log(chalk.red('No providers configured. Run mycode init first.'));
    return;
  }

  const router = new ProviderRouter(cfg.providers);
  const session = new AgentSession({
    providerRouter: router,
    maxIterations: 25,
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(chalk.cyan('\nMyCode Chat — type /exit to quit\n'));

  while (true) {
    const input = await rl.question(chalk.green('> '));
    const trimmed = input.trim();

    if (!trimmed) continue;
    if (trimmed === '/exit' || trimmed === '/quit') break;

    process.stdout.write(chalk.dim('Thinking...'));
    try {
      const result = await session.run(trimmed);
      process.stdout.write('\r' + ' '.repeat(20) + '\r');
      console.log(result);
    } catch (err: any) {
      process.stdout.write('\r' + ' '.repeat(20) + '\r');
      console.error(chalk.red('Error:'), err.message);
    }
  }

  rl.close();
}
