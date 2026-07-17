import { createInterface } from 'readline/promises';
import { ConfigManager } from '@mycode/core';
import chalk from 'chalk';

export async function initCommand(): Promise<void> {
  const config = new ConfigManager();
  if (config.configExists()) {
    const cfg = await config.load();
    console.log(chalk.yellow('Config already exists at:'), config.getConfigPath());
    console.log(chalk.dim(`  Providers: ${cfg.providers.length}`));
    return;
  }

  console.log(chalk.cyan('MyCode Setup\n'));

  const rl = createInterface({ input: process.stdin, output: process.stdout });

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

  rl.close();

  const defaultConfig = config.get();
  defaultConfig.providers.push({
    name: name.trim() || `${provider}-1`,
    apiProvider: provider,
    model: model.trim() || 'gpt-4o',
    baseUrl: baseUrl.trim() || defaultUrl || undefined,
    apiKey: apiKey.trim() || undefined,
    priority: 1,
  });

  await config.save(defaultConfig);
  console.log(chalk.green('\nConfig saved to:'), config.getConfigPath());
}
