/**
 * Command: mycode init
 * Interactive setup wizard that creates ~/.mycode/settings.json
 */

import chalk from 'chalk';
import {
  configExists,
  ensureConfigDir,
  loadConfig,
  saveConfig,
  addProvider,
  CONFIG_DIR,
  CONFIG_FILE,
} from '../utils/config.js';
import { input, password, select, confirm } from '../ui/prompt.js';
import logger from '../utils/logger.js';

/**
 * Known provider presets with defaults.
 */
const PROVIDER_PRESETS = {
  openrouter: {
    api_provider: 'openrouter',
    base_url: 'https://openrouter.ai/api/v1',
    models: [
      'openai/gpt-4o',
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-flash',
      'meta-llama/llama-3.1-70b-instruct',
      'deepseek/deepseek-coder',
    ],
  },
  nvidia_nim: {
    api_provider: 'nvidia_nim',
    base_url: 'https://integrate.api.nvidia.com/v1',
    models: [
      'meta/llama-3.1-70b-instruct',
      'meta/llama-3.1-405b-instruct',
      'mistralai/mixtral-8x22b-instruct-v0.1',
    ],
  },
  ollama: {
    api_provider: 'ollama',
    base_url: 'http://localhost:11434',
    models: [
      'llama3.1:8b',
      'llama3.1:70b',
      'qwen2.5-coder:7b',
      'codellama:13b',
      'deepseek-coder-v2:16b',
    ],
  },
  openai: {
    api_provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'o1',
      'o1-mini',
    ],
  },
  custom: {
    api_provider: 'custom',
    base_url: '',
    models: [],
  },
};

export function registerInitCommand(program) {
  program
    .command('init')
    .description('Set up MyCode — configure your first AI provider')
    .action(async () => {
      try {
        await runInit();
      } catch (err) {
        if (err.message.includes('force closed')) {
          console.log();
          logger.info('Setup cancelled.');
          process.exit(0);
        }
        logger.error(err.message);
        process.exit(1);
      }
    });
}

async function runInit() {
  console.log();
  console.log(chalk.hex('#7C3AED').bold('  ⚡ MyCode Setup Wizard'));
  console.log(chalk.dim('  Configure your AI providers for terminal coding.\n'));

  if (configExists()) {
    const config = loadConfig();
    const providerCount = config.providers.length;
    logger.info(`Found existing config with ${providerCount} provider(s).`);

    const action = await select('What would you like to do?', [
      { name: '➕ Add another provider', value: 'add' },
      { name: '🔄 Reset and start fresh', value: 'reset' },
      { name: '❌ Cancel', value: 'cancel' },
    ]);

    if (action === 'cancel') {
      logger.info('Setup cancelled.');
      return;
    }

    if (action === 'reset') {
      const confirmed = await confirm(
        chalk.hex('#F87171')('This will delete all provider configs. Continue?'),
        false
      );
      if (!confirmed) return;
    }

    if (action === 'add') {
      const nextPriority = Math.max(...config.providers.map((p) => p.priority), 0) + 1;
      await addProviderWizard(nextPriority);
      return;
    }
  }

  // Fresh setup
  ensureConfigDir();
  saveConfig({
    providers: [],
    preferences: {
      theme: 'dark',
      confirm_writes: true,
      confirm_commands: true,
      max_context_files: 20,
      log_conversations: true,
    },
  });

  logger.success(`Config directory created: ${CONFIG_DIR}`);
  console.log();

  // Add first provider
  await addProviderWizard(1);

  // Ask if they want to add more
  let addMore = true;
  let priority = 2;
  while (addMore) {
    console.log();
    addMore = await confirm('Would you like to add another provider (for failover)?', false);
    if (addMore) {
      await addProviderWizard(priority++);
    }
  }

  // Show summary
  console.log();
  logger.divider();
  const finalConfig = loadConfig();
  logger.success(`Setup complete! ${finalConfig.providers.length} provider(s) configured.`);
  console.log();

  for (const p of finalConfig.providers) {
    console.log(
      `  ${chalk.hex('#A78BFA')(`#${p.priority}`)} ${chalk.bold(p.name)} ` +
      chalk.dim(`(${p.api_provider}/${p.model})`) +
      (p.read ? chalk.hex('#34D399')(' ✓read') : chalk.dim(' ✗read')) +
      (p.write ? chalk.hex('#34D399')(' ✓write') : chalk.hex('#F87171')(' ✗write'))
    );
  }

  console.log();
  console.log(chalk.dim(`  Config: ${CONFIG_FILE}`));
  console.log();
  console.log(chalk.hex('#A78BFA')('  Get started:'));
  console.log(chalk.dim('    mycode chat        — Start an AI conversation'));
  console.log(chalk.dim('    mycode agent       — Run the autonomous agent'));
  console.log(chalk.dim('    mycode explain     — Explain a file'));
  console.log(chalk.dim('    mycode config test — Test provider connections'));
  console.log();
}

async function addProviderWizard(priority) {
  console.log(chalk.hex('#A78BFA').bold(`\n  Provider #${priority}`));
  console.log(chalk.dim('  ─────────────────────'));

  // Select provider type
  const providerType = await select('Choose your AI provider:', [
    { name: '🌐 OpenRouter (100+ models, best for flexibility)', value: 'openrouter' },
    { name: '🟢 NVIDIA NIM (GPU-optimized inference)', value: 'nvidia_nim' },
    { name: '🦙 Ollama (local, free, no API key needed)', value: 'ollama' },
    { name: '🤖 OpenAI (direct)', value: 'openai' },
    { name: '⚙️  Custom (any OpenAI-compatible endpoint)', value: 'custom' },
  ]);

  const preset = PROVIDER_PRESETS[providerType];

  // Model selection
  let model;
  if (preset.models.length > 0) {
    model = await select('Select a model:', [
      ...preset.models.map((m) => ({ name: m, value: m })),
      { name: '✏️  Enter custom model name', value: '__custom__' },
    ]);

    if (model === '__custom__') {
      model = await input('Enter the model identifier:');
    }
  } else {
    model = await input('Enter the model identifier (e.g., gpt-4o):');
  }

  // Base URL
  let baseUrl = preset.base_url;
  if (providerType === 'custom' || !baseUrl) {
    baseUrl = await input('Enter the API base URL:', 'https://api.example.com/v1');
  }

  // API Key (not needed for Ollama)
  let apiKey = '';
  if (providerType !== 'ollama') {
    apiKey = await password(`Enter your ${providerType} API key:`);

    if (!apiKey) {
      logger.warn('No API key provided. You can add it later in settings.json.');
    }
  }

  // Permissions
  const canRead = true; // Always enable reading
  const canWrite = await confirm('Allow this provider to write/edit files?', true);

  // Name
  const defaultName = `${providerType} ${model.split('/').pop()}`;
  const name = await input('Give this provider a name:', defaultName);

  // Build and save
  const provider = {
    priority,
    name,
    api_provider: providerType,
    model,
    api_key: apiKey,
    base_url: baseUrl,
    read: canRead,
    write: canWrite,
    max_retries: 3,
  };

  addProvider(provider);
  logger.success(`Added provider: ${name}`);
}
