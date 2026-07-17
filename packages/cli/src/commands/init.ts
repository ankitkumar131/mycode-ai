import { createInterface } from 'readline/promises';
import { ConfigManager } from '@mycode/core';
import chalk from 'chalk';
import { select, input } from '../ui/prompt.js';

export async function initCommand(): Promise<void> {
  const config = new ConfigManager();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    if (config.configExists()) {
      const cfg = await config.load();
      console.log(chalk.yellow('Config already exists at:'), config.getConfigPath());
      console.log(chalk.cyan('\nExisting Providers:'));
      cfg.providers.forEach((p, idx) => {
        const priorityStr = p.priority !== undefined ? `[Priority ${p.priority}]` : '[No Priority]';
        console.log(`  ${idx + 1}. ${chalk.bold(p.name)} (${p.apiProvider}) — Model: ${p.model} ${priorityStr}`);
      });
      console.log();

      const choice = await select(rl, 'What would you like to do?', [
        { name: 'Add a new provider', value: 'add' },
        { name: 'Change provider priorities', value: 'priority' },
        { name: 'Exit', value: 'exit' },
      ]);

      if (choice === 'exit') {
        return;
      }

      if (choice === 'priority') {
        console.log(chalk.cyan('\nChange Priorities (lower number = higher priority):'));
        for (const p of cfg.providers) {
          const currentPriority = p.priority !== undefined ? String(p.priority) : '1';
          const newPriorityStr = await input(rl, `Priority for ${chalk.bold(p.name)}`, currentPriority);
          const parsed = parseInt(newPriorityStr, 10);
          p.priority = isNaN(parsed) ? 1 : parsed;
        }
        cfg.providers.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        await config.save(cfg);
        console.log(chalk.green('\nPriorities updated and saved successfully!'));
        return;
      }

      console.log(chalk.cyan('\nAdd New Provider Setup\n'));
    } else {
      console.log(chalk.cyan('MyCode Setup\n'));
    }

    const apiProvider = await rl.question(
      chalk.dim('API provider') + ' (openai/openrouter/ollama/custom): '
    );
    const provider = apiProvider.trim().toLowerCase() || 'openai';

    const defaultUrl = provider === 'ollama' ? 'http://localhost:11434' : '';
    const baseUrl = await rl.question(
      chalk.dim('Base URL') + (defaultUrl ? ` (${defaultUrl}): ` : ': ')
    );

    let apiKey = '';
    if (provider !== 'ollama') {
      apiKey = await rl.question(chalk.dim('API key') + ': ');
    }

    const model = await rl.question(chalk.dim('Model') + ' (gpt-4o): ');

    const name = await rl.question(
      chalk.dim('Provider name') + ` (${provider}-1): `
    );

    const priorityStr = await rl.question(
      chalk.dim('Priority') + ' (1): '
    );
    const parsedPriority = parseInt(priorityStr.trim(), 10);
    const priority = isNaN(parsedPriority) ? 1 : parsedPriority;

    const defaultConfig = config.configExists() ? await config.load() : config.get();
    defaultConfig.providers.push({
      name: name.trim() || `${provider}-1`,
      apiProvider: provider,
      model: model.trim() || 'gpt-4o',
      baseUrl: baseUrl.trim() || defaultUrl || undefined,
      apiKey: apiKey.trim() || undefined,
      priority,
    });

    defaultConfig.providers.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

    await config.save(defaultConfig);
    console.log(chalk.green('\nConfig saved to:'), config.getConfigPath());
  } finally {
    rl.close();
  }
}
