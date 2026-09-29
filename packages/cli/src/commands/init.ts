import { createInterface } from 'readline/promises';
import { ConfigManager, adjustProviderPriorities, type ProviderConfig } from '@mycode/core';
import chalk from 'chalk';
import { select, input } from '../ui/prompt.js';

function splitArgs(input: string): string[] {
  return [...input.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\\s]+)/g)].map(m => m[1] ?? m[2] ?? m[3]);
}

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
        for (let i = 0; i < cfg.providers.length; i++) {
          const p = cfg.providers[i];
          const currentPriority = p.priority !== undefined ? String(p.priority) : String(i + 1);
          const newPriorityStr = await input(rl, `Priority for ${chalk.bold(p.name)}`, currentPriority);
          const parsed = parseInt(newPriorityStr, 10);
          p.priority = isNaN(parsed) ? (i + 1) : parsed;
          adjustProviderPriorities(cfg.providers, i);
        }
        await config.save(cfg);
        console.log(chalk.green('\nPriorities updated and saved successfully!'));
        return;
      }

      console.log(chalk.cyan('\nAdd New Provider Setup\n'));
    } else {
      console.log(chalk.cyan('MyCode Setup\n'));
    }

    const defaultConfig = config.configExists() ? await config.load() : config.get();
    const defaultPriority = defaultConfig.providers.length + 1;

    // 1. priority
    const priorityStr = await rl.question(
      chalk.dim('Priority') + ` (${defaultPriority}): `
    );
    const parsedPriority = parseInt(priorityStr.trim(), 10);
    const priority = isNaN(parsedPriority) ? defaultPriority : parsedPriority;

    // 2. name
    const defaultNamePlaceholder = `provider-${priority}`;
    const nameStr = await rl.question(
      chalk.dim('Provider name') + ` (${defaultNamePlaceholder}): `
    );
    let name = nameStr.trim();

    // 3. apiProvider
    const apiProviderStr = await rl.question(
      chalk.dim('API provider') + ' (openai/openrouter/ollama/custom/cli): '
    );
    const provider = apiProviderStr.trim().toLowerCase() || 'openai';
    const isCliProvider = ['cli', 'munder', 'external'].includes(provider);

    if (!name) {
      name = `${provider}-${priority}`;
    }

    // 4. model
    const defaultModel = isCliProvider ? 'external-agent' : provider === 'ollama' ? 'llama3.1:8b' : 'gpt-4o';
    const modelStr = await rl.question(chalk.dim('Model') + ` (${defaultModel}): `);
    const model = modelStr.trim() || defaultModel;

    // 5. apiKey (external agent CLIs use their own login/authentication)
    let apiKey: string | undefined = undefined;
    if (provider !== 'ollama' && !isCliProvider) {
      const keyStr = await rl.question(chalk.dim('API key') + ': ');
      apiKey = keyStr.trim() || undefined;
    }

    // 6. baseUrl
    let baseUrl: string | undefined;
    if (!isCliProvider) {
      const defaultUrl = provider === 'ollama' ? 'http://localhost:11434' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : '';
      const baseUrlStr = await rl.question(
        chalk.dim('Base URL') + (defaultUrl ? ` (${defaultUrl}): ` : ': ')
      );
      baseUrl = baseUrlStr.trim() || defaultUrl || undefined;
    }

    let command: string | undefined;
    let cliArgs: string[] | undefined;
    if (isCliProvider) {
      const commandStr = await rl.question(chalk.dim('CLI command') + ' (for example: claude, codex, gemini): ');
      command = commandStr.trim() || undefined;
      const argsStr = await rl.question(chalk.dim('CLI arguments') + ' (optional; use {model} or {prompt} when supported): ');
      cliArgs = argsStr.trim() ? splitArgs(argsStr.trim()) : undefined;
    }

    // 7. read
    const readStr = await rl.question(chalk.dim('Read permission') + ' (true/false) [true]: ');
    const readTrim = readStr.trim().toLowerCase();
    const read = readTrim === '' ? true : !(readTrim === 'false' || readTrim === 'f' || readTrim === 'no' || readTrim === 'n');

    // 8. write
    const writeStr = await rl.question(chalk.dim('Write permission') + ' (true/false) [true]: ');
    const writeTrim = writeStr.trim().toLowerCase();
    const write = writeTrim === '' ? true : !(writeTrim === 'false' || writeTrim === 'f' || writeTrim === 'no' || writeTrim === 'n');

    // 9. maxRetries
    const maxRetriesStr = await rl.question(chalk.dim('Max retries') + ' (3): ');
    const parsedRetries = parseInt(maxRetriesStr.trim(), 10);
    const maxRetries = isNaN(parsedRetries) ? 3 : parsedRetries;

    const newProvider: ProviderConfig = {
      priority,
      name,
      apiProvider: provider,
      model,
      apiKey,
      baseUrl,
      read,
      write,
      maxRetries,
      ...(isCliProvider ? { command, args: cliArgs } : {}),
    };

    defaultConfig.providers.push(newProvider);
    adjustProviderPriorities(defaultConfig.providers, defaultConfig.providers.length - 1);

    await config.save(defaultConfig);
    console.log(chalk.green('\nConfig saved to:'), config.getConfigPath());
  } finally {
    rl.close();
  }
}
